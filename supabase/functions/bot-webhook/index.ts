// deno-lint-ignore-file no-explicit-any
// supabase/functions/bot-webhook/index.ts
//
// Обрабатывает апдейты от Telegram (устанавливается как webhook бота).
// /start    — кнопка запуска мини-приложения (+ кнопка «График в чате»).
// /schedule — график прямо в чате: Сегодня / Завтра / Неделя (все ПВЗ или один)
//             и «Мои смены» с листанием по неделям. Сообщение редактируется на месте.
// В группах: /помогите <текст> — бот отвечает на сообщение и упоминает людей с
//             доступом к камерам (employees.camera_access). Работает только в чатах из
//             таблицы help_chats; админ включает чат командой /помогите_здесь.
//             Всё остальное в группах бот игнорирует.
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
const REPLY_KB = {
  keyboard: [[{ text: BTN_SCHEDULE }, { text: BTN_MY }]],
  resize_keyboard: true,
  is_persistent: true,
};
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
  const rows = await db(`employees?select=id,full_name,is_admin&tg_id=eq.${tgId}&is_active=eq.true&limit=1`);
  return rows[0] ?? null;
}

async function loadPvz(onlyActive = true) {
  const filter = onlyActive ? "&is_active=eq.true" : "";
  return await db(`pvz?select=id,name,marketplace,sort_order${filter}&order=sort_order.asc`);
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

async function buildSchedule(period: string, pvzId: string): Promise<string[]> {
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
  const selected = pvzId === "a" ? pvzList : pvzList.filter((p: any) => p.id === pvzId);

  let q =
    `shifts?select=shift_date,start_time,end_time,status,pvz_id,employee_id` +
    `&shift_date=gte.${from}&shift_date=lte.${to}&order=shift_date.asc,start_time.asc`;
  if (pvzId !== "a") q += `&pvz_id=eq.${pvzId}`;

  const [shifts, emps] = await Promise.all([db(q), db("employees?select=id,full_name,tg_id,tg_username")]);
  const names = new Map<string, string>(emps.map((e: any) => [e.id, nameLink(e)]));
  const visible = shifts.filter((s: any) => !HIDE_STATUSES.includes(s.status ?? ""));

  const range = from === to ? `${title}, ${fmtDay(from)}` : `${title}: ${fmtDay(from)} – ${fmtDay(to)}`;
  let header = `📅 <b>${range}</b>`;
  if (pvzId !== "a") header += `\n🏬 ${esc(selected[0]?.name ?? "ПВЗ")}`;

  const blocks: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = visible.filter((s: any) => s.shift_date === date);
    const lines: string[] = [];
    if (pvzId === "a") {
      for (const p of selected) {
        const ps = day.filter((s: any) => s.pvz_id === p.id);
        if (!ps.length) continue;
        lines.push(`🏬 <b>${esc(p.name)}</b>${p.marketplace ? ` (${esc(p.marketplace)})` : ""}`);
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
  await tg("answerCallbackQuery", { callback_query_id: cb.id });

  try {
    if (data === "n") {
      await sendMessage(chatId, MENU_TEXT, { reply_markup: MAIN_KB });
      return;
    }
    if (data === "m") {
      await edit(chatId, messageId, MENU_TEXT, MAIN_KB);
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

// ---------- «Помогите» в группе ----------

// Команды на кириллице Telegram не считает командами бота, поэтому разбираем текст сами.
// Работает и для подписи к фото (caption).
const RE_HELP_HERE = /^\/помогите_здесь(?:@\w+)?(?:\s|$)/i;
const RE_HELP = /^\/помогите(?:@\w+)?(?:\s+([\s\S]*))?$/i;

async function handleGroupMessage(msg: any) {
  const chatId: number = msg.chat.id;
  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (!text.startsWith("/")) return; // в группах молчим на всё, кроме команд

  // Админ включает команду в этом чате
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
    await sendMessage(chatId, "✅ Команда <b>/помогите</b> включена в этом чате.", {
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    });
    return;
  }

  const m = RE_HELP.exec(text);
  if (!m) return;

  const allowed = await db(`help_chats?select=chat_id&chat_id=eq.${chatId}&limit=1`);
  if (!allowed.length) {
    console.log("help: chat not enabled", chatId, msg.chat.title ?? "");
    return;
  }

  const sender = await getEmployee(msg.from?.id);
  if (!sender) return; // только сотрудники

  const people = await db(
    "employees?select=id,full_name,tg_id&camera_access=eq.true&is_active=eq.true&tg_id=gt.0&order=full_name.asc",
  );
  const targets = people.filter((e: any) => e.tg_id !== msg.from?.id);
  if (!targets.length) return;

  const note = esc((m[1] ?? "").trim().slice(0, 500));
  const mentions = targets.map((e: any) => `<a href="tg://user?id=${e.tg_id}">${esc(e.full_name ?? "—")}</a>`).join(", ");
  const body = note ? `🆘 <b>Помогите</b> ${note}` : "🆘 <b>Нужна помощь</b>";

  await sendMessage(chatId, `${body}\n\n${mentions}`, {
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
}

// ---------- Вход ----------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

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
      await sendMessage(chatId, "Кнопки меню всегда под полем ввода 👇", { reply_markup: REPLY_KB });
    } else if (text.startsWith("/schedule") || text === BTN_SCHEDULE) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else {
        await sendMessage(chatId, MENU_TEXT, { reply_markup: MAIN_KB });
      }
    } else if (text === BTN_MY) {
      const emp = await getEmployee(msg.from?.id);
      if (!emp) {
        await sendMessage(chatId, NO_ACCESS_TEXT);
      } else {
        const my = await buildMy(emp.id, 0);
        await sendMessage(chatId, my.text, { reply_markup: my.kb });
      }
    } else {
      await sendMessage(chatId, "Нажмите /start, чтобы открыть график ПВЗ.");
    }
  } catch (e) {
    console.error("update error", e);
  }

  return new Response("ok");
});
