// deno-lint-ignore-file no-explicit-any
// supabase/functions/broadcast-check/index.ts
//
// Рассылка «сверьте смены» всем сотрудникам с доступом к боту. Под сообщением кнопка «Всё в порядке»
// (нажатие обрабатывает bot-webhook и ставит отметку в schedule_check_replies).
// Вызывает админ из приложения (проверяется его JWT).
//
// Тело запроса:
//   { title, body }          — новая рассылка всем
//   { resend_check_id }      — повторить тем, кто ещё не нажал «Всё в порядке»
//   { kind: "broadcast", body, employee_ids, author_id } — обычная рассылка выбранным сотрудникам с подписью
//                              автора и кнопкой «Принял(а)» (то же, что кнопка «📢 Рассылка» в боте)
//   { resend_broadcast_id }  — напомнить тем, кто ещё не нажал «Принял(а)»
//   { kind: "refresh_commands", chat_id } — перезаписать меню команд «/» в рабочем чате по его настройкам
//                              (вызывает админка после переключения /help, /today, /need)
//
// Секреты: BOT_TOKEN (уже есть). SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// Деплой: supabase functions deploy broadcast-check --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// начальники не участвуют в зарплатах, сверка им не нужна (как в приложении)
const BOSSES = ["иван", "светлана"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Короткий текст напоминания не отметившимся: период берём из заголовка рассылки
// («Сверка смен с 1 по 15 ноября»), а ссылка на Яну — t.me по её username в таблице employees.
async function reminderText(title: string): Promise<string> {
  const label = String(title ?? "").replace(/^Сверка смен\s*/i, "").trim();
  let contact = "пишите Яне в личку";
  try {
    const { data } = await db.from("employees").select("tg_username").ilike("full_name", "яна").eq("is_active", true).limit(1);
    const u = String(data?.[0]?.tg_username ?? "").replace(/^@/, "");
    if (/^[A-Za-z0-9_]{4,32}$/.test(u)) contact = `пишите Яне: https://t.me/${u}`;
  } catch (e) {
    console.error("yana lookup", e);
  }
  const what = label ? `свои смены ${label} включительно` : "свои смены";
  return `Сверьте ${what}, как можно скорее 🙏\nЕсли есть расхождения — ${contact}`;
}

// обычный текст без разметки: так сообщение потом без потерь редактируется при нажатии кнопки
async function sendCheck(chatId: number, text: string, checkId: string): Promise<number | null> {
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: "✅ Всё в порядке", callback_data: `chk:${checkId}` }]] },
      }),
    });
    const j = await r.json();
    if (!j.ok) { console.error("sendMessage", JSON.stringify(j)); return null; }
    return j.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage", e);
    return null;
  }
}

// сообщение рассылки из бота: кнопка «Принял(а)» (нажатие обрабатывает bot-webhook, bc:ok:<id>)
async function sendBc(chatId: number, text: string, bid: string): Promise<number | null> {
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: "✅ Принял(а)", callback_data: `bc:ok:${bid}` }]] },
      }),
    });
    const j = await r.json();
    if (!j.ok) { console.error("sendMessage", JSON.stringify(j)); return null; }
    return j.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage", e);
    return null;
  }
}

