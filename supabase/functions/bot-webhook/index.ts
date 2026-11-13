// deno-lint-ignore-file no-explicit-any
// supabase/functions/bot-webhook/index.ts
//
// Обрабатывает апдейты от Telegram (устанавливается как webhook бота).
// /start    — кнопка запуска мини-приложения (+ кнопка «График в чате»).
// /schedule — график прямо в чате: Сегодня / Завтра / Неделя (все ПВЗ или один)
//             и «Мои смены» с листанием по неделям. Сообщение редактируется на месте.
// В группах: /help <текст> (+фото) — бот заменяет сообщение на «Помогите пожалуйста найти <текст>»
//             и упоминает людей с доступом к камерам (employees.camera_access). Работает только
//             в чатах из таблицы help_chats; админ включает чат командой /help_here.
//             Всё остальное в группах бот игнорирует.
//             /help сам определяет ПВЗ (по названию в тексте, иначе по сегодняшней смене) и зовёт только тех,
//             кому это нужно (employees.help_pvz_ids); под сообщением кнопки «Смотрю» / «Нашли».
//             /today [ПВЗ] — кто сегодня на смене; /need <ПВЗ> <дата> [время] — «нужен человек», кнопка «Беру»;
//             /settings (админы) — включение команд, утреннее объявление, кого звать — всё кнопками.
//             Cron раз в 5 минут вызывает эту функцию с заголовком x-tick-secret (ключ из таблицы bot_secrets):
//             утреннее объявление и напоминание по /help, если никто не откликнулся.
//
// Секреты: BOT_TOKEN, WEBAPP_URL (ссылка на GitHub Pages/Vercel с фронтом)
// Необязательные: APP_TZ (часовой пояс, по умолчанию Europe/Moscow),
//                 WEBHOOK_SECRET (если задан — проверяется секрет вебхука Telegram)
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const WEBAPP_URL = Deno.env.get("WEBAPP_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ = Deno.env.get("APP_TZ") ?? "Europe/Moscow";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const PERIOD_TITLES: Record<string, string> = { "0": "Сегодня", "1": "Завтра", "w": "Неделя" };
const MAX_LEN = 3800; // лимит Telegram 4096, оставляем запас
// Статусы смен, которые не показываем в графике (значения status пока не проверены).
const HIDE_STATUSES: string[] = [];

const MENU_TEXT = "📋 <b>График ПВЗ</b>\nВыберите, что показать:";
const MAIN_KB = {
  inline_keyboard: [
    [
      { text: "📅 Сегодня", callback_data: "p:0" },
      { text: "Завтра", callback_data: "p:1" },
      { text: "Неделя", callback_data: "p:w" },
    ],
    [{ text: "🧑 Мои смены", callback_data: "my:0" }],
  ],
};

// Постоянные кнопки под полем ввода (появляются после /start и остаются всегда).
const BTN_SCHEDULE = "📋 График";
const BTN_MY = "🧑 Мои смены";
const BTN_SEEN = "🕒 Последний вход"; // только для админов
const BTN_LOST = "🔎 Потеряшки"; // только для админов
const REPLY_KB = {
  keyboard: [[{ text: BTN_SCHEDULE }, { text: BTN_MY }]],
  resize_keyboard: true,
  is_persistent: true,
};
const REPLY_KB_ADMIN = {
  keyboard: [[{ text: BTN_SCHEDULE }, { text: BTN_MY }], [{ text: BTN_SEEN }, { text: BTN_LOST }]],
  resize_keyboard: true,
  is_persistent: true,
};
// Инлайн-меню: у админов добавляется кнопка «Последний вход».
const mainKb = (isAdmin: boolean) =>
  isAdmin
    ? { inline_keyboard: [...MAIN_KB.inline_keyboard, [{ text: BTN_SEEN, callback_data: "seen" }, { text: BTN_LOST, callback_data: "lost:14" }]] }
    : MAIN_KB;
const NO_ACCESS_TEXT = "Нет доступа. Откройте приложение через /start и дождитесь подтверждения администратора.";

// ---------- Telegram ----------

async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...extra,
    }),
  });
}

async function tg(method: string, payload: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error(method, r.status, await r.text());
}

async function tgJson(method: string, payload: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) console.error(method, JSON.stringify(j));
    return j;
  } catch (e) {
    console.error(method, e);
    return { ok: false };
  }
}

async function edit(chatId: number, messageId: number, text: string, kb?: unknown) {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(kb ? { reply_markup: kb } : {}),
  });
}

// Если текст не влезает в одно сообщение: первый кусок правим на месте,
// остальные шлём новыми, кнопки навигации — под последним.
async function showChunks(chatId: number, messageId: number, chunks: string[], kb: unknown) {
  if (chunks.length === 1) {
    await edit(chatId, messageId, chunks[0], kb);
    return;
  }
  await edit(chatId, messageId, chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await sendMessage(chatId, chunks[i], i === chunks.length - 1 ? { reply_markup: kb } : {});
  }
}

// ---------- База (PostgREST, service role) ----------

