// supabase/functions/notify-event/index.ts
//
// Вызывается триггером в базе (см. sql/migration_notifications.sql) при:
//  - появлении новой заявки на смену -> сообщение всем админам
//  - одобрении/отклонении заявки -> сообщение сотруднику, который откликался
//
// Секреты: BOT_TOKEN, SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (авто).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// 2026-10-07 -> 07.10.2026
function fmtDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

Deno.serve(async (req) => {
  try {
    const { event, shift_request_id } = await req.json();

    const { data: r, error } = await supabase
      .from("shift_requests")
      .select("*, employees:employee_id(full_name, tg_id), shifts:shift_id(shift_date, start_time, end_time, pvz:pvz_id(name))")
      .eq("id", shift_request_id)
      .single();
    if (error || !r) return new Response("not found", { status: 404 });

    const pvzName = r.shifts?.pvz?.name || "ПВЗ";
    const dateLabel = fmtDate(r.shifts?.shift_date || "");
    const timeLabel = r.requested_start_time
      ? `с ${String(r.requested_start_time).slice(0, 5)}`
      : `${String(r.shifts?.start_time ?? "").slice(0, 5)}–${String(r.shifts?.end_time ?? "").slice(0, 5)}`;

    if (event === "new_request") {
      const { data: admins } = await supabase
        .from("employees")
        .select("tg_id")
        .eq("is_admin", true)
        .eq("is_active", true);

      const text = `📩 <b>Новая заявка на смену</b>\n\n👤 ${r.employees?.full_name ?? "—"}\n🏢 ${pvzName}\n📅 ${dateLabel}, ${timeLabel}`;
      for (const a of admins ?? []) {
        if (a.tg_id && a.tg_id > 0) await sendMessage(a.tg_id, text);
      }
    } else if (event === "resolved") {
      const tgId = r.employees?.tg_id;
      if (tgId && tgId > 0) {
        const text = r.status === "approved"
          ? `✅ <b>Ваша заявка одобрена!</b>\n\n🏢 ${pvzName}\n📅 ${dateLabel}, ${timeLabel}`
          : `❌ <b>Ваша заявка отклонена.</b>\n\n🏢 ${pvzName}\n📅 ${dateLabel}, ${timeLabel}`;
        await sendMessage(tgId, text);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
