// @ts-nocheck
// supabase/functions/send-reminders/index.ts
//
// Запускается по расписанию (cron, раз в 5 минут) и шлёт сотрудникам в Telegram:
//  1) напоминание о смене за remind_minutes до начала;
//  2) повторы этого напоминания каждые repeat_minutes (если > 0) до начала смены,
//     но не больше MAX_REPEATS повторов, чтобы не завалить человека сообщениями;
//  3) ежедневное напоминание в daily_time (по Москве) со списком смен на сегодня
//     (если на сегодня смен нет — ничего не шлёт).
//
// Настройки берутся из notification_settings. Если у сотрудника ещё нет строки настроек
// (он не открывал профиль), ему приходит только одно напоминание за 120 минут.
// Сотрудникам, которые ещё не открывали бота (tg_id <= 0), ничего не отправляется.
//
// Секреты: BOT_TOKEN; SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// <logic>
const TZ_OFFSET = "+03:00";          // время смен — московское
const TZ_SHIFT_MS = 3 * 3600 * 1000;
const WINDOW = 2.5;                  // минут: крон идёт раз в 5 минут
const MAX_REPEATS = 4;               // максимум повторов после первого напоминания

const toMin = (t) => {
  const [h, m] = String(t ?? "0:0").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const hhmm = (t) => String(t ?? "").slice(0, 5);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// окно полуоткрытое [-2.5; 2.5): соседние запуски крона не совпадут по границе
const inWindow = (d) => d >= -WINDOW && d < WINDOW;

function mskNow(now) {
  const d = new Date(now.getTime() + TZ_SHIFT_MS);
  return { ymd: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function fmtDate(ymd) {
  const [, m, d] = String(ymd).split("-");
  return `${d}.${m}`;
}

// Возвращает список сообщений, которые надо отправить прямо сейчас.
// shifts: смены с employee_id (shift_date >= сегодня); settingsRows: строки notification_settings.
function planMessages(now, shifts, settingsRows) {
  const out = [];
  const settingsBy = new Map((settingsRows ?? []).map((s) => [s.employee_id, s]));
  const { ymd: today, minutes: nowMin } = mskNow(now);

  // 1) напоминания о смене и повторы
  for (const shift of shifts) {
    const emp = shift.employees;
    if (!emp || !(Number(emp.tg_id) > 0)) continue;
    const st = settingsBy.get(shift.employee_id);
    if (st && st.push_enabled === false) continue;

    const remind = st?.remind_minutes ?? 120;
    const repeat = st?.repeat_minutes ?? 0;
    const startMs = new Date(`${shift.shift_date}T${shift.start_time}${TZ_OFFSET}`).getTime();
    const minutesLeft = (startMs - now.getTime()) / 60000;
    if (minutesLeft < WINDOW) continue; // смена уже началась или вот-вот начнётся

    const elapsed = remind - minutesLeft; // сколько прошло с момента первого напоминания
    let k = 0;
    let due = false;
    if (repeat > 0) {
      k = Math.round(elapsed / repeat);
      due = k >= 0 && k <= MAX_REPEATS && inWindow(elapsed - k * repeat);
    } else {
      due = inWindow(elapsed);
    }
    if (!due) continue;

    const title = k > 0 ? "⏰ Напоминание о смене (повтор)" : "⏰ Напоминание о смене";
    out.push({
      chatId: Number(emp.tg_id),
      kind: k > 0 ? "repeat" : "reminder",
      text: `${title}\n\n🏢 ${esc(shift.pvz?.name ?? "ПВЗ")}\n📅 ${fmtDate(shift.shift_date)}, ${hhmm(shift.start_time)}–${hhmm(shift.end_time)}\n\nНе забудьте про смену!`,
    });
  }

  // 2) ежедневное напоминание со списком смен на сегодня (только у тех, кто сохранял настройки)
  const todayByEmp = new Map();
  for (const s of shifts) {
    if (s.shift_date !== today || !s.employee_id) continue;
    if (!todayByEmp.has(s.employee_id)) todayByEmp.set(s.employee_id, []);
    todayByEmp.get(s.employee_id).push(s);
  }
  for (const [empId, list] of todayByEmp) {
    const st = settingsBy.get(empId);
    if (!st || st.push_enabled === false || !st.daily_time) continue;
    const emp = list[0].employees;
    if (!emp || !(Number(emp.tg_id) > 0)) continue;
    if (!inWindow(nowMin - toMin(st.daily_time))) continue;

    list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const lines = list.map((s) => `🏢 ${esc(s.pvz?.name ?? "ПВЗ")}: ${hhmm(s.start_time)}–${hhmm(s.end_time)}`);
    out.push({
      chatId: Number(emp.tg_id),
      kind: "daily",
      text: `☀️ Сегодня у вас ${list.length > 1 ? "смены" : "смена"}\n\n${lines.join("\n")}`,
    });
  }
  return out;
}
// </logic>

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendMessage(chatId, text) {
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return r.ok;
  } catch (e) {
    console.error("sendMessage", e);
    return false;
  }
}

Deno.serve(async () => {
  const now = new Date();
  const { ymd: today } = mskNow(now);

  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("id, shift_date, start_time, end_time, employee_id, pvz:pvz_id(name), employees:employee_id(tg_id, full_name)")
    .not("employee_id", "is", null)
    .gte("shift_date", today);
  if (error) {
    console.error(error);
    return new Response("error", { status: 500 });
  }

  const { data: settingsRows } = await supabase.from("notification_settings").select("*");

  const messages = planMessages(now, shifts ?? [], settingsRows ?? []);
  let sent = 0;
  const byKind = { reminder: 0, repeat: 0, daily: 0 };
  for (const m of messages) {
    if (await sendMessage(m.chatId, m.text)) {
      sent++;
      byKind[m.kind]++;
    }
  }

  return new Response(JSON.stringify({ sent, ...byKind }), { headers: { "Content-Type": "application/json" } });
});
