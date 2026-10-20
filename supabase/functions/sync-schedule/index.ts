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
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Кто вызвал: cron (секрет) или админ из приложения (его JWT).
// JWT проверяет сам PostgREST: спрашиваем у него auth_is_admin() с токеном вызывающего.
async function isAdminCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!auth || !apikey) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/auth_is_admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth, apikey },
      body: "{}",
    });
    return r.ok && (await r.json()) === true;
  } catch (_) {
    return false;
  }
}

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

// сетевые сбои (сброс соединения, таймаут, DNS) и 5xx Яндекса: временные, их стоит повторить
const TRANSIENT_RE = /HTTP 5\d\d|HTTP 429|error sending request|connection (reset|closed|error)|SendRequest|fetch failed|timed? ?out|aborted|network/i;

async function fetchRetry(url: string, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function downloadYandex(publicUrl: string): Promise<ArrayBuffer> {
  const api = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(publicUrl);
  const r1 = await fetchRetry(api);
  if (!r1.ok) throw new Error(`Яндекс Диск не отдал ссылку на файл (HTTP ${r1.status}). Проверьте, что доступ по ссылке включён.`);
  const { href } = await r1.json();
  if (!href) throw new Error("Яндекс Диск не вернул адрес скачивания");
  const r2 = await fetchRetry(href);
  if (!r2.ok) throw new Error(`Не удалось скачать файл (HTTP ${r2.status})`);
  return await r2.arrayBuffer();
}

// ---------- какой облачный сервис в ссылке ----------
function detectProvider(raw: string): "yandex" | "onedrive" | "sharepoint" | "unknown" {
  let host = "";
  try { host = new URL(raw.trim()).hostname.toLowerCase(); } catch { return "unknown"; }
  if (/(^|\.)(disk\.yandex\.[a-z.]+|yadi\.sk)$/.test(host)) return "yandex";
  if (host === "1drv.ms" || host === "onedrive.live.com" || host === "photos.onedrive.com") return "onedrive";
  if (/\.sharepoint\.(com|de|cn)$/.test(host)) return "sharepoint";
  return "unknown";
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// вместо файла сервис мог вернуть страницу входа/ошибки (HTML) — тогда доступ по ссылке закрыт
function ensureFile(buf: ArrayBuffer, where: string): ArrayBuffer {
  const head = new Uint8Array(buf.slice(0, 64));
  let i = 0;
  while (i < head.length && (head[i] === 32 || head[i] === 10 || head[i] === 13 || head[i] === 9)) i++;
  if (buf.byteLength < 100 || head[i] === 0x3c /* "<" */) {
    throw new Error(`${where} вернул страницу вместо файла. Откройте доступ по ссылке: «Все, у кого есть ссылка» (без входа в аккаунт).`);
  }
  return buf;
}

// OneDrive (личный): официальный адрес скачивания по ссылке «поделиться»
async function downloadOneDrive(shareUrl: string): Promise<ArrayBuffer> {
  const api = "https://api.onedrive.com/v1.0/shares/u!" + toBase64Url(shareUrl.trim()) + "/root/content";
  const r = await fetchRetry(api);
  if (r.ok) return ensureFile(await r.arrayBuffer(), "OneDrive");
  // запасной путь: прямая загрузка по самой ссылке
  return await downloadDirect(shareUrl, "OneDrive");
}

// SharePoint / рабочий OneDrive: ссылка «для всех» + параметр download=1
async function downloadDirect(shareUrl: string, name: string): Promise<ArrayBuffer> {
  const u = new URL(shareUrl.trim());
  u.searchParams.set("download", "1");
  const r = await fetchRetry(u.toString());
  if (!r.ok) {
    throw new Error(`${name} не отдал файл (HTTP ${r.status}). Откройте доступ по ссылке: «Все, у кого есть ссылка», без ограничения по организации.`);
  }
  return ensureFile(await r.arrayBuffer(), name);
}

async function downloadOnce(publicUrl: string): Promise<ArrayBuffer> {
  switch (detectProvider(publicUrl)) {
    case "yandex": return await downloadYandex(publicUrl);
    case "onedrive": return await downloadOneDrive(publicUrl);
    case "sharepoint": return await downloadDirect(publicUrl, "SharePoint");
    default:
      throw new Error("Ссылка не распознана. Поддерживаются Яндекс Диск, OneDrive и SharePoint.");
  }
}

// пробуем несколько раз с паузами и только потом сдаёмся; не временные ошибки (нет доступа, плохая ссылка) повторять нет смысла
async function downloadXlsx(publicUrl: string): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    try { return await downloadOnce(publicUrl); }
    catch (e) {
      lastErr = e;
      if (!TRANSIENT_RE.test(String((e as any)?.message ?? e))) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
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

type Link = {
  id: string; url: string; enabled: boolean;
  last_month: string | null; last_status: string | null; last_alert: string | null;
};
type Res = { id: string; status: string; message: string };

// как назвать ссылку в сообщениях: месяц из файла, иначе адрес сервиса
function linkLabel(link: Link, month?: string | null): string {
  if (month) return month;
  if (link.last_month) return link.last_month;
  try { return new URL(link.url).hostname; } catch { return "ссылка"; }
}

// записывает статус запуска в строку этой ссылки
async function finishLink(link: Link, status: string, message: string, alert: string | null, month: string | null): Promise<Res> {
  const prevAlert = link.last_alert; // до записи нового статуса
  const now = new Date().toISOString();
  await db.from("schedule_sync_links").update({
    last_run_at: now, last_status: status, last_message: message, last_alert: alert,
    last_month: month ?? link.last_month, updated_at: now,
  }).eq("id", link.id);
  // шлём админам только когда проблема новая или изменилась, а не каждые 10 минут
  if (alert && alert !== prevAlert) await notifyAdmins(`📋 График из таблицы (${linkLabel(link, month)})\n` + message);
  return { id: link.id, status, message };
}

// обрабатывает одну ссылку; usedMonths не даёт двум ссылкам на один месяц перетирать друг друга
async function syncOne(link: Link, usedMonths: Set<number>): Promise<Res> {
  try {
    const data = await downloadXlsx(link.url);

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
    const monthLabel: string | null = parsed.month ? `${parsed.monthName} ${year}` : null;
    if (parsed.errors.length) return await finishLink(link, "error", "Не получилось прочитать файл: " + parsed.errors.join("; "), "parse:" + parsed.errors.join("|"), monthLabel);

    // прошлые месяцы не трогаем; в файле должен быть текущий или следующий месяц
    const fileIdx = year * 12 + parsed.month, nowIdx = now.year * 12 + now.month;
    if (fileIdx < nowIdx || fileIdx > nowIdx + 1) {
      return await finishLink(link, "skipped", `В файле ${monthLabel}: это не текущий и не следующий месяц, ничего не меняю. Если этот месяц уже прошёл, ссылку можно удалить.`, null, monthLabel);
    }
    if (usedMonths.has(fileIdx)) {
      return await finishLink(link, "attention", `${monthLabel}: этот месяц уже обновлён из другой ссылки, эту пропускаю. Оставьте для месяца одну ссылку.`, "dup:" + fileIdx, monthLabel);
    }
    usedMonths.add(fileIdx);

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
      return await finishLink(link, "attention", `Импорт остановлен: он удалил бы ${plan.deletes.length} смен за раз. Проверьте файл и примените вручную: Управление → Импорт графика.`, "del:" + plan.deletes.length, monthLabel);
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
    const summary = `${parsed.monthName} ${year}: создано ${plan.inserts.length}, обновлено ${plan.updates.length}, удалено ${plan.deletes.length}.` +
      (plan.tentatives.length ? ` Под вопросом (пока никому не назначены): ${plan.tentatives.length}.` : "");

    if (issues.length) {
      const text = summary + "\n" + issues.join("\n") + "\nСопоставьте имена и ПВЗ в приложении: Управление → Импорт графика.";
      return await finishLink(link, "attention", text, "iss:" + issues.join("|"), monthLabel);
    }
    return await finishLink(link, "ok", summary, null, monthLabel);
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    // временный сбой (сеть, Яндекс/Microsoft 5xx, рассинхрон часов у Supabase): админам пишем, только если прошлый запуск тоже закончился ошибкой
    const transient = TRANSIENT_RE.test(msg) || /JWT issued at future/i.test(msg);
    const alert = transient && link.last_status !== "error" ? null : "err:" + msg;
    return await finishLink(link, "error", "Ошибка автоимпорта: " + msg, alert, null);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const secret = Deno.env.get("SYNC_SECRET");
  const byCron = !!secret && req.headers.get("x-sync-secret") === secret;
  // ручной запуск («Обновить сейчас»): только админ
  const manual = !byCron && (await isAdminCaller(req));
  if (!byCron && !manual) return json({ error: "forbidden" }, 403);

  const { data: links, error: linksErr } = await db.from("schedule_sync_links").select("*").order("created_at", { ascending: true });
  if (linksErr) return json({ error: "нет таблицы schedule_sync_links: выполните sql/migration_schedule_sync_links.sql" }, 500);
  const active = (links || []).filter((l: Link) => l.enabled);
  if (!active.length) return json({ status: "skipped", message: "нет включённых ссылок на график", results: [] });

  // по очереди, а не параллельно: ссылки на один месяц не должны писать в базу одновременно
  const usedMonths = new Set<number>();
  const results: Res[] = [];
  for (const link of active) results.push(await syncOne(link as Link, usedMonths));

  const rank: Record<string, number> = { error: 3, attention: 2, ok: 1, skipped: 0 };
  const worst = results.reduce((w, r) => ((rank[r.status] ?? 0) > (rank[w] ?? 0) ? r.status : w), "skipped");
  const message = results.length === 1 ? results[0].message : results.map((r, i) => `${i + 1}) ${r.message}`).join("\n");
  return json({ status: worst, message, results });
});