async function db(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function getEmployee(tgId: number) {
  if (!Number.isInteger(tgId)) return null;
  const rows = await db(`employees?select=id,full_name,is_admin,camera_access&tg_id=eq.${tgId}&is_active=eq.true&limit=1`);
  return rows[0] ?? null;
}

// Помечаем время последней активности сотрудника в боте (если поля last_seen_at ещё нет — ошибка игнорируется).
async function touchSeen(tgId: number) {
  if (!Number.isInteger(tgId)) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/employees?tg_id=eq.${tgId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("touchSeen", e);
  }
}

async function loadPvz(onlyActive = true) {
  const filter = onlyActive ? "&is_active=eq.true" : "";
  return await db(`pvz?select=id,name,marketplace,sort_order,default_start_time,default_end_time${filter}&order=sort_order.asc`);
}

// ---------- Даты (считаем в часовом поясе TZ, а не в UTC сервера) ----------

function todayYmd(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}
function mondayOf(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}
function fmtDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${WEEKDAYS[weekdayOf(ymd)]} ${d}.${m}`;
}
function fmtShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}
const hhmm = (t: string | null) => (t ?? "").slice(0, 5);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- Графики ----------

function splitBlocks(header: string, blocks: string[]): string[] {
  const chunks: string[] = [];
  let cur = header;
  for (const b of blocks) {
    if (cur.length + b.length + 2 > MAX_LEN) {
      chunks.push(cur);
      cur = b;
    } else {
      cur += "\n\n" + b;
    }
  }
  chunks.push(cur);
  return chunks;
}

// Имя сотрудника как ссылка на его профиль в Telegram.
// Есть username — ссылка t.me (открывается у всех). Нет — ссылка по id
// (откроется, только если Telegram «знает» этого человека у смотрящего).
function nameLink(e: any): string {
  const name = esc(e.full_name ?? "—");
  const uname = String(e.tg_username ?? "").replace(/^@/, "");
  if (/^[A-Za-z0-9_]{4,32}$/.test(uname)) return `<a href="https://t.me/${uname}">${name}</a>`;
  const id = Number(e.tg_id);
  if (Number.isInteger(id) && id > 0) return `<a href="tg://user?id=${id}">${name}</a>`;
  return name;
}

function shiftLine(s: any, names: Map<string, string>): string {
  // names хранит уже готовый HTML (имя со ссылкой), повторно экранировать нельзя
  const who = s.employee_id ? (names.get(s.employee_id) ?? "—") : "<i>свободна</i>";
  return `• ${hhmm(s.start_time)}–${hhmm(s.end_time)} — ${who}`;
}

async function buildSchedule(period: string, pvzId: string, plain = false, onlyIds?: string[]): Promise<string[]> {
  const today = todayYmd();
  let from = today;
  let to = today;
  if (period === "1") {
    from = to = addDays(today, 1);
  } else if (period === "w") {
    to = addDays(today, 6);
  }
  const title = PERIOD_TITLES[period];

  const pvzList = await loadPvz();
  const selected = onlyIds
    ? pvzList.filter((p: any) => onlyIds.includes(p.id))
    : pvzId === "a" ? pvzList : pvzList.filter((p: any) => p.id === pvzId);

  let q =
    `shifts?select=shift_date,start_time,end_time,status,pvz_id,employee_id` +
    `&shift_date=gte.${from}&shift_date=lte.${to}&order=shift_date.asc,start_time.asc`;
  if (onlyIds) q += `&pvz_id=in.(${onlyIds.join(",")})`;
  else if (pvzId !== "a") q += `&pvz_id=eq.${pvzId}`;

  const [shifts, emps] = await Promise.all([db(q), db("employees?select=id,full_name,tg_id,tg_username")]);
  // plain: просто имена без ссылок — в группе ссылки tg://user?id= упоминают людей и шлют им уведомление
  const names = new Map<string, string>(emps.map((e: any) => [e.id, plain ? esc(e.full_name ?? "—") : nameLink(e)]));
  const visible = shifts.filter((s: any) => !HIDE_STATUSES.includes(s.status ?? ""));

  const range = from === to ? `${title}, ${fmtDay(from)}` : `${title}: ${fmtDay(from)} – ${fmtDay(to)}`;
  let header = `📅 <b>${range}</b>`;
  if (pvzId !== "a") header += `\n${mpDot(selected[0])} ${esc(selected[0]?.name ?? "ПВЗ")}`;

  const blocks: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = visible.filter((s: any) => s.shift_date === date);
    const lines: string[] = [];
    if (pvzId === "a") {
      for (const p of selected) {
        const ps = day.filter((s: any) => s.pvz_id === p.id);
        if (!ps.length) continue;
        lines.push(`${mpDot(p)} <b>${esc(p.name)}</b>${p.marketplace ? ` (${esc(p.marketplace)})` : ""}`);
        for (const s of ps) lines.push(shiftLine(s, names));
      }
    } else {
      for (const s of day) lines.push(shiftLine(s, names));
    }
    const body = lines.length ? lines.join("\n") : "<i>смен нет</i>";
    blocks.push(from === to ? body : `<b>${fmtDay(date)}</b>\n${body}`);
  }
  return splitBlocks(header, blocks);
}

// кружок по площадке: Ozon — синий, WB — фиолетово-розовый
const mpDot = (p: any) => {
  const m = String(p?.marketplace ?? "").toLowerCase();
  return m === "ozon" ? "🔵" : m === "wb" ? "🟣" : "⚪";
};

async function buildMy(empId: string, offset: number) {
  const mon = addDays(mondayOf(todayYmd()), offset * 7);
  const sun = addDays(mon, 6);

  const [shifts, pvzList] = await Promise.all([
    db(
      `shifts?select=shift_date,start_time,end_time,status,pvz_id&employee_id=eq.${empId}` +
        `&shift_date=gte.${mon}&shift_date=lte.${sun}&order=shift_date.asc,start_time.asc`,
    ),
    loadPvz(false),
  ]);
  const pvzNames = new Map<string, string>(pvzList.map((p: any) => [p.id, p.name]));
  const visible = shifts.filter((s: any) => !HIDE_STATUSES.includes(s.status ?? ""));

  let text = `🧑 <b>Мои смены</b>\n${fmtShort(mon)} – ${fmtShort(sun)}${offset === 0 ? " (эта неделя)" : ""}\n\n`;
  text += visible.length
    ? visible
      .map((s: any) =>
        `<b>${fmtDay(s.shift_date)}</b> — ${esc(pvzNames.get(s.pvz_id) ?? "ПВЗ")}, ${hhmm(s.start_time)}–${hhmm(s.end_time)}`
      )
      .join("\n")
    : "<i>Смен на этой неделе нет.</i>";

  const kb = {
    inline_keyboard: [
      [
        { text: "← Пред. неделя", callback_data: `my:${offset - 1}` },
        { text: "След. неделя →", callback_data: `my:${offset + 1}` },
      ],
      [{ text: "← Меню", callback_data: "m" }],
    ],
  };
  return { text, kb };
}

function fmtSeen(iso: string): string {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  const today = todayYmd();
  if (ymd === today) return `сегодня в ${time}`;
  if (ymd === addDays(today, -1)) return `вчера в ${time}`;
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)} в ${time}`;
}

