// supabase/functions/telegram-auth/index.ts
//
// Принимает initData из Telegram Mini App, проверяет подпись
// секретом бота, находит/создаёт сотрудника и выдаёт JWT,
// с которым фронтенд дальше обращается к Supabase (PostgREST) напрямую.
//
// Секреты (Supabase → Project Settings → Edge Functions → Secrets):
//   BOT_TOKEN            — токен Telegram-бота от BotFather
//   SUPABASE_URL         — берётся автоматически
//   SUPABASE_SERVICE_ROLE_KEY — сервисный ключ (для чтения/записи employees)
//   SUPABASE_JWT_SECRET  — Project Settings → API → JWT Secret

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

// Проверка подписи initData по алгоритму Telegram
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function verifyInitData(initData: string): Promise<Record<string, string> | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (computedHash !== hash) return null;

  // защита от повторного использования старых initData (не старше 24ч)
  const authDate = Number(params.get("auth_date") ?? "0");
  if (Date.now() / 1000 - authDate > 86400) return null;

  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

const hmacKeyPromise = crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(JWT_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { initData } = await req.json();
    if (!initData) {
      return new Response(JSON.stringify({ error: "initData обязателен" }), { status: 400, headers: cors });
    }

    const verified = await verifyInitData(initData);
    if (!verified) {
      return new Response(JSON.stringify({ error: "Подпись Telegram недействительна" }), { status: 401, headers: cors });
    }

    const tgUser = JSON.parse(verified.user);
    const tgId = tgUser.id as number;

    // найти или создать сотрудника
    let { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("tg_id", tgId)
      .maybeSingle();

    // если не нашли по tg_id — может, админ уже завёл его вручную по имени
    // в Telegram (username), просто он ещё ни разу не открывал бота.
    // У таких "плейсхолдер"-записей tg_id отрицательный.
    if (!employee && tgUser.username) {
      const { data: preCreated } = await supabase
        .from("employees")
        .select("*")
        .lt("tg_id", 0)
        .ilike("tg_username", tgUser.username)
        .maybeSingle();

      if (preCreated) {
        const { data: claimed, error: claimErr } = await supabase
          .from("employees")
          .update({ tg_id: tgId, tg_username: tgUser.username })
          .eq("id", preCreated.id)
          .select()
          .single();
        if (claimErr) throw claimErr;
        employee = claimed;
      }
    }

    if (!employee) {
      const { data: created, error: insErr } = await supabase
        .from("employees")
        .insert({
          tg_id: tgId,
          tg_username: tgUser.username ?? null,
          full_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Без имени",
          is_active: false, // новый пользователь по умолчанию НЕ в белом списке — админ должен активировать
        })
        .select()
        .single();
      if (insErr) throw insErr;
      employee = created;
    }

    if (!employee.is_active) {
      return new Response(
        JSON.stringify({ error: "not_whitelisted", message: "Обратитесь к администратору для получения доступа" }),
        { status: 403, headers: cors }
      );
    }

    // отметка последнего входа (если поля last_seen_at ещё нет — ошибка игнорируется, вход не ломается)
    try {
      await supabase.from("employees").update({ last_seen_at: new Date().toISOString() }).eq("id", employee.id);
    } catch (_) { /* не мешаем входу */ }

    const key = await hmacKeyPromise;
    const jwt = await createJwt(
      { alg: "HS256", typ: "JWT" },
      {
        sub: employee.id,
        role: "authenticated",
        tg_id: tgId,
        is_admin: employee.is_admin,
        exp: getNumericDate(60 * 60 * 24 * 7), // токен на 7 дней
      },
      key
    );

    return new Response(
      JSON.stringify({ token: jwt, employee }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
