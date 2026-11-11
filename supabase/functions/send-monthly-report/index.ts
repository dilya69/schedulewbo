// supabase/functions/send-monthly-report/index.ts
//
// Запускается по расписанию (см. sql/migration_monthly_report.sql) —
// за несколько дней до автоочистки (1 числа) сама формирует CSV
// с данными за месяц, который вот-вот удалится, и присылает его
// каждому админу документом в Telegram. Заходить в приложение не нужно.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ---------- CSV ----------
// Разделитель — табуляция; кодировка (см. sendDocumentToChat ниже) — UTF-16LE
// с BOM, "родной" юникод-формат Excel — так кириллица не превращается
// в кракозябры ни на одной версии Excel, включая мобильную.
function csvField(v: unknown): string {
  const s = String(v ?? "");
  if (/["\t\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join("\t") + "\r\n";
}

// ---------- расчёт суммы за смену (те же правила, что в приложении, js/app.js) ----------
// Полная смена (от открытия до закрытия ПВЗ) = pvz.full_shift_pay.
// Остальные смены = часы × 250 ₽/ч (начало до 17:00) или × 200 ₽/ч (с 17:00).
// Стажёр (в должности «стажер»), месяц со дня первой смены: полная смена 2700 (не больше суммы ПВЗ), остальное по 200 ₽/ч.
const RATE_EARLY = 250, RATE_LATE = 200, RATE_LATE_FROM = 17 * 60;
const TRAINEE_FULL = 2700, TRAINEE_HOURLY = 200;
const RE_TRAINEE = /стаж[её]р/i;

function toMin(t: string | null | undefined): number {
  const s = String(t ?? "0:0").slice(0, 5);
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function isTraineeOn(shift: any, firstShiftByEmp: Map<string, string>): boolean {
  const e = shift.employees;
  if (!e || !RE_TRAINEE.test(e.position ?? "")) return false;
  const from = e.trainee_from ?? firstShiftByEmp.get(shift.employee_id);
  if (!from) return false;
  return shift.shift_date >= from && shift.shift_date < addMonthsYmd(from, 1);
}

function shiftAmount(shift: any, pvz: any, firstShiftByEmp: Map<string, string>): number {
  if (shift.custom_amount !== null && shift.custom_amount !== undefined) return Number(shift.custom_amount);
  if (!pvz) return 0;

  const trainee = isTraineeOn(shift, firstShiftByEmp);
  const s0 = toMin(shift.start_time);
  const rate = trainee ? TRAINEE_HOURLY : (s0 < RATE_LATE_FROM ? RATE_EARLY : RATE_LATE);

  if (shift.duration_minutes) return (Number(shift.duration_minutes) / 60) * rate;

  const e0 = toMin(shift.end_time);
  if (e0 <= s0) return 0;

  const isFull = s0 === toMin(pvz.default_start_time ?? "09:00") && e0 === toMin(pvz.default_end_time ?? "21:00");
  if (isFull) {
    const full = Number(pvz.full_shift_pay || 0);
    return trainee ? Math.min(TRAINEE_FULL, full) : full;
  }
  return ((e0 - s0) / 60) * rate;
}

// строка -> байты UTF-16LE с BOM (см. комментарий у csvRow выше)
function toUtf16LEBytes(str: string): Uint8Array {
  const buf = new Uint8Array(2 + str.length * 2);
  buf[0] = 0xff;
  buf[1] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[2 + i * 2] = code & 0xff;
    buf[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return buf;
}

async function sendDocumentToChat(chatId: number, filename: string, content: string, caption: string) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const blob = new Blob([toUtf16LEBytes(content)], { type: "text/csv;charset=utf-16le" });
  form.append("document", blob, filename);
  form.append("caption", caption);
  await fetch(`${API}/sendDocument`, { method: "POST", body: form });
}

Deno.serve(async () => {
  try {
    const now = new Date();
    let month = now.getMonth();
    let year = now.getFullYear();

    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const [{ data: shifts }, { data: bf }, { data: pvzList }, { data: admins }] = await Promise.all([
      supabase.from("shifts").select("*, employees:employee_id(full_name, position, trainee_from)").gte("shift_date", from).lte("shift_date", to),
      supabase.from("bonuses_fines").select("*, employees:employee_id(full_name)").eq("period_month", from),
      supabase.from("pvz").select("*"),
      supabase.from("employees").select("tg_id").eq("is_admin", true).eq("is_active", true),
    ]);

    if (!admins || admins.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no admins" }), { headers: { "Content-Type": "application/json" } });
    }

    const pvzById = new Map((pvzList ?? []).map((p: any) => [p.id, p]));

    // самая ранняя смена сотрудника в этом месяце — запасной вариант, если trainee_from ещё не записан
    const firstShiftByEmp = new Map<string, string>();
    (shifts ?? []).forEach((s: any) => {
      if (!s.employee_id) return;
      const cur = firstShiftByEmp.get(s.employee_id);
      if (!cur || s.shift_date < cur) firstShiftByEmp.set(s.employee_id, s.shift_date);
    });

    let csv = csvRow(["Дата", "ПВЗ", "Сотрудник", "Начало", "Конец", "Статус", "Сумма"]);
    (shifts ?? []).sort((a: any, b: any) => a.shift_date.localeCompare(b.shift_date)).forEach((s: any) => {
      const pvz = pvzById.get(s.pvz_id);
      const amount = s.employee_id ? Math.round(shiftAmount(s, pvz, firstShiftByEmp)) : "";
      csv += csvRow([s.shift_date, pvz?.name ?? "", s.employees?.full_name ?? "", String(s.start_time).slice(0,5), String(s.end_time).slice(0,5), s.status, amount]);
    });
    csv += "\r\n" + csvRow(["Бонусы/Штрафы"]);
    csv += csvRow(["Сотрудник", "Тип", "Сумма", "Причина"]);
    (bf ?? []).forEach((b: any) => {
      csv += csvRow([b.employees?.full_name ?? "—", b.kind === "bonus" ? "Бонус" : "Штраф", b.amount, b.reason ?? ""]);
    });

    const monthsRu = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
    const filename = `данные_${year}_${month + 1}.csv`;
    const caption = `📄 Автоотчёт: данные за ${monthsRu[month]} ${year} будут удалены, как только начнётся новый месяц (1 числа). Сохраните этот файл, если нужно. Раздел «Бонусы/Штрафы» виден только администраторам — сотрудникам этот файл пересылать не нужно.`;

    let sent = 0;
    for (const a of admins) {
      if (a.tg_id && a.tg_id > 0) {
        await sendDocumentToChat(a.tg_id, filename, csv, caption);
        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
