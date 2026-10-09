// sync-schedule — раз в N минут скачивает график с Яндекс Диска (публичная ссылка),
// разбирает его тем же кодом, что и кнопка «Импорт графика» в приложении, и пишет смены.
//
// Секреты: BOT_TOKEN (уже есть), SYNC_SECRET (новый, любая длинная строка).
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// Деплой: supabase functions deploy sync-schedule --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import "../_shared/sheet-import.js";

const SheetImport = (globalThis as any).SheetImport;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const MAX_DELETES = 40; // больше за один запуск автоматически не удаляем — только вручную из приложения
const CHUNK = 150;
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// «сегодня» по Москве: год и месяц нужны, чтобы не трогать прошлые месяцы
function moscowNow() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function fetchAll(table: string, build: (q: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db.from(table).select("*")).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function downloadXlsx(publicUrl: string): Promise<ArrayBuffer> {
  const api = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(publicUrl);
  const r1 = await fetch(api);
  if (!r1.ok) throw new Error(`Яндекс Диск не отдал ссылку на файл (HTTP ${r1.status}). Проверьте, что доступ по ссылке включён.`);
  const { href } = await r1.json();
  if (!href) throw new Error("Яндекс Диск не вернул адрес скачивания");
  const r2 = await fetch(href);
  if (!r2.ok) throw new Error(`Не удалось скачать файл (HTTP ${r2.status})`);
  return await r2.arrayBuffer();
}

async function notifyAdmins(text: string) {
  const token = Deno.env.get("BOT_TOKEN");
  if (!token) return;
  const { data: admins } = await db.from("employees").select("tg_id").eq("is_admin", true).eq("is_active", true).gt("tg_id", 0);
  for (const a of admins || []) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: a.tg_id, text }),
      });
    } catch (_) { /* уведомление не критично */ }
  }
}

async function finish(status: string, message: string, alert: string | null, prevAlert: string | null) {
  await db.from("schedule_sync").update({
    last_run_at: new Date().toISOString(), last_status: status, last_message: message,
    last_alert: alert, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  // шлём админам только когда проблема новая или изменилась, а не каждые 10 минут
  if (alert && alert !== prevAlert) await notifyAdmins("📋 График из таблицы\n" + message);
  return json({ status, message });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("SYNC_SECRET");
  if (!secret || req.headers.get("x-sync-secret") !== secret) return json({ error: "forbidden" }, 403);

  const { data: cfg, error: cfgErr } = await db.from("schedule_sync").select("*").eq("id", 1).maybeSingle();
  if (cfgErr || !cfg) return json({ error: "нет строки настроек schedule_sync" }, 500);
  if (!cfg.enabled || !cfg.url) return json({ status: "skipped", message: "автоимпорт выключен или нет ссылки" });
  const prev: string | null = cfg.last_alert;

  try {
    const data = await downloadXlsx(cfg.url);

    // года в файле нет — берём тот, при котором числа совпадают с днями недели
    const now = moscowNow();
    let best: any = null;
    for (const y of [now.year, now.year + 1, now.year - 1]) {
      const parsed = SheetImport.parseWorkbook(XLSX, data, y);
      const errs = parsed.errors.length + parsed.blocks.reduce((n: number, b: any) => n + b.errors.length, 0);
      if (!best || errs < best.errs) best = { parsed, year: y, errs };
      if (errs === 0) break;
    }
    const { parsed, year } = best;
    if (parsed.errors.length) return await finish("error", "Не получилось прочитать файл: " + parsed.errors.join("; "), "parse:" + parsed.errors.join("|"), prev);

    // прошлые месяцы не трогаем; в файле должен быть текущий или следующий месяц
    const fileIdx = year * 12 + parsed.month, nowIdx = now.year * 12 + now.month;
    if (fileIdx < nowIdx || fileIdx > nowIdx + 1) {
      return await finish("skipped", `В файле ${parsed.monthName} ${year}: это не текущий и не следующий месяц, ничего не меняю.`, null, prev);
    }

    const mm = String(parsed.month).padStart(2, "0");
    const last = new Date(year, parsed.month, 0).getDate();
    const [pvzList, employees, shifts] = await Promise.all([
      fetchAll("pvz", (q) => q.eq("is_active", true)),
      fetchAll("employees", (q) => q),
      fetchAll("shifts", (q) => q.gte("shift_date", `${year}-${mm}-01`).lte("shift_date", `${year}-${mm}-${String(last).padStart(2, "0")}`)),
    ]);
    const plan = SheetImport.buildPlan({ parsed, year, month: parsed.month, pvzList, employees, shifts, mappings: { pvz: {}, emp: {} } });

    // 1) защита от «слишком много удалений за раз»
    if (plan.deletes.length > MAX_DELETES) {
      return await finish("attention", `Импорт остановлен: он удалил бы ${plan.deletes.length} смен за раз. Проверьте файл и примените вручную: Управление → Импорт графика.`, "del:" + plan.deletes.length, prev);
    }
    // 2) ошибки разметки блоков: сами блоки уже пропущены, остальное применяем

    // применяем
    for (let i = 0; i < plan.updates.length; i += CHUNK) {
      const { error } = await db.from("shifts").upsert(plan.updates.slice(i, i + CHUNK), { onConflict: "id" });
      if (error) throw error;
    }
    for (let i = 0; i < plan.inserts.length; i += CHUNK) {
      const { error } = await db.from("shifts").insert(plan.inserts.slice(i, i + CHUNK));
      if (error) throw error;
    }
    for (let i = 0; i < plan.deletes.length; i += CHUNK) {
      const { error } = await db.from("shifts").delete().in("id", plan.deletes.slice(i, i + CHUNK));
      if (error) throw error;
    }

    // что требует внимания человека
    const issues: string[] = [];
    if (plan.unmatchedPvz.length) issues.push("Не знаю, какой это ПВЗ: " + plan.unmatchedPvz.map((u: any) => u.title).join(", "));
    if (plan.unmatchedNames.length) issues.push("Не знаю, кто это: " + plan.unmatchedNames.map((u: any) => `${u.name} (${u.count})`).join(", "));
    if (plan.blockErrors.length) issues.push("Блоки с ошибками: " + plan.blockErrors.map((b: any) => b.title).join(", "));
    if (plan.cellErrors.length) issues.push("Непонятные ячейки: " + plan.cellErrors.slice(0, 5).map((c: any) => `${c.block} ${c.cell} «${c.raw}»`).join("; ") + (plan.cellErrors.length > 5 ? "…" : ""));
    if (plan.conflicts.length) issues.push(`Один человек в двух местах сразу: ${plan.conflicts.length}`);
    const summary = `${parsed.monthName} ${year}: создано ${plan.inserts.length}, обновлено ${plan.updates.length}, удалено ${plan.deletes.length}.`;

    if (issues.length) {
      const text = summary + "\n" + issues.join("\n") + "\nСопоставьте имена и ПВЗ в приложении: Управление → Импорт графика.";
      return await finish("attention", text, "iss:" + issues.join("|"), prev);
    }
    return await finish("ok", summary, null, prev);
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    return await finish("error", "Ошибка автоимпорта: " + msg, "err:" + msg, prev);
  }
});
