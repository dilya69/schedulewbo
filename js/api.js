// ============================================================
// API — авторизация и все обращения к Supabase
// ============================================================
const Api = (() => {
  let client = null;
  let currentEmployee = null;
  let jwt = null;

  // ---------- АВТОРИЗАЦИЯ ЧЕРЕЗ TELEGRAM ----------
  async function login() {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    let initData = tg?.initData;

    // Локальная отладка вне Telegram (например, открыли index.html в браузере)
    if (!initData) {
      console.warn("Telegram initData отсутствует — работаем в демо-режиме без бэкенда.");
      return { demo: true };
    }

    const res = await fetch(CONFIG.AUTH_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });

    const body = await res.json();
    if (!res.ok) {
      if (body.error === "not_whitelisted") {
        throw new Error("Доступ не выдан. Обратитесь к администратору, чтобы вас добавили в список сотрудников.");
      }
      throw new Error(body.error || "Ошибка авторизации");
    }

    jwt = body.token;
    currentEmployee = body.employee;

    client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return { demo: false, employee: currentEmployee };
  }

  function getCurrentEmployee() {
    return currentEmployee;
  }

  function isReady() {
    return !!client;
  }

  // отправляет файл прямо в Telegram-чат текущего пользователя (обходит
  // блокировку скачивания в WebView)
  async function sendFileToMe(filename, content) {
    const res = await fetch(CONFIG.SEND_FILE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ filename, content }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || "Не удалось отправить файл");
  }

  // ---------- ПВЗ ----------
  async function getPvzList() {
    const { data, error } = await client.from("pvz").select("*").eq("is_active", true).order("sort_order");
    if (error) throw error;
    return data;
  }

  async function addPvz(name, marketplace, color) {
    const { error } = await client.from("pvz").insert({
      name, marketplace, color, css_class: marketplace,
    });
    if (error) throw error;
  }

  async function updatePvz(id, fields) {
    const { error } = await client.from("pvz").update(fields).eq("id", id);
    if (error) throw error;
  }

  async function deletePvz(id) {
    const { error } = await client.from("pvz").update({ is_active: false }).eq("id", id);
    if (error) throw error;
  }

  // массово создаёт свободные смены на весь месяц для всех ПВЗ,
  // но только для тех дней/ПВЗ, где ещё вообще нет ни одной смены
  async function bulkCreateFreeMonth(year, month) {
    const pvzList = await getPvzList();
    const existing = await getShiftsForMonth(year, month);
    const existingKey = new Set(existing.map((s) => `${s.pvz_id}_${s.shift_date}`));
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows = [];
    for (const pvz of pvzList) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const key = `${pvz.id}_${dateStr}`;
        if (existingKey.has(key)) continue;
        rows.push({
          pvz_id: pvz.id, shift_date: dateStr,
          start_time: pvz.default_start_time || "09:00",
          end_time: pvz.default_end_time || "21:00",
          employee_id: null, status: "free",
        });
      }
    }
    if (rows.length === 0) return 0;
    const { error } = await client.from("shifts").insert(rows);
    if (error) throw error;
    return rows.length;
  }

  // ---------- СМЕНЫ ----------
  async function getShiftsForMonth(year, month) {
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data, error } = await client
      .from("shifts")
      .select("*, employees:employee_id(id, full_name, avatar_emoji)")
      .gte("shift_date", from)
      .lte("shift_date", to);
    if (error) throw error;
    return data;
  }

  async function upsertShift({ id, pvz_id, shift_date, start_time, end_time, employee_id, status, custom_amount }) {
    const payload = { pvz_id, shift_date, start_time, end_time, employee_id, status, custom_amount: custom_amount ?? null };
    if (id) payload.id = id;
    const { error } = await client.from("shifts").upsert(payload);
    if (error) throw error;
  }

  async function deleteShift(id) {
    const { error } = await client.from("shifts").delete().eq("id", id);
    if (error) throw error;
  }

  // ---------- ЗАЯВКИ НА СМЕНЫ ----------
  // requestedStart/requestedEnd — если сотрудник хочет выйти не на весь
  // день, а с какого-то часа (например, помочь вечером)
  async function applyForShift(shiftId, requestedStart, requestedEnd) {
    const payload = { shift_id: shiftId, employee_id: currentEmployee.id };
    if (requestedStart) payload.requested_start_time = requestedStart;
    if (requestedEnd) payload.requested_end_time = requestedEnd;

    const { error: reqErr } = await client.from("shift_requests").insert(payload);
    if (reqErr) {
      if (reqErr.code === "23505") throw new Error("Вы уже откликнулись на эту смену");
      throw reqErr;
    }

    // free -> pending; если уже pending (кто-то ещё откликнулся раньше) — ничего не меняем
    await client.from("shifts").update({ status: "pending" }).eq("id", shiftId).eq("status", "free");
  }

  async function getMyPendingRequests() {
    const { data, error } = await client
      .from("shift_requests")
      .select("*, shifts:shift_id(shift_date, start_time, end_time, pvz:pvz_id(name, color))")
      .eq("employee_id", currentEmployee.id)
      .eq("status", "pending");
    if (error) throw error;
    return data;
  }

  async function getPendingRequests() {
    const { data, error } = await client
      .from("shift_requests")
      .select("*, employees:employee_id(full_name), shifts:shift_id(pvz_id, shift_date, start_time, end_time, pvz:pvz_id(name))")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  // action: 'approve_as_is' | 'approve_with_time' | 'reject'
  async function resolveRequest({ requestId, shiftId, employeeId, action, pvzId, shiftDate, overrideStart, overrideEnd }) {
    if (action === "reject") {
      await client.from("shift_requests").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", requestId);
      const { count } = await client
        .from("shift_requests")
        .select("id", { count: "exact", head: true })
        .eq("shift_id", shiftId)
        .eq("status", "pending");
      if (!count) await client.from("shifts").update({ status: "free" }).eq("id", shiftId);
      return;
    }

    const { error: reqErr } = await client
      .from("shift_requests")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", requestId);
    if (reqErr) throw reqErr;

    if (action === "approve_with_time") {
      // отдельная смена на указанное время — исходная (на весь день) остаётся свободной для других
      const { error } = await client.from("shifts").insert({
        pvz_id: pvzId, shift_date: shiftDate, start_time: overrideStart, end_time: overrideEnd,
        employee_id: employeeId, status: "confirmed",
      });
      if (error) throw error;
    } else {
      // approve_as_is: остальные отклики на эту же смену больше не актуальны
      await client
        .from("shift_requests")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("shift_id", shiftId)
        .eq("status", "pending");

      const { error: shiftErr } = await client
        .from("shifts")
        .update({ employee_id: employeeId, status: "confirmed" })
        .eq("id", shiftId);
      if (shiftErr) throw shiftErr;
    }
  }

  async function markRequestApproved(requestId) {
    const { error } = await client
      .from("shift_requests")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) throw error;
  }

  async function rejectAllPendingRequests() {
    const { data: pending, error: selErr } = await client.from("shift_requests").select("id, shift_id").eq("status", "pending");
    if (selErr) throw selErr;
    if (!pending || pending.length === 0) return 0;

    const ids = pending.map((r) => r.id);
    const { error: updErr } = await client
      .from("shift_requests")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .in("id", ids);
    if (updErr) throw updErr;

    const shiftIds = [...new Set(pending.map((r) => r.shift_id))];
    await client.from("shifts").update({ status: "free" }).in("id", shiftIds).is("employee_id", null);
    return pending.length;
  }

  // ---------- СОТРУДНИКИ ----------
  async function getEmployees() {
    const { data, error } = await client.from("employees").select("*").order("full_name");
    if (error) throw error;
    return data;
  }

  async function addEmployee({ full_name, position, tg_username }) {
    // отрицательный уникальный "плейсхолдер" вместо 0 — иначе второй такой же
    // сотрудник не сохранится (tg_id должен быть уникальным).
    // Когда человек сам откроет бота, telegram-auth сама привяжет его
    // настоящий tg_id к этой записи по совпадению username.
    const placeholderTgId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const { error } = await client.from("employees").insert({
      full_name, position, tg_username, tg_id: placeholderTgId, is_active: true,
    });
    if (error) throw error;
  }

  async function updateEmployee(id, fields) {
    const { error } = await client.from("employees").update(fields).eq("id", id);
    if (error) throw error;
  }

  async function deleteEmployee(id) {
    const { error } = await client.from("employees").update({ is_active: false }).eq("id", id);
    if (error) throw error;
  }

  async function hardDeleteEmployee(id) {
    const { error } = await client.from("employees").delete().eq("id", id);
    if (error) throw error;
  }

  // вся история сотрудника за всё время — используется для экспорта перед увольнением
  async function getEmployeeFullHistory(employeeId) {
    const [{ data: shifts, error: e1 }, { data: bf, error: e2 }] = await Promise.all([
      client.from("shifts").select("*, pvz:pvz_id(name)").eq("employee_id", employeeId).order("shift_date"),
      client.from("bonuses_fines").select("*").eq("employee_id", employeeId).order("period_month"),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { shifts: shifts || [], bonusesFines: bf || [] };
  }

  // ---------- БОНУСЫ / ШТРАФЫ ----------
  async function addBonusFine(employeeId, kind, amount, reason) {
    const { error } = await client.from("bonuses_fines").insert({
      employee_id: employeeId, kind, amount, reason, created_by: currentEmployee.id,
    });
    if (error) throw error;
  }

  async function getBonusesFines(year, month) {
    const period = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const { data, error } = await client.from("bonuses_fines").select("*").eq("period_month", period);
    if (error) throw error;
    return data;
  }

  // ---------- НАСТРОЙКИ УВЕДОМЛЕНИЙ ----------
  async function getNotificationSettings() {
    const { data, error } = await client
      .from("notification_settings")
      .select("*")
      .eq("employee_id", currentEmployee.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function saveNotificationSettings(fields) {
    const { error } = await client
      .from("notification_settings")
      .upsert({ employee_id: currentEmployee.id, ...fields });
    if (error) throw error;
  }

  return {
    login, getCurrentEmployee, isReady, sendFileToMe,
    getPvzList, addPvz, updatePvz, deletePvz, bulkCreateFreeMonth,
    getShiftsForMonth, upsertShift, deleteShift,
    applyForShift, getMyPendingRequests, getPendingRequests, resolveRequest, markRequestApproved, rejectAllPendingRequests,
    getEmployees, addEmployee, updateEmployee, deleteEmployee, hardDeleteEmployee, getEmployeeFullHistory,
    addBonusFine, getBonusesFines,
    getNotificationSettings, saveNotificationSettings,
  };
})();