// Список «кто когда последний раз заходил» (для админов): свежие сверху.
async function buildSeen(): Promise<string[]> {
  const rows = await db(
    "employees?select=full_name,real_name,tg_username,tg_id,last_seen_at&is_active=eq.true&order=last_seen_at.desc.nullslast,full_name.asc&limit=300",
  );
  const label = (e: any) => nameLink({ ...e, full_name: e.real_name || e.full_name });
  const seen = rows.filter((e) => e.last_seen_at);
  const unknown = rows.filter((e) => !e.last_seen_at && Number(e.tg_id) > 0);
  const never = rows.filter((e) => !e.last_seen_at && !(Number(e.tg_id) > 0));

  const lines: string[] = ["🕒 <b>Последний вход</b>", ""];
  for (const e of seen) lines.push(`• ${label(e)} — ${fmtSeen(e.last_seen_at)}`);
  if (!seen.length) lines.push("<i>Пока никто не заходил после включения учёта.</i>");
  if (unknown.length) {
    lines.push("", "<b>Нет данных</b> (заходили раньше, чем появился учёт):");
    for (const e of unknown) lines.push(`• ${label(e)}`);
  }
  if (never.length) {
    lines.push("", "<b>Ещё не открывали бота:</b>");
    for (const e of never) lines.push(`• ${label(e)}`);
  }

  const chunks: string[] = [];
  let cur = "";
  for (const l of lines) {
    if (cur && cur.length + l.length + 1 > MAX_LEN) {
      chunks.push(cur);
      cur = l;
    } else {
      cur = cur ? cur + "\n" + l : l;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// «Потеряшки» (для админов): кто давно не выходил на смены. Порог в днях зашит в callback_data и меняется кнопками.
const LOST_DEFAULT_DAYS = 14;
const LOST_MAX_DAYS = 365;

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400000);
}

async function buildLost(days: number): Promise<{ chunks: string[]; kb: unknown }> {
  const today = todayYmd();
  const [emps, shifts] = await Promise.all([
    db("employees?select=id,full_name,real_name,tg_username,tg_id&is_active=eq.true&order=full_name.asc&limit=300"),
    db("shifts?select=employee_id,shift_date&employee_id=not.is.null&status=in.(assigned,confirmed)&order=shift_date.desc&limit=10000"),
  ]);
  const last = new Map<string, string>(); // последняя прошедшая смена
  const upcoming = new Set<string>(); // есть смена сегодня или позже
  for (const s of shifts) {
    if (s.shift_date >= today) upcoming.add(s.employee_id);
    else if (!last.has(s.employee_id)) last.set(s.employee_id, s.shift_date); // отсортировано по убыванию
  }
  const label = (e: any) => nameLink({ ...e, full_name: e.real_name || e.full_name });
  const lost: { e: any; gap: number; date: string }[] = [];
  const noShifts: any[] = [];
  for (const e of emps) {
    if (upcoming.has(e.id)) continue; // скоро выйдет — не потеряшка
    const d = last.get(e.id);
    if (!d) noShifts.push(e);
    else if (daysBetween(d, today) >= days) lost.push({ e, gap: daysBetween(d, today), date: d });
  }
  lost.sort((a, b) => b.gap - a.gap);

  const lines: string[] = [`🔎 <b>Потеряшки</b> — без смен ${days}+ дн.`, ""];
  for (const l of lost) lines.push(`• ${label(l.e)} — ${l.gap} дн. (последняя ${fmtShort(l.date)})`);
  if (!lost.length) lines.push("<i>Таких нет 🎉</i>");
  if (noShifts.length) {
    lines.push("", "<b>Нет смен в графике:</b>");
    for (const e of noShifts) lines.push(`• ${label(e)}`);
  }
  lines.push("", "<i>Кто уже стоит в графике на сегодня или позже — не показан.</i>");

  const chunks: string[] = [];
  let cur = "";
  for (const l of lines) {
    if (cur && cur.length + l.length + 1 > MAX_LEN) {
      chunks.push(cur);
      cur = l;
    } else {
      cur = cur ? cur + "\n" + l : l;
    }
  }
  if (cur) chunks.push(cur);

  const mk = (n: number) => `lost:${Math.min(LOST_MAX_DAYS, Math.max(1, n))}`;
  const preset = (n: number) => ({ text: n === days ? `• ${n} •` : `${n}`, callback_data: mk(n) });
  const kb = {
    inline_keyboard: [
      [preset(7), preset(14), preset(21), preset(30)],
      [
        { text: "−1 дн.", callback_data: mk(days - 1) },
        { text: "+1 дн.", callback_data: mk(days + 1) },
        { text: "−7", callback_data: mk(days - 7) },
        { text: "+7", callback_data: mk(days + 7) },
      ],
      [{ text: "← Меню", callback_data: "m" }],
    ],
  };
  return { chunks, kb };
}

async function pvzKeyboard(period: string) {
  const pvz = await loadPvz();
  const rows: any[][] = [[{ text: "🏬 Все ПВЗ", callback_data: `s:${period}:a` }]];
  for (let i = 0; i < pvz.length; i += 2) {
    rows.push(pvz.slice(i, i + 2).map((p: any) => ({ text: p.name, callback_data: `s:${period}:${p.id}` })));
  }
  rows.push([{ text: "← Меню", callback_data: "m" }]);
  return { inline_keyboard: rows };
}

// ---------- Нажатия кнопок ----------

async function handleCallback(cb: any) {
  const data: string = cb.data ?? "";
  const chatId: number | undefined = cb.message?.chat?.id;
  const messageId: number | undefined = cb.message?.message_id;

  const emp = await getEmployee(cb.from?.id);
  if (!emp || !chatId || !messageId) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Нет доступа", show_alert: true });
    return;
  }
  // кнопки рабочего чата (/help, /need, /settings) сами отвечают на нажатие
  try {
    if (await handleToolsCallback(cb, emp)) {
      await touchSeen(cb.from?.id);
      return;
    }
  } catch (e) {
    console.error("tools callback error", e);
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Что-то пошло не так, попробуйте ещё раз", show_alert: true });
    return;
  }
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  await touchSeen(cb.from?.id);

  try {
    if (data === "n") {
      await sendMessage(chatId, MENU_TEXT, { reply_markup: mainKb(!!emp.is_admin) });
      return;
    }
    if (data === "m") {
      await edit(chatId, messageId, MENU_TEXT, mainKb(!!emp.is_admin));
      return;
    }
    if (data === "seen") {
      if (!emp.is_admin) return;
      for (const chunk of await buildSeen()) await sendMessage(chatId, chunk);
      return;
    }
    const lostM = data.match(/^lost:(\d{1,3})$/);
    if (lostM) {
      if (!emp.is_admin) return;
      const days = Math.min(LOST_MAX_DAYS, Math.max(1, Number(lostM[1])));
      const r = await buildLost(days);
      await showChunks(chatId, messageId, r.chunks, r.kb);
      return;
    }

    // «Всё в порядке» под рассылкой «сверьте смены» (рассылает функция broadcast-check)
    const chk = data.match(/^chk:([0-9a-fA-F-]{36})$/);
    if (chk) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/schedule_check_replies?check_id=eq.${chk[1]}&employee_id=eq.${emp.id}`,
        {
          method: "PATCH",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({ status: "ok", confirmed_at: new Date().toISOString() }),
        },
      );
      const rows = r.ok ? await r.json() : [];
      if (rows.length) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `${cb.message?.text ?? ""}\n\n✅ Отмечено, спасибо!`,
          reply_markup: { inline_keyboard: [] },
        });
      }
      return;
    }

    const p = data.match(/^p:(0|1|w)$/);
    if (p) {
      await edit(chatId, messageId, `Выберите ПВЗ (${PERIOD_TITLES[p[1]].toLowerCase()}):`, await pvzKeyboard(p[1]));
      return;
    }

    const s = data.match(/^s:(0|1|w):(a|[0-9a-fA-F-]{36})$/);
    if (s) {
      const chunks = await buildSchedule(s[1], s[2]);
      await showChunks(chatId, messageId, chunks, {
        inline_keyboard: [
          [{ text: "← Другой ПВЗ", callback_data: `p:${s[1]}` }],
          [{ text: "← Меню", callback_data: "m" }],
        ],
      });
      return;
    }

    const my = data.match(/^my:(-?\d{1,2})$/);
    if (my) {
      const { text, kb } = await buildMy(emp.id, Number(my[1]));
      await edit(chatId, messageId, text, kb);
      return;
    }
  } catch (e) {
    console.error("callback error", e);
    await sendMessage(chatId, "⚠️ Не удалось загрузить график. Попробуйте ещё раз чуть позже.");
  }
}

// ---------- Рабочий чат: /help, /today, /need, /settings ----------
//
// Включение чата: админ пишет /help_here. Дальше всё настраивается кнопками командой /settings (только админы):
// какие команды работают, время утреннего объявления, через сколько напомнить по /help, кого звать на каких ПВЗ.

const RE_HELP_HERE = /^\/(?:help_here|помогите_здесь)(?:@\w+)?(?:\s|$)/i;
const RE_HELP = /^\/(?:help|помогите)(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const RE_TODAY = /^\/(?:today|сегодня)(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const RE_NEED = /^\/(?:need|нужен)(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const RE_SETTINGS = /^\/(?:settings|настройки)(?:@\w+)?(?:\s|$)/i;

const toMin = (t: string | null) => {
  const [h, m] = String(t ?? "0:0").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
function nowMinutes(): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const [h, m] = p.split(":").map(Number);
  return (h % 24) * 60 + m;
}
const pad2 = (n: number) => String(n).padStart(2, "0");

async function dbReq(method: string, path: string, body?: unknown): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`db ${method} ${path} ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

async function botCanDelete(chatId: number): Promise<boolean> {
  const me = await tgJson("getMe", {});
  const id = me?.result?.id;
  if (!id) return false;
  const cm = await tgJson("getChatMember", { chat_id: chatId, user_id: id });
  const r = cm?.result;
  return r?.status === "creator" || (r?.status === "administrator" && r?.can_delete_messages === true);
}

async function getChat(chatId: number): Promise<any | null> {
  const rows = await db(`help_chats?select=*&chat_id=eq.${chatId}&limit=1`);
  return rows[0] ?? null;
}

// Меню команд (кнопка «/» в чате) показывает только включённые команды.
async function refreshCommands(chatId: number, c: any) {
  const commands: { command: string; description: string }[] = [];
  if (c.help_on) commands.push({ command: "help", description: "Позвать тех, кто смотрит камеры" });
  if (c.today_on) commands.push({ command: "today", description: "Кто сегодня на смене" });
  if (c.need_on) commands.push({ command: "need", description: "Нужен человек на смену" });
  await tgJson("setMyCommands", { commands, scope: { type: "chat", chat_id: chatId } });
}

// ---------- Определение ПВЗ по тексту ----------

const WB_WORDS = ["wb", "вб", "wildberries"];
const OZON_WORDS = ["ozon", "озон"];
const normText = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const wordsOf = (s: string) => normText(s).split(/[^а-яa-z0-9]+/).filter(Boolean);

// Ищет ПВЗ по названию в тексте: «Тургенева», «ярославка 1 озон». Пустой результат — не нашли.
function matchPvz(text: string, pvzList: any[]): any[] {
  const words = wordsOf(text);
  if (!words.length) return [];
  const wantWb = words.some((w) => WB_WORDS.includes(w) || w.startsWith("вайлд"));
  const wantOzon = words.some((w) => OZON_WORDS.includes(w) || w.startsWith("озон"));
  const present = new Set(words.filter((w) => /^\d+$/.test(w)));

  let cand = pvzList.filter((p) => {
    const pw = wordsOf(p.name ?? "");
    const stems = pw.filter((w) => /[а-яa-z]/.test(w) && w.length >= 4 && !WB_WORDS.includes(w) && !OZON_WORDS.includes(w))
      .map((w) => w.slice(0, 5));
    return stems.length > 0 && stems.every((s) => words.some((w) => w.startsWith(s)));
  });
  // цифры в названии («Ярославский 1») сужают выбор, если названы в тексте
  const byNum = cand.filter((p) => wordsOf(p.name ?? "").some((w) => /^\d+$/.test(w) && present.has(w)));
  if (byNum.length) cand = byNum;
  // WB / Ozon сужают выбор, если названы (оба или ни одного — не сужаем)
  if (wantWb !== wantOzon) {
    const mp = wantWb ? "wb" : "ozon";
    const byMp = cand.filter((p) => p.marketplace === mp);
    if (byMp.length) cand = byMp;
  }
  return cand;
}

async function pvzOfEmployeeToday(empId: string): Promise<string[]> {
  const rows = await db(`shifts?select=pvz_id&employee_id=eq.${empId}&shift_date=eq.${todayYmd()}`);
  return [...new Set(rows.map((r: any) => r.pvz_id))] as string[];
}

// Кого звать: если ПВЗ известен — только тех, у кого в help_pvz_ids этот ПВЗ (или не задано = все).
function scopeTargets(people: any[], pvzIds: string[] | null): any[] {
  if (!pvzIds?.length) return people;
  return people.filter((e) => !e.help_pvz_ids?.length || e.help_pvz_ids.some((id: string) => pvzIds.includes(id)));
}

// ---------- /help ----------

function renderHelp(r: any): string {
  let t = r.body;
  const w = r.watchers ?? [];
  if (w.length) t += `\n\n👀 <b>Смотрят:</b> ${w.map((x: any) => esc(x.name)).join(", ")}`;
  if (r.status === "found") t += `\n\n✅ <b>Нашли</b>`;
  return t;
}
const helpKb = (id: string) => ({
  inline_keyboard: [[
    { text: "👀 Смотрю", callback_data: `hw:${id}` },
    { text: "✅ Нашли", callback_data: `hf:${id}` },
  ]],
});
async function editHelp(r: any) {
  const reply_markup = r.status === "found" ? { inline_keyboard: [] } : helpKb(r.id);
  if (r.is_photo) {
    await tg("editMessageCaption", { chat_id: r.chat_id, message_id: r.message_id, caption: renderHelp(r), parse_mode: "HTML", reply_markup });
  } else {
    await tg("editMessageText", {
      chat_id: r.chat_id,
      message_id: r.message_id,
      text: renderHelp(r),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup,
    });
  }
}

async function handleHelp(msg: any, chat: any, arg: string | undefined) {
  const chatId: number = msg.chat.id;
  const sender = await getEmployee(msg.from?.id);
  if (!sender) return; // только сотрудники

  const people = await db(
    "employees?select=id,full_name,tg_id,tg_username,help_pvz_ids&camera_access=eq.true&is_active=eq.true&tg_id=gt.0&order=full_name.asc",
  );
  let targets = people.filter((e: any) => e.tg_id !== msg.from?.id);

  // ПВЗ: сначала по названию в тексте, иначе по сегодняшней смене отправителя
  const note = (arg ?? "").trim().slice(0, 300);
  const pvzList = await loadPvz();
  let pvzIds: string[] = matchPvz(note, pvzList).map((p: any) => p.id);
  if (!pvzIds.length) pvzIds = await pvzOfEmployeeToday(sender.id);
  targets = scopeTargets(targets, pvzIds);
  if (!targets.length) return;

  const mentions = targets.map((e: any) => {
    const u = String(e.tg_username ?? "").replace(/^@/, "");
    return /^[A-Za-z0-9_]{4,32}$/.test(u)
      ? `@${u}`
      : `<a href="tg://user?id=${e.tg_id}">${esc(e.full_name ?? "—")}</a>`;
  }).join(", ");

  const names = pvzIds.map((id) => pvzList.find((p: any) => p.id === id)?.name).filter(Boolean);
  const pvzLine = names.length && names.length <= 3 ? `\n🏬 ${esc(names.join(", "))}` : "";
  const head = note ? `🆘 <b>Помогите пожалуйста найти</b> ${esc(note)}` : "🆘 <b>Нужна помощь</b>";
  const body = `${head}${pvzLine}\n\n${mentions}\n\n<i>просит: ${esc(sender.full_name ?? "—")}</i>`;

  const photo: string | undefined = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : undefined;
  const onlyPhotoOrText = !!photo || (!!msg.text && !msg.photo && !msg.video && !msg.document && !msg.animation);

  const [req] = await dbReq("POST", "help_requests", {
    chat_id: chatId,
    is_photo: !!photo,
    body,
    mentions,
    pvz_ids: pvzIds.length ? pvzIds : null,
    sender_id: sender.id,
  });
  const reply_markup = helpKb(req.id);
  const finish = async (sent: any) => {
    if (sent?.result?.message_id) await dbReq("PATCH", `help_requests?id=eq.${req.id}`, { message_id: sent.result.message_id });
  };

  // заменяем сообщение: удаляем исходное и публикуем новое (с тем же фото)
  if (onlyPhotoOrText && await botCanDelete(chatId)) {
    const sent = photo
      ? await tgJson("sendPhoto", { chat_id: chatId, photo, caption: body, parse_mode: "HTML", reply_markup })
      : await tgJson("sendMessage", {
        chat_id: chatId,
        text: body,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup,
      });
    if (sent?.ok) {
      await finish(sent);
      await tgJson("deleteMessage", { chat_id: chatId, message_id: msg.message_id });
      return;
    }
  }

  // запасной вариант: ответ на исходное сообщение
  const sent = await tgJson("sendMessage", {
    chat_id: chatId,
    text: body,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
  await finish(sent);
  if (photo) await dbReq("PATCH", `help_requests?id=eq.${req.id}`, { is_photo: false });
}

// ---------- /today ----------

async function buildToday(arg?: string): Promise<string[]> {
  const a = (arg ?? "").trim();
  if (!a) return await buildSchedule("0", "a", true);
  const found = matchPvz(a, await loadPvz());
  if (!found.length) return [`Не нашла ПВЗ «${esc(a.slice(0, 40))}». Например: /today Тургенева или /today Некрасовский Ozon`];
  return await buildSchedule("0", "a", true, found.map((p: any) => p.id));
}

// ---------- /need — «нужен человек на смену» ----------

function parseNeed(arg: string, pvzList: any[]): { error?: string; pvz?: any; date?: string; start?: string; end?: string } {
  const example = "\nПример: /need Тургенева WB завтра с 17\n(дата: сегодня, завтра, послезавтра или 15.11; время: с 17, до 15, 10-22 — без времени будет полная смена)";
  const found = matchPvz(arg, pvzList);
  if (!found.length) return { error: "Не поняла, какой ПВЗ." + example };
  if (found.length > 1) return { error: `Уточните ПВЗ: ${found.map((p: any) => p.name).join(" или ")}.` };
  const pvz = found[0];

  let t = normText(arg);
  const today = todayYmd();
  let date: string | undefined;
  const dm = t.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
    date = `${y}-${pad2(Number(dm[2]))}-${pad2(Number(dm[1]))}`;
    t = t.replace(dm[0], " ");
  } else if (/послезавтра/.test(t)) date = addDays(today, 2);
  else if (/завтра/.test(t)) date = addDays(today, 1);
  else if (/сегодня/.test(t)) date = today;
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: "Не поняла дату." + example };
  if (date < today) return { error: "Эта дата уже прошла." };

  const hm = (h: string, m?: string) => `${pad2(Number(h))}:${m ?? "00"}`;
  let start = String(pvz.default_start_time ?? "09:00").slice(0, 5);
  let end = String(pvz.default_end_time ?? "21:00").slice(0, 5);
  const range = t.match(/(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/);
  if (range) {
    start = hm(range[1], range[2]);
    end = hm(range[3], range[4]);
  } else {
    const from = t.match(/(?:^|\s)с\s*(\d{1,2})(?::(\d{2}))?/);
    const to = t.match(/(?:^|\s)до\s*(\d{1,2})(?::(\d{2}))?/);
    if (from) start = hm(from[1], from[2]);
    if (to) end = hm(to[1], to[2]);
  }
  if (Number(start.slice(0, 2)) > 23 || Number(end.slice(0, 2)) > 23 || start >= end) {
    return { error: "Не поняла время: начало должно быть раньше конца." + example };
  }
  return { pvz, date, start, end };
}

const needText = (r: any, pvzName: string, who: string) =>
  `🙋 <b>Нужен человек на смену</b>\n🏬 ${esc(pvzName)}\n📅 ${fmtDay(r.shift_date)} · ${hhmm(r.start_time)}–${hhmm(r.end_time)}\n\n<i>просит: ${esc(who)}</i>`;
const needKb = (id: string) => ({
  inline_keyboard: [[
    { text: "🙋 Беру", callback_data: `nt:${id}` },
    { text: "✖ Отменить", callback_data: `nc:${id}` },
  ]],
});

async function handleNeed(msg: any, arg: string | undefined) {
  const chatId: number = msg.chat.id;
  const sender = await getEmployee(msg.from?.id);
  if (!sender) return;
  const reply = (text: string) =>
    sendMessage(chatId, text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });

  const p = parseNeed(arg ?? "", await loadPvz());
  if (p.error) {
    await reply(esc(p.error));
    return;
  }
  const [req] = await dbReq("POST", "need_requests", {
    chat_id: chatId,
    pvz_id: p.pvz.id,
    shift_date: p.date,
    start_time: p.start,
    end_time: p.end,
    created_by: sender.id,
  });
  const sent = await tgJson("sendMessage", {
    chat_id: chatId,
    text: needText(req, p.pvz.name, sender.full_name ?? "—"),
    parse_mode: "HTML",
    reply_markup: needKb(req.id),
  });
  if (sent?.result?.message_id) await dbReq("PATCH", `need_requests?id=eq.${req.id}`, { message_id: sent.result.message_id });
}

async function notifyAdmins(text: string) {
  const admins = await db("employees?select=tg_id&is_admin=eq.true&is_active=eq.true&tg_id=gt.0");
  for (const a of admins) await sendMessage(a.tg_id, text);
}

// ---------- /settings ----------

const onOff = (b: boolean) => (b ? "✅ вкл" : "⬜ выкл");
function settingsText(c: any): string {
  return "⚙️ <b>Настройки бота в этом чате</b>\n\n" +
    `/help — позвать тех, кто смотрит камеры: <b>${c.help_on ? "вкл" : "выкл"}</b>\n` +
    `/today — кто сегодня на смене: <b>${c.today_on ? "вкл" : "выкл"}</b>\n` +
    `/need — нужен человек на смену: <b>${c.need_on ? "вкл" : "выкл"}</b>\n` +
    `☀️ Утреннее объявление (без звука): <b>${c.morning_on ? `вкл, ${hhmm(c.morning_time)}` : "выкл"}</b>\n` +
    `⏰ Напоминание по /help: <b>${c.remind_min > 0 ? `через ${c.remind_min} мин` : "выкл"}</b>`;
}
function settingsKb(c: any) {
  return {
    inline_keyboard: [
      [{ text: `/help ${onOff(c.help_on)}`, callback_data: "st:t:help_on" }, { text: `/today ${onOff(c.today_on)}`, callback_data: "st:t:today_on" }],
      [{ text: `/need ${onOff(c.need_on)}`, callback_data: "st:t:need_on" }, { text: `☀️ Объявление ${onOff(c.morning_on)}`, callback_data: "st:t:morning_on" }],
      [{ text: "🕗 Время объявления", callback_data: "st:tm" }, { text: "⏰ Напоминание /help", callback_data: "st:r" }],
      [{ text: "👥 Кого звать по /help", callback_data: "st:p" }],
      [{ text: "Закрыть", callback_data: "st:x" }],
    ],
  };
}
const backRow = [{ text: "← Настройки", callback_data: "st:m" }];

async function showSettings(chatId: number, messageId: number | null, c: any) {
  if (messageId) await edit(chatId, messageId, settingsText(c), settingsKb(c));
  else await sendMessage(chatId, settingsText(c), { reply_markup: settingsKb(c) });
}

async function helpPeople(): Promise<any[]> {
  return await db("employees?select=id,full_name,help_pvz_ids&camera_access=eq.true&is_active=eq.true&order=full_name.asc");
}

async function handleSettingsCallback(cb: any, emp: any) {
  const data: string = cb.data;
  const chatId: number = cb.message.chat.id;
  const messageId: number = cb.message.message_id;
  const ans = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, ...(text ? { text, show_alert: true } : {}) });
  if (!emp.is_admin) return await ans("Настройки доступны только администраторам");
  const chat = await getChat(chatId);
  if (!chat) return await ans("Чат не подключён: напишите /help_here");
  await ans();

  if (data === "st:x") return await tg("deleteMessage", { chat_id: chatId, message_id: messageId });
  if (data === "st:m") return await showSettings(chatId, messageId, chat);

  let m = data.match(/^st:t:(help_on|today_on|need_on|morning_on)$/);
  if (m) {
    const patch: any = { [m[1]]: !chat[m[1]] };
    // если время объявления сегодня уже прошло, первое объявление будет завтра
    if (m[1] === "morning_on" && patch.morning_on) patch.morning_last = nowMinutes() >= toMin(chat.morning_time) ? todayYmd() : null;
    const [c] = await dbReq("PATCH", `help_chats?chat_id=eq.${chatId}`, patch);
    await refreshCommands(chatId, c);
    return await showSettings(chatId, messageId, c);
  }

  if (data === "st:tm") {
    const times = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "11:00"];
    const rows: any[][] = [];
    for (let i = 0; i < times.length; i += 4) {
      rows.push(times.slice(i, i + 4).map((t) => ({ text: t === hhmm(chat.morning_time) ? `• ${t} •` : t, callback_data: `st:s:${t.replace(":", "")}` })));
    }
    rows.push(backRow);
    return await edit(chatId, messageId, "🕗 <b>Во сколько присылать утреннее объявление?</b> (по Москве)", { inline_keyboard: rows });
  }
  m = data.match(/^st:s:(\d{2})(\d{2})$/);
  if (m) {
    const [c] = await dbReq("PATCH", `help_chats?chat_id=eq.${chatId}`, {
      morning_time: `${m[1]}:${m[2]}`,
      morning_on: true,
      morning_last: nowMinutes() >= toMin(`${m[1]}:${m[2]}`) ? todayYmd() : null,
    });
    return await showSettings(chatId, messageId, c);
  }

  if (data === "st:r") {
    const opts = [5, 10, 15, 30, 0];
    return await edit(chatId, messageId, "⏰ <b>Через сколько минут напомнить, если на /help никто не откликнулся?</b>", {
      inline_keyboard: [
        opts.map((n) => ({ text: (n === chat.remind_min ? "• " : "") + (n ? `${n} мин` : "выкл") + (n === chat.remind_min ? " •" : ""), callback_data: `st:rv:${n}` })),
        backRow,
      ],
    });
  }
  m = data.match(/^st:rv:(\d{1,3})$/);
  if (m) {
    const [c] = await dbReq("PATCH", `help_chats?chat_id=eq.${chatId}`, { remind_min: Number(m[1]) });
    return await showSettings(chatId, messageId, c);
  }

  // кого звать по /help: список людей с доступом к камерам и экран выбора ПВЗ для каждого
  if (data === "st:p") {
    const [people, pvzList] = await Promise.all([helpPeople(), loadPvz()]);
    const rows = people.map((e: any) => ({
      text: `${e.full_name} — ${e.help_pvz_ids?.length ? `${e.help_pvz_ids.length} из ${pvzList.length} ПВЗ` : "все ПВЗ"}`,
      callback_data: `st:pe:${e.id}`,
    }));
    return await edit(
      chatId,
      messageId,
      "👥 <b>Кого звать по /help</b>\nСписок — те, у кого включён «Доступ к камерам». Выберите человека, чтобы задать, на каких ПВЗ его звать.",
      { inline_keyboard: [...rows.map((r) => [r]), backRow] },
    );
  }
  m = data.match(/^st:pe:([0-9a-fA-F-]{36})$/) ?? data.match(/^st:pp:([0-9a-fA-F-]{36}):(\d{1,2}|a)$/);
  if (m) {
    const empId = m[1];
    const [people, pvzList] = await Promise.all([helpPeople(), loadPvz()]);
    let person = people.find((e: any) => e.id === empId);
    if (!person) return;
    const allIds = pvzList.map((p: any) => p.id);
    if (data.startsWith("st:pp:")) {
      const cur: string[] = person.help_pvz_ids?.length ? person.help_pvz_ids : allIds;
      let next: string[] | null;
      if (m[2] === "a") next = null;
      else {
        const id = pvzList[Number(m[2])]?.id;
        if (!id) return;
        next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        if (!next.length) return await ans("Оставьте хотя бы один ПВЗ");
        if (next.length === allIds.length) next = null;
      }
      await dbReq("PATCH", `employees?id=eq.${empId}`, { help_pvz_ids: next });
      person = { ...person, help_pvz_ids: next };
    }
    const scope: string[] = person.help_pvz_ids?.length ? person.help_pvz_ids : allIds;
    const rows = pvzList.map((p: any, i: number) => [{
      text: `${scope.includes(p.id) ? "✅" : "⬜"} ${p.name}`,
      callback_data: `st:pp:${empId}:${i}`,
    }]);
    rows.push([{ text: "Звать на всех ПВЗ", callback_data: `st:pp:${empId}:a` }]);
    rows.push([{ text: "← К списку", callback_data: "st:p" }]);
    return await edit(
      chatId,
      messageId,
      `👥 <b>${esc(person.full_name)}</b>\nНа каких ПВЗ звать по /help. Если ПВЗ в сообщении не определился — зовём всех.`,
      { inline_keyboard: rows },
    );
  }
}

