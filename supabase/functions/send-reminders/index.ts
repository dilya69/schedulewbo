// supabase/functions/send-reminders/index.ts
//
// Запускается по расписанию (cron, раз в 5 минут). Для каждого сотрудника, у которого есть
// строка в notification_settings и включены push-уведомления, делает три вещи:
//
//  1) «Напоминать о смене»: за remind_minutes минут до начала смены шлёт напоминание.
//  2) «Повторять уведомление»: если repeat_minutes > 0, то повторяет это напоминание
//     каждые repeat_minutes минут, пока смена не началась.
//  3) «Время уведомления» (daily_time, по Москве): раз в день в это время шлёт список
//     смен на сегодня (если смены есть).
//
// Сотрудники без строки в notification_settings получают только одно напоминание за 2 часа.
// Те, кто ещё ни разу не открывал бота (tg_id <= 0), пропускаются.
//
// Время смен и daily_time считаются по Москве (UTC+3).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TZ_OFFSET_H = 3;
const TZ_OFFSET = "+03:00";
const WINDOW = 2.5; // окно ±2.5 минуты, т.к. cron срабатывает раз в 5 минут

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const hhmm = (t: string | null | undefined) => String(t ?? "").slice(0, 5);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendMessage(chatId: number, text: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

Deno.serve(async () => {
  const now = new Date();

  // «сейчас» по Москве
  const msk = new Date(now.getTime() + TZ_OFFSET_H * 3600 * 1000);
  const todayMsk = msk.toISOString().slice(0, 10);
  const minutesOfDayMsk = msk.getUTCHours() * 60 + msk.getUTCMinutes();

  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("id, shift_date, start_time, end_time, employee_id, pvz:pvz_id(name), employees:employee_id(tg_id, full_name)")
    .not("employee_id", "is", null)
    .gte("shift_date", todayMsk)
    .lte("shift_date", new Date(msk.getTime() + 3 * 86400000).toISOString().slice(0, 10)); // напоминание можно ставить максимум за 24 часа, берём с запасом

  if (error) {
    console.error(error);
    return new Response("error", { status: 500 });
  }

  const { data: settingsRows } = await supabase.from("notification_settings").select("*");
  const settingsByEmployee = new Map((settingsRows ?? []).map((s) => [s.employee_id, s]));

  let sent = 0, daily = 0;

  // ---------- 1) и 2) напоминания о смене и их повторы ----------
  for (const shift of shifts ?? []) {
    const employee = shift.employees as unknown as { tg_id: number; full_name: string } | null;
    if (!employee || !(employee.tg_id > 0)) continue;

    const settings = settingsByEmployee.get(shift.employee_id) ?? { remind_minutes: 120, repeat_minutes: 0, push_enabled: true };
    if (!settings.push_enabled) continue;

    const shiftStart = new Date(`${shift.shift_date}T${shift.start_time}${TZ_OFFSET}`);
    const minutesLeft = (shiftStart.getTime() - now.getTime()) / 60000;
    if (minutesLeft <= 0) continue; // смена уже началась

    const remind = Number(settings.remind_minutes) || 120;
    const repeat = Number(settings.repeat_minutes) || 0;

    // сколько минут прошло с момента первого напоминания (0 = ровно в момент «за N минут»)
    const elapsed = remind - minutesLeft;
    let due = Math.abs(elapsed) <= WINDOW; // первое напоминание
    if (!due && repeat > 0 && elapsed > WINDOW) {
      const k = Math.round(elapsed / repeat);
      due = k >= 1 && Math.abs(elapsed - k * repeat) <= WINDOW;
    }
    if (!due) continue;

    const pvz = shift.pvz as unknown as { name: string };
    const ok = await sendMessage(
      employee.tg_id,
      `⏰ Напоминание о смене\n\n🏢 ${esc(pvz?.name ?? "ПВЗ")}\n📅 ${shift.shift_date}, ${hhmm(shift.start_time)}–${hhmm(shift.end_time)}\n\nНе забудьте про смену!`,
    );
    if (ok) sent++;
  }

  // ---------- 3) ежедневный список смен на сегодня ----------
  const byEmployee = new Map<string, any[]>();
  for (const s of shifts ?? []) {
    if (s.shift_date !== todayMsk) continue;
    const arr = byEmployee.get(s.employee_id) ?? [];
    arr.push(s);
    byEmployee.set(s.employee_id, arr);
  }
  for (const [empId, list] of byEmployee) {
    const settings = settingsByEmployee.get(empId);
    if (!settings || !settings.push_enabled || !settings.daily_time) continue; // только у тех, кто сам настроил
    const tgId = (list[0].employees as any)?.tg_id;
    if (!(tgId > 0)) continue;

    const [h, m] = String(settings.daily_time).slice(0, 5).split(":").map(Number);
    const target = (h || 0) * 60 + (m || 0);
    if (Math.abs(minutesOfDayMsk - target) > WINDOW) continue;

    list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const lines = list.map((s) => `• ${esc((s.pvz as any)?.name ?? "ПВЗ")}: ${hhmm(s.start_time)}–${hhmm(s.end_time)}`);
    const ok = await sendMessage(tgId, `📅 <b>Ваши смены на сегодня</b>\n\n${lines.join("\n")}`);
    if (ok) daily++;
  }

  return new Response(JSON.stringify({ sent, daily }), { headers: { "Content-Type": "application/json" } });
});