async function markSent(bid: string, empId: string, tgId: number, mid: number) {
  await db.from("broadcast_replies").update({ status: "sent", tg_chat_id: tgId, message_id: mid, sent_at: new Date().toISOString() }).eq("broadcast_id", bid).eq("employee_id", empId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!(await isAdminCaller(req))) return json({ error: "forbidden" }, 403);
    const input = await req.json().catch(() => ({}));

    // ---- меню команд «/» в рабочем чате: то же, что refreshCommands в bot-webhook ----
    if (input.kind === "refresh_commands") {
      const chatId = Number(input.chat_id);
      if (!chatId) return json({ error: "Не указан чат" }, 400);
      const { data: c } = await db.from("help_chats").select("*").eq("chat_id", chatId).maybeSingle();
      if (!c) return json({ error: "Чат не подключён" }, 404);
      const commands: { command: string; description: string }[] = [];
      if (c.help_on) commands.push({ command: "help", description: "Позвать тех, кто смотрит камеры" });
      if (c.today_on) commands.push({ command: "today", description: "Кто сегодня на смене" });
      if (c.need_on) commands.push({ command: "need", description: "Нужен человек на смену" });
      const r = await fetch(`${API}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands, scope: { type: "chat", chat_id: chatId } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) { console.error("setMyCommands", JSON.stringify(j)); return json({ error: "Telegram не принял меню" }, 502); }
      return json({ ok: true, commands: commands.map((x) => x.command) });
    }

    // ---- обычная рассылка выбранным сотрудникам ----
    if (input.kind === "broadcast") {
      const body = String(input.body ?? "").trim();
      if (!body) return json({ error: "Пустой текст" }, 400);
      const ids: string[] = Array.isArray(input.employee_ids) ? input.employee_ids.map(String) : [];
      if (!ids.length) return json({ error: "Выберите получателей" }, 400);
      const { data: author } = await db.from("employees").select("id, full_name, is_admin").eq("id", String(input.author_id ?? "")).maybeSingle();
      if (!author || !author.is_admin) return json({ error: "Автор не найден" }, 400);
      const { data: emps, error: e1 } = await db.from("employees").select("id, full_name, tg_id").eq("is_active", true).gt("tg_id", 0).in("id", ids);
      if (e1) throw e1;
      const targets = emps ?? [];
      if (!targets.length) return json({ error: "Некому отправлять" }, 400);
      const { data: b, error: e2 } = await db.from("broadcasts").insert({ author_id: author.id, author_name: author.full_name, body }).select().single();
      if (e2) throw e2;
      const { error: e3 } = await db.from("broadcast_replies").insert(targets.map((t: any) => ({ broadcast_id: b.id, employee_id: t.id, status: "sent" })));
      if (e3) throw e3;
      const text = `${body}\n\n— ${author.full_name}`;
      let sent = 0;
      const failed: string[] = [];
      for (const t of targets) {
        const mid = await sendBc(t.tg_id, text, b.id);
        if (mid) { sent++; await markSent(b.id, t.id, t.tg_id, mid); }
        else { failed.push(t.full_name || "?"); await db.from("broadcast_replies").update({ status: "failed" }).eq("broadcast_id", b.id).eq("employee_id", t.id); }
        await sleep(60);
      }
      return json({ ok: true, broadcast_id: b.id, sent, failed });
    }

    // ---- напоминание не принявшим ----
    if (input.resend_broadcast_id) {
      const { data: b } = await db.from("broadcasts").select("*").eq("id", input.resend_broadcast_id).maybeSingle();
      if (!b) return json({ error: "Рассылка не найдена" }, 404);
      const { data: rows } = await db.from("broadcast_replies").select("employee_id, employees:employee_id(full_name, tg_id, is_active)").eq("broadcast_id", b.id).neq("status", "ok");
      let sent = 0;
      const failed: string[] = [];
      for (const r of rows ?? []) {
        const e: any = (r as any).employees;
        if (!e?.tg_id || e.tg_id <= 0 || e.is_active === false) continue;
        const mid = await sendBc(e.tg_id, `🔔 Напоминание\n\n${b.body}\n\n— ${b.author_name}`, b.id);
        if (mid) { sent++; await markSent(b.id, (r as any).employee_id, e.tg_id, mid); } else failed.push(e.full_name || "?");
        await sleep(60);
      }
      return json({ ok: true, broadcast_id: b.id, sent, failed });
    }

    let check: any;
    let targets: any[];

    if (input.resend_check_id) {
      const { data: c, error } = await db.from("schedule_checks").select("*").eq("id", input.resend_check_id).single();
      if (error || !c) return json({ error: "Рассылка не найдена" }, 404);
      check = c;
      const { data: rows } = await db
        .from("schedule_check_replies")
        .select("employee_id, status, employees:employee_id(full_name, tg_id, is_active)")
        .eq("check_id", c.id)
        .neq("status", "ok");
      targets = (rows ?? []).filter((r: any) => r.employees?.is_active !== false).map((r: any) => ({ id: r.employee_id, full_name: r.employees?.full_name, tg_id: r.employees?.tg_id }));
    } else {
      const title = String(input.title ?? "").trim();
      const body = String(input.body ?? "").trim();
      if (!body) return json({ error: "Пустой текст" }, 400);
      const { data: emps, error: e1 } = await db
        .from("employees")
        .select("id, full_name, tg_id")
        .eq("is_active", true);
      if (e1) throw e1;
      targets = (emps ?? []).filter((e: any) => e.tg_id && e.tg_id > 0 && !BOSSES.includes(String(e.full_name ?? "").trim().toLowerCase()));
      if (!targets.length) return json({ error: "Некому отправлять" }, 400);
      const { data: c, error: e2 } = await db.from("schedule_checks").insert({ title: title || "Сверка смен", body }).select().single();
      if (e2) throw e2;
      check = c;
      const { error: e3 } = await db.from("schedule_check_replies").upsert(
        targets.map((t: any) => ({ check_id: check.id, employee_id: t.id, status: "sent" })),
        { onConflict: "check_id,employee_id" },
      );
      if (e3) throw e3;
    }

    // при напоминании шлём короткий текст, а не всю рассылку заново
    const text = input.resend_check_id ? await reminderText(check.title) : check.body;

    let sent = 0;
    const failed: string[] = [];
    for (const t of targets) {
      if (!t.tg_id || t.tg_id <= 0) { failed.push(t.full_name || "?"); continue; }
      const mid = await sendCheck(t.tg_id, text, check.id);
      if (mid) {
        sent++;
        await db.from("schedule_check_replies").update({ status: "sent", tg_chat_id: t.tg_id, message_id: mid, sent_at: new Date().toISOString() }).eq("check_id", check.id).eq("employee_id", t.id);
      } else {
        failed.push(t.full_name || "?");
        await db.from("schedule_check_replies").update({ status: "failed" }).eq("check_id", check.id).eq("employee_id", t.id);
      }
      await sleep(60); // не упираемся в лимиты Telegram
    }

    return json({ ok: true, check_id: check.id, sent, failed });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
