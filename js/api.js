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

  async function deletePvz(id) {
    const { error } = await client.from("pvz").update({ is_active: false }).eq("id", id);
    if (error) throw error;
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

  async function upsertShift({ id, pvz_id, shift_date, start_time, end_time, employee_id, status }) {
    const payload = { pvz_id, shift_date, start_time, end_time, employee_id, status };
    if (id) payload.id = id;
    const { error } = await client.from("shifts").upsert(payload);
    if (error) throw error;
  }

  async function deleteShift(id) {
    const { error } = await client.from("shifts").delete().eq("id", id);
    if (error) throw error;
  }

  // ---------- ЗАЯВКИ НА СМЕНЫ ----------
  async function applyForShift(shiftId) {
    const { error: reqErr } = await client.from("shift_requests").insert({
      shift_id: shiftId,
      employee_id: currentEmployee.id,
    });
    if (reqErr) throw reqErr;

    const { error: shiftErr } = await client
      .from("shifts")
      .update({ status: "pending", employee_id: currentEmployee.id })
      .eq("id", shiftId);
    if (shiftErr) throw shiftErr;
  }

  async function getPendingRequests() {
    const { data, error } = await client
      .from("shift_requests")
      .select("*, employees:employee_id(full_name), shifts:shift_id(shift_date, start_time, end_time, pvz:pvz_id(name))")
      .eq("status", "pending");
    if (error) throw error;
    return data;
  }

  async function resolveRequest(requestId, shiftId, approve) {
    const { error: reqErr } = await client
      .from("shift_requests")
      .update({ status: approve ? "approved" : "rejected", resolved_at: new Date().toISOString() })
      .eq("id", requestId);
    if (reqErr) throw reqErr;

    const { error: shiftErr } = await client
      .from("shifts")
      .update(approve ? { status: "confirmed" } : { status: "free", employee_id: null })
      .eq("id", shiftId);
    if (shiftErr) throw shiftErr;
  }

  // ---------- СОТРУДНИКИ ----------
  async function getEmployees() {
    const { data, error } = await client.from("employees").select("*").order("full_name");
    if (error) throw error;
    return data;
  }

  async function addEmployee({ full_name, position, tg_username }) {
    const { error } = await client.from("employees").insert({
      full_name, position, tg_username, tg_id: 0, is_active: true,
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
    login, getCurrentEmployee, isReady,
    getPvzList, addPvz, deletePvz,
    getShiftsForMonth, upsertShift, deleteShift,
    applyForShift, getPendingRequests, resolveRequest,
    getEmployees, addEmployee, updateEmployee, deleteEmployee,
    addBonusFine, getBonusesFines,
    getNotificationSettings, saveNotificationSettings,
  };
})();
