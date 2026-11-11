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
// Уволенным сотрудникам (is_active = false) напоминания не шлются.
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

// смена «на N часов» без точного времени (duration_minutes) показывается как «2 ч», а не диапазоном
function timeLabel(s) {
  const d = Number(s.duration_minutes);
  if (d > 0) {
    const h = Math.floor(d / 60), m = d % 60;
    return h && m ? `${h} ч ${m} мин` : h ? `${h} ч` : `${m} мин`;
  }
  return `${hhmm(s.start_time)}–${hhmm(s.end_time)}`;
}

const BIRTHDAY_ADMIN_MIN = 9 * 60;   // админам о днях рождения — в 09:00 по Москве

function fmtDate(ymd) {
  const [, m, d] = String(ymd).split("-");
  return `${d}.${m}`;
}

// Возвращает список сообщений, которые надо отправить прямо сейчас.
// shifts: смены с employee_id (shift_date >= сегодня); settingsRows: строки notification_settings.
function planMessages(now, shifts, settingsRows, people) {
  const out = [];
  const settingsBy = new Map((settingsRows ?? []).map((s) => [s.employee_id, s]));
  const { ymd: today, minutes: nowMin } = mskNow(now);

  // 1) напоминания о смене и повторы
  for (const shift of shifts) {
    const emp = shift.employees;
    if (!emp || !(Number(emp.tg_id) > 0) || emp.is_active === false) continue;
    const st = settingsBy.get(shift.employee_id);

    if (shift.duration_minutes) continue; // у короткой смены нет точного начала — напоминание «за N минут» не имеет смысла, остаётся утренняя сводка
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
      text: `${title}\n\n🏢 ${esc(shift.pvz?.name ?? "ПВЗ")}\n📅 ${fmtDate(shift.shift_date)}, ${timeLabel(shift)}\n\nНе забудьте про смену!`,
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
    if (!st || !st.daily_time) continue;
    const emp = list[0].employees;
    if (!emp || !(Number(emp.tg_id) > 0) || emp.is_active === false) continue;
    if (!inWindow(nowMin - toMin(st.daily_time))) continue;

    list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const lines = list.map((s) => `🏢 ${esc(s.pvz?.name ?? "ПВЗ")}: ${timeLabel(s)}`);
    out.push({
      chatId: Number(emp.tg_id),
      kind: "daily",
      text: `☀️ Сегодня у вас ${list.length > 1 ? "смены" : "смена"}\n\n${lines.join("\n")}`,
    });
  }

  // 3) день рождения: админам в 09:00 по Москве — кто сегодня именинник (о себе именинник-админ не получает)
  if (inWindow(nowMin - BIRTHDAY_ADMIN_MIN)) {
    const [ty, tm, td] = today.split("-").map(Number);
    const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
    const isBd = (p) => p.is_active !== false && p.birth_month && p.birth_day &&
      ((p.birth_month === tm && p.birth_day === td) || (!leap && tm === 2 && td === 28 && p.birth_month === 2 && p.birth_day === 29));
    const bdays = (people ?? []).filter(isBd);
    if (bdays.length) {
      for (const adm of (people ?? [])) {
        if (!adm.is_admin || adm.is_active === false || !(Number(adm.tg_id) > 0)) continue;
        const others = bdays.filter((p) => p.id !== adm.id);
        if (!others.length) continue;
        out.push({
          chatId: Number(adm.tg_id),
          kind: "birthday",
          text: `🎂 Сегодня день рождения: ${others.map((p) => esc(p.full_name)).join(", ")}`,
        });
      }
    }
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
    .select("id, shift_date, start_time, end_time, duration_minutes, employee_id, pvz:pvz_id(name), employees:employee_id(tg_id, full_name, is_active)")
    .not("employee_id", "is", null)
    .gte("shift_date", today);
  if (error) {
    console.error(error);
    return new Response("error", { status: 500 });
  }

  const { data: settingsRows } = await supabase.from("notification_settings").select("*");

  // люди для напоминаний о днях рождения; если поля ещё нет в базе — просто пропускаем
  const { data: people } = await supabase
    .from("employees")
    .select("id, full_name, tg_id, is_admin, is_active, birth_day, birth_month")
    .eq("is_active", true);

  const messages = planMessages(now, shifts ?? [], settingsRows ?? [], people ?? []);
  let sent = 0;
  const byKind = { reminder: 0, repeat: 0, daily: 0, birthday: 0 };
  for (const m of messages) {
    if (await sendMessage(m.chatId, m.text)) {
      sent++;
      byKind[m.kind]++;
    }
  }

  return new Response(JSON.stringify({ sent, ...byKind }), { headers: { "Content-Type": "application/json" } });
});