// ---------- Кнопки под сообщениями чата ----------

async function handleToolsCallback(cb: any, emp: any): Promise<boolean> {
  const data: string = cb.data ?? "";
  if (!/^(?:h[wf]|n[tc]|st):/.test(data)) return false;
  const ans = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, ...(text ? { text, show_alert: true } : {}) });

  if (data.startsWith("st:")) {
    await handleSettingsCallback(cb, emp);
    return true;
  }

  // /help: «Смотрю» / «Нашли»
  let m = data.match(/^h([wf]):([0-9a-fA-F-]{36})$/);
  if (m) {
    const [r] = await db(`help_requests?select=*&id=eq.${m[2]}&limit=1`);
    if (!r) { await ans("Заявка не найдена"); return true; }
    if (r.status === "found") { await ans("Уже нашли ✅"); return true; }
    if (m[1] === "w") {
      if (!emp.camera_access) { await ans("Эта кнопка для тех, у кого есть доступ к камерам"); return true; }
      const cur: any[] = r.watchers ?? [];
      const next = cur.some((x) => x.id === emp.id)
        ? cur.filter((x) => x.id !== emp.id)
        : [...cur, { id: emp.id, name: emp.full_name }];
      const [u] = await dbReq("PATCH", `help_requests?id=eq.${r.id}`, { watchers: next });
      await ans();
      await editHelp(u);
    } else {
      if (r.sender_id !== emp.id && !emp.is_admin) { await ans("Отметить «Нашли» может тот, кто отправил запрос"); return true; }
      const [u] = await dbReq("PATCH", `help_requests?id=eq.${r.id}`, { status: "found" });
      await ans();
      await editHelp(u);
    }
    return true;
  }

  // /need: «Беру» / «Отменить»
  m = data.match(/^n([tc]):([0-9a-fA-F-]{36})$/);
  if (m) {
    const [r] = await db(`need_requests?select=*&id=eq.${m[2]}&limit=1`);
    if (!r) { await ans("Заявка не найдена"); return true; }
    if (r.status !== "open") { await ans(r.status === "taken" ? "Смену уже заняли" : "Заявка отменена"); return true; }
    const pvz = (await db(`pvz?select=name&id=eq.${r.pvz_id}&limit=1`))[0];
    const creator = r.created_by ? (await db(`employees?select=full_name&id=eq.${r.created_by}&limit=1`))[0] : null;
    const base = needText(r, pvz?.name ?? "ПВЗ", creator?.full_name ?? "—");
    const finish = (extra: string) =>
      tg("editMessageText", {
        chat_id: r.chat_id,
        message_id: r.message_id ?? cb.message.message_id,
        text: `${base}\n\n${extra}`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });

    if (m[1] === "c") {
      if (r.created_by !== emp.id && !emp.is_admin) { await ans("Отменить может тот, кто создал заявку, или админ"); return true; }
      await dbReq("PATCH", `need_requests?id=eq.${r.id}&status=eq.open`, { status: "cancelled" });
      await ans();
      await finish("✖ <b>Отменено</b>");
      return true;
    }

    if (r.created_by === emp.id) { await ans("Это ваша заявка"); return true; }
    const mine = await db(`shifts?select=start_time,end_time&employee_id=eq.${emp.id}&shift_date=eq.${r.shift_date}`);
    if (mine.some((s: any) => String(s.start_time) < String(r.end_time) && String(s.end_time) > String(r.start_time))) {
      await ans("У вас уже есть смена в это время");
      return true;
    }
    // занять заявку «атомарно»: сработает только у первого нажавшего
    const claimed = await dbReq("PATCH", `need_requests?id=eq.${r.id}&status=eq.open`, { status: "taken", taken_by: emp.id });
    if (!claimed.length) { await ans("Смену уже заняли"); return true; }
    try {
      await dbReq("POST", "shifts", {
        pvz_id: r.pvz_id,
        employee_id: emp.id,
        shift_date: r.shift_date,
        start_time: r.start_time,
        end_time: r.end_time,
        status: "confirmed",
        source: "chat",
      });
    } catch (e) {
      console.error("need take: shift insert", e);
      await dbReq("PATCH", `need_requests?id=eq.${r.id}`, { status: "open", taken_by: null });
      await ans("Не получилось записать смену, попробуйте ещё раз");
      return true;
    }
    await ans("Смена ваша ✅");
    await finish(`✅ <b>Берёт:</b> ${esc(emp.full_name ?? "—")}`);
    await notifyAdmins(
      `🙋 ${esc(emp.full_name ?? "—")} взял(а) смену по заявке в чате: ${esc(pvz?.name ?? "ПВЗ")}, ${fmtDay(r.shift_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)} (просил(а): ${esc(creator?.full_name ?? "—")}).`,
    );
    return true;
  }
  return false;
}

