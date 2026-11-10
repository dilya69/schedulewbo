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

// обычный текст без разметки: так сообщение потом без потерь редактируется при нажатии кнопки
async function sendCheck(chatId: number, text: string, checkId: string): Promise<number | null> {
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!(await isAdminCaller(req))) return json({ error: "forbidden" }, 403);
    const input = await req.json().catch(() => ({}));

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

    let sent = 0;
    const failed: string[] = [];
    for (const t of targets) {
      if (!t.tg_id || t.tg_id <= 0) { failed.push(t.full_name || "?"); continue; }
      const mid = await sendCheck(t.tg_id, check.body, check.id);
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