// ---------- Сообщения в группе ----------

async function handleGroupMessage(msg: any) {
  const chatId: number = msg.chat.id;
  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (!text.startsWith("/")) return; // в группах молчим на всё, кроме команд

  // Админ подключает этот чат (настройки при повторном вызове не сбрасываются)
  if (RE_HELP_HERE.test(text)) {
    const emp = await getEmployee(msg.from?.id);
    if (!emp?.is_admin) return;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/help_chats?on_conflict=chat_id`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ chat_id: chatId, title: msg.chat.title ?? null }),
    });
    if (!r.ok) {
      console.error("help_chats upsert", r.status, await r.text());
      return;
    }
    const chat = await getChat(chatId);
    if (chat) await refreshCommands(chatId, chat);
    const canDel = await botCanDelete(chatId);
    await sendMessage(
      chatId,
      "✅ Бот подключён к этому чату: <b>/help</b>, <b>/today</b>, <b>/need</b>.\nНастроить всё кнопками (включить и выключить команды, утреннее объявление, кого звать): <b>/settings</b>." +
        (canDel ? "" : "\n⚠️ Чтобы бот заменял ваше сообщение по /help, дайте ему право удалять сообщения (сделайте админом). Пока он отвечает на него."),
      { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } },
    );
    return;
  }

  const chat = await getChat(chatId);
  if (!chat) {
    console.log("group chat not enabled", chatId, msg.chat.title ?? "");
    return;
  }

  if (RE_SETTINGS.test(text)) {
    const emp = await getEmployee(msg.from?.id);
    if (!emp?.is_admin) return;
    await showSettings(chatId, null, chat);
    return;
  }

  const mt = RE_TODAY.exec(text);
  if (mt) {
    if (!chat.today_on || !(await getEmployee(msg.from?.id))) return;
    const chunks = await buildToday(mt[1]);
    for (const c of chunks) {
      await sendMessage(chatId, c, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
    }
    return;
  }

  const mn = RE_NEED.exec(text);
  if (mn) {
    if (!chat.need_on) return;
    await handleNeed(msg, mn[1]);
    return;
  }

  const m = RE_HELP.exec(text);
  if (!m || !chat.help_on) return;
  await handleHelp(msg, chat, m[1]);
}

// ---------- По расписанию (cron, раз в 5 минут): утреннее объявление и напоминания по /help ----------

async function runTick() {
  const today = todayYmd();
  const minutes = nowMinutes();
  const chats = await db("help_chats?select=*");

  for (const c of chats) {
    try {
      // утреннее объявление: один раз в день, не позже чем через 2 часа после назначенного времени
      const at = toMin(c.morning_time);
      if (c.morning_on && c.morning_last !== today && minutes >= at && minutes < at + 120) {
        await dbReq("PATCH", `help_chats?chat_id=eq.${c.chat_id}`, { morning_last: today });
        const chunks = await buildSchedule("0", "a", true);
        const hasShifts = !chunks.every((x) => x.includes("<i>смен нет</i>"));
        if (hasShifts) {
          chunks[0] = chunks[0].replace("📅 <b>Сегодня", "☀️ <b>Доброе утро! Сегодня");
          for (const t of chunks) await sendMessage(c.chat_id, t, { disable_notification: true });
        }
      }
      // напоминание по /help, если никто не откликнулся
      if (c.remind_min > 0) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const open = await db(`help_requests?select=*&chat_id=eq.${c.chat_id}&status=eq.open&reminded=eq.false&created_at=gte.${since}`);
        for (const r of open) {
          if (Date.now() - Date.parse(r.created_at) < c.remind_min * 60000) continue;
          await dbReq("PATCH", `help_requests?id=eq.${r.id}`, { reminded: true });
          if ((r.watchers ?? []).length || !r.message_id) continue;
          await sendMessage(c.chat_id, `⏰ Пока никто не откликнулся. Посмотрите, пожалуйста: ${r.mentions}`, {
            reply_parameters: { message_id: r.message_id, allow_sending_without_reply: true },
          });
        }
      }
    } catch (e) {
      console.error("tick chat", c.chat_id, e);
    }
  }
}

// ---------- Вход ----------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // запуск по расписанию (cron раз в 5 минут): утреннее объявление и напоминания по /help
  const tickHdr = req.headers.get("x-tick-secret");
  if (tickHdr !== null) {
    // ключ для cron лежит в таблице bot_secrets (наружу не выдаётся, доступ только у service role)
    let ok = false;
    try {
      const row = (await db("bot_secrets?select=value&key=eq.tick&limit=1"))[0];
      ok = !!row?.value && row.value === tickHdr;
    } catch (e) {
      console.error("tick secret", e);
    }
    if (!ok) return new Response("forbidden", { status: 403 });
    try {
      await runTick();
    } catch (e) {
      console.error("tick error", e);
    }
    return new Response("ok");
  }

  if (WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg) return new Response("ok");

    // группы и супергруппы: только команда /помогите, остальное игнорируем
    if (msg.chat?.type === "group" || msg.chat?.type === "supergroup") {
      await handleGroupMessage(msg);
      return new Response("ok");
    }

    const chatId = msg.chat.id;
    const text: string = msg.text ?? "";

    if (text.startsWith("/start")) {
      const me = await getEmployee(msg.from?.id);
      await touchSeen(msg.from?.id);
      await sendMessage(
        chatId,
        "👋 Добро пожаловать в <b>График ПВЗ</b>!\n\nНажмите кнопку ниже, чтобы открыть расписание.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📅 Открыть график", web_app: { url: WEBAPP_URL } }],
              [{ text: "📋 График в чате", callback_data: "n" }],
            ],
          },
        },
      );
      await sendMessage(chatId, "Кнопки меню всегда под полем ввода 👇", { reply_markup: me?.is_admin ? REPLY_KB_ADMIN : REPLY_KB });
    } else if (RE_TODAY.test(text)) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else {
        await touchSeen(msg.from?.id);
        for (const c of await buildToday(RE_TODAY.exec(text)?.[1])) await sendMessage(chatId, c);
      }
    } else if (RE_SETTINGS.test(text)) {
      await sendMessage(chatId, "Настройки рабочего чата открываются командой /settings в самом групповом чате (для админов).");
    } else if (text.startsWith("/schedule") || text === BTN_SCHEDULE) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else {
        await touchSeen(msg.from?.id);
        await sendMessage(chatId, MENU_TEXT, { reply_markup: mainKb(!!emp.is_admin) });
      }
    } else if (text === BTN_MY) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else {
        await touchSeen(msg.from?.id);
        const my = await buildMy(emp.id, 0);
        await sendMessage(chatId, my.text, { reply_markup: my.kb });
      }
    } else if (text === BTN_SEEN || text.startsWith("/seen")) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else if (!emp.is_admin) {
        await sendMessage(chatId, "Эта кнопка только для администраторов.");
      } else {
        await touchSeen(msg.from?.id);
        for (const chunk of await buildSeen()) await sendMessage(chatId, chunk);
      }
    } else if (text === BTN_LOST || text.startsWith("/lost")) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else if (!emp.is_admin) {
        await sendMessage(chatId, "Эта кнопка только для администраторов.");
      } else {
        await touchSeen(msg.from?.id);
        const r = await buildLost(LOST_DEFAULT_DAYS);
        for (let i = 0; i < r.chunks.length; i++) {
          await sendMessage(chatId, r.chunks[i], i === r.chunks.length - 1 ? { reply_markup: r.kb } : {});
        }
      }
    } else {
      await sendMessage(chatId, "Нажмите /start, чтобы открыть график ПВЗ.");
    }
  } catch (e) {
    console.error("update error", e);
  }

  return new Response("ok");
});
