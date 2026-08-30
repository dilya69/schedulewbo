// ============================================================
// APP — состояние приложения и рендер интерфейса
// ============================================================
const App = (() => {
  const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  const AVATAR_COLORS = ["#007aff","#8e44ad","#e67e22","#e91e63","#8bc34a","#2e7d32","#ff9500","#34c759"];

  let state = {
    demo: false,
    employee: null,
    isAdminView: false,
    market: "wb",
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    pvz: [],
    shifts: [],
    employees: [],
    requests: [],
    bonusesFines: [],
    notif: null,
  };

  // ---------------- ИНИЦИАЛИЗАЦИЯ ----------------
  async function init() {
    try {
      const result = await Api.login();
      state.demo = !!result.demo;
      state.employee = result.employee || demoEmployee();

      if (state.demo) toast("⚠️ Демо-режим: нет соединения с Supabase, данные не сохраняются");

      await reloadAll();

      document.getElementById("bootScreen").style.display = "none";
      document.getElementById("appBody").style.display = "block";

      if (state.employee.is_admin) {
        document.getElementById("adminToggle").classList.remove("hidden");
      }
      applyAdminClass();
      switchTab("tab1");
    } catch (e) {
      console.error(e);
      document.getElementById("bootScreen").innerHTML =
        `<div class="center-msg">🚫 ${escapeHtml(e.message || "Ошибка загрузки")}</div>`;
    }
  }

  function demoEmployee() {
    return {
      id: "demo", tg_id: 0, full_name: "Демо-пользователь", position: "Менеджер",
      avatar_emoji: "👤", is_admin: true, default_rate: 350, rating: 5.0,
    };
  }

  async function reloadAll() {
    if (state.demo) return; // в демо-режиме нет бэкенда — просто показываем пустой интерфейс
    state.pvz = await Api.getPvzList();
    await reloadShifts();
    state.employees = await Api.getEmployees();
    state.bonusesFines = await Api.getBonusesFines(state.year, state.month);
    if (state.employee.is_admin) {
      state.requests = await Api.getPendingRequests();
    }
    state.notif = await Api.getNotificationSettings();
    renderAll();
  }

  async function reloadShifts() {
    if (state.demo) return;
    state.shifts = await Api.getShiftsForMonth(state.year, state.month);
  }

  function renderAll() {
    updateMonthLabel();
    renderCalendar();
    renderMyShifts();
    renderRequests();
    renderEmployees();
    renderProfile();
    renderManagement();
  }

  // ---------------- УТИЛИТЫ ----------------
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  function hoursBetween(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
  }

  function colorForName(name) {
    let hash = 0;
    for (const ch of String(name)) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  // ---------------- ТЕМА ----------------
  function toggleTheme() {
    document.body.classList.toggle("dark-theme");
    document.body.classList.toggle("light-theme");
    localStorage.setItem("theme", document.body.classList.contains("dark-theme") ? "dark" : "light");
  }
  (function initTheme() {
    document.body.classList.add(localStorage.getItem("theme") === "dark" ? "dark-theme" : "light-theme");
  })();

  // ---------------- ВКЛАДКИ ----------------
  function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.getElementById(tabId)?.classList.add("active");
    document.querySelectorAll("#bottomNav .nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelector(`#bottomNav .nav-item[data-tab="${tabId}"]`)?.classList.add("active");
    document.getElementById("mainContent").scrollTop = 0;
  }

  // ---------------- АДМИН-РЕЖИМ ----------------
  function toggleAdmin() {
    if (!state.employee.is_admin) return;
    state.isAdminView = !state.isAdminView;
    document.getElementById("adminToggle").classList.toggle("active", state.isAdminView);
    applyAdminClass();
    renderCalendar();
    if (!state.isAdminView) {
      const active = document.querySelector(".tab-content.active");
      if (active?.id === "tab5") switchTab("tab1");
    }
  }

  function applyAdminClass() {
    document.getElementById("app").classList.toggle("admin-mode", state.isAdminView);
  }

  // ---------------- МЕСЯЦ / РЫНОК ----------------
  async function changeMonth(delta) {
    state.month += delta;
    if (state.month > 11) { state.month = 0; state.year++; }
    if (state.month < 0) { state.month = 11; state.year--; }
    await reloadShifts();
    state.bonusesFines = state.demo ? [] : await Api.getBonusesFines(state.year, state.month);
    updateMonthLabel();
    renderCalendar();
    renderMyShifts();
    renderProfile();
    renderManagement();
  }

  function updateMonthLabel() {
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const label = `${MONTHS[state.month]} ${state.year} <span>• ${daysInMonth} дней</span>`;
    document.getElementById("monthLabel").innerHTML = label;
    document.getElementById("adminMonthLabel").textContent = `${MONTHS[state.month]} ${state.year}`;
  }

  function switchMarket(market) {
    state.market = market;
    document.querySelectorAll(".market-btn").forEach((btn) => {
      btn.className = "market-btn";
      if (btn.dataset.market === market) btn.classList.add(market === "wb" ? "active-wb" : "active-ozon");
    });
    renderCalendar();
  }

  // ---------------- КАЛЕНДАРЬ ----------------
  function shiftsForPvzAndDay(pvzId, day) {
    const dateStr = `${state.year}-${String(state.month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return state.shifts.filter((s) => s.pvz_id === pvzId && s.shift_date === dateStr);
  }

  function renderCalendar() {
    const container = document.getElementById("calendarContainer");
    if (!container) return;

    if (state.demo) {
      container.innerHTML = `<div class="center-msg">Подключите Supabase (config.js), чтобы увидеть реальный график.</div>`;
      return;
    }

    const pvzList = state.isAdminView ? state.pvz.filter((p) => p.marketplace === state.market) : state.pvz;
    document.getElementById("marketSwitcher").style.display = state.isAdminView ? "flex" : "none";

    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const firstDay = new Date(state.year, state.month, 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    const today = new Date();
    const isCurrentMonth = today.getMonth() === state.month && today.getFullYear() === state.year;

    const bgClass = state.isAdminView ? `calendar-wrapper bg-${state.market}` : "calendar-wrapper";
    let html = `<div class="${bgClass}">`;

    if (pvzList.length === 0) {
      html += `<div class="center-msg">Нет ПВЗ для отображения</div>`;
    }

    pvzList.forEach((pvz) => {
      html += `<div class="pzv-block" style="border-left-color:${pvz.color}; background:${pvz.color}14;">
        <div class="pzv-title" style="color:${pvz.color};">
          <span>🏢 ${escapeHtml(pvz.name)}</span>
          <span>${pvz.marketplace.toUpperCase()}</span>
        </div>
        <div class="weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="days-grid">`;

      for (let i = 0; i < startOffset; i++) html += `<div class="day-cell empty"></div>`;

      let totalShifts = 0, totalHours = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dayShifts = shiftsForPvzAndDay(pvz.id, d);
        const shift = dayShifts[0]; // MVP: одна смена в день на ПВЗ
        const isToday = isCurrentMonth && d === today.getDate();

        html += `<div class="day-cell ${isToday ? "today" : ""}"><span>${d}</span>`;

        if (shift && shift.employee_id) {
          totalShifts++;
          totalHours += hoursBetween(shift.start_time, shift.end_time);
          const isMine = shift.employee_id === state.employee.id;
          const pendingCls = shift.status === "pending" ? "pending" : "";
          const mineCls = isMine ? "my-shift" : "";
          const empName = shift.employees?.full_name?.split(" ")[0] || "?";
          html += `<div class="shift-badge ${pendingCls} ${mineCls}" style="${pendingCls||mineCls?"":`background:${pvz.color};`}">${escapeHtml(empName)}</div>
                   <div class="hours">${Math.round(hoursBetween(shift.start_time, shift.end_time))}ч</div>`;
        } else if (shift && !state.isAdminView) {
          html += `<button class="shift-free" style="color:${pvz.color}; border-color:${pvz.color};" onclick="App.applyForShift('${shift.id}')">📩 Свободно</button>`;
        }

        if (state.isAdminView) {
          html += `<button class="edit-shift-btn" onclick="App.openEditShiftModal('${pvz.id}', ${d}, ${shift ? `'${shift.id}'` : "null"})">✎</button>`;
        }

        html += `</div>`;
      }

      html += `</div>`;

      if (state.isAdminView) {
        html += `<div class="admin-panel" style="border-color:${pvz.color};">
          <div class="stat-row"><span>Смен назначено:</span><strong>${totalShifts}</strong></div>
          <div class="stat-row"><span>Часов:</span><strong>${Math.round(totalHours)}</strong></div>
        </div>`;
      }

      html += `</div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
  }

  async function applyForShift(shiftId) {
    if (!confirm("Подать заявку на эту смену?")) return;
    try {
      await Api.applyForShift(shiftId);
      toast("✅ Заявка отправлена администратору");
      await reloadShifts();
      renderCalendar();
      renderMyShifts();
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  function openEditShiftModal(pvzId, day, shiftId) {
    const dateStr = `${state.year}-${String(state.month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const shift = shiftId ? state.shifts.find((s) => s.id === shiftId) : null;
    const empOptions = state.employees
      .map((e) => `<option value="${e.id}" ${shift?.employee_id === e.id ? "selected" : ""}>${escapeHtml(e.full_name)}</option>`)
      .join("");

    openModal(`Смена на ${day} ${MONTHS[state.month].toLowerCase()}`, `
      <label>Сотрудник</label>
      <select id="f_employee"><option value="">— свободно —</option>${empOptions}</select>
      <label>Начало</label>
      <input type="time" id="f_start" value="${shift?.start_time?.slice(0,5) || "09:00"}">
      <label>Конец</label>
      <input type="time" id="f_end" value="${shift?.end_time?.slice(0,5) || "18:00"}">
    `, async () => {
      const employeeId = document.getElementById("f_employee").value || null;
      const start = document.getElementById("f_start").value;
      const end = document.getElementById("f_end").value;
      try {
        await Api.upsertShift({
          id: shift?.id, pvz_id: pvzId, shift_date: dateStr,
          start_time: start, end_time: end, employee_id: employeeId,
          status: employeeId ? "confirmed" : "free",
        });
        toast("✅ Смена сохранена");
        await reloadShifts();
        renderCalendar();
      } catch (e) {
        toast("🚫 " + e.message);
      }
    }, shift ? {
      label: "Удалить смену",
      action: async () => {
        await Api.deleteShift(shift.id);
        toast("🗑️ Смена удалена");
        await reloadShifts();
        renderCalendar();
      },
    } : null);
  }

  // ---------------- МОИ СМЕНЫ / ЗАЯВКИ ----------------
  function renderMyShifts() {
    const container = document.getElementById("myShiftsContainer");
    if (state.demo) { container.innerHTML = `<div class="center-msg">Нет данных</div>`; return; }

    const mine = state.shifts
      .filter((s) => s.employee_id === state.employee.id)
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date));

    if (mine.length === 0) {
      container.innerHTML = `<div class="center-msg">В этом месяце смен пока нет</div>`;
      return;
    }

    container.innerHTML = mine.map((s) => {
      const pvz = state.pvz.find((p) => p.id === s.pvz_id);
      const hours = Math.round(hoursBetween(s.start_time, s.end_time));
      const dateObj = new Date(s.shift_date + "T00:00:00");
      const dateLabel = dateObj.toLocaleDateString("ru-RU", { day: "numeric", month: "short", weekday: "short" });
      return `<div class="my-shift-card" style="border-left-color:${pvz?.color || "#007aff"};">
        <div class="info">
          <div class="pzv-name">🏢 ${escapeHtml(pvz?.name || "—")}</div>
          <div class="date-time">${dateLabel} • ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</div>
          ${s.status === "pending" ? `<div class="status-badge pending">⏳ Заявка отправлена</div>` : ""}
        </div>
        <div class="hours-count">${hours}ч</div>
      </div>`;
    }).join("");
  }

  function renderRequests() {
    const container = document.getElementById("requestsContainer");
    const badge = document.getElementById("requestsBadge");
    if (!state.employee.is_admin || state.demo) { if (badge) badge.style.display = "none"; return; }

    if (state.requests.length === 0) {
      container.innerHTML = `<div class="center-msg">Нет активных заявок</div>`;
      badge.style.display = "none";
    } else {
      badge.style.display = "inline-block";
      badge.textContent = state.requests.length;
      container.innerHTML = state.requests.map((r) => `
        <div class="request-card">
          <div class="info">
            <div class="name">${escapeHtml(r.employees?.full_name || "—")}</div>
            <div class="details">${escapeHtml(r.shifts?.pvz?.name || "")} • ${r.shifts?.shift_date} ${r.shifts?.start_time?.slice(0,5)}–${r.shifts?.end_time?.slice(0,5)}</div>
          </div>
          <div class="actions">
            <button class="approve" onclick="App.resolveRequest('${r.id}', '${r.shift_id}', true)">✅</button>
            <button class="reject" onclick="App.resolveRequest('${r.id}', '${r.shift_id}', false)">❌</button>
          </div>
        </div>`).join("");
    }
  }

  async function resolveRequest(requestId, shiftId, approve) {
    try {
      await Api.resolveRequest(requestId, shiftId, approve);
      toast(approve ? "✅ Заявка одобрена" : "❌ Заявка отклонена");
      state.requests = await Api.getPendingRequests();
      await reloadShifts();
      renderRequests();
      renderCalendar();
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  // ---------------- СОТРУДНИКИ ----------------
  function renderEmployees() {
    const container = document.getElementById("employeeList");
    document.getElementById("employeeCount").textContent = state.demo ? "" : `${state.employees.length} чел.`;
    if (state.demo) { container.innerHTML = ""; return; }

    container.innerHTML = state.employees.map((e) => `
      <div class="employee-card" data-name="${escapeHtml(e.full_name.toLowerCase())}">
        <div class="avatar" style="background:${colorForName(e.full_name)};">${escapeHtml(e.full_name[0] || "?")}</div>
        <div class="info">
          <div class="name">${escapeHtml(e.full_name)}</div>
          <div class="role">${escapeHtml(e.position || "Менеджер")}</div>
        </div>
        <div class="actions">
          ${e.tg_username ? `<button class="chat-btn" onclick="App.openChat('${e.tg_username}')" title="Чат в Telegram">💬</button>` : ""}
          <button class="edit-btn admin-only" onclick="App.openEditEmployeeModal('${e.id}')" title="Редактировать">✏️</button>
          <button class="delete admin-only" onclick="App.deleteEmployee('${e.id}', '${escapeHtml(e.full_name)}')" title="Удалить">🗑️</button>
        </div>
      </div>`).join("");
  }

  function filterEmployees() {
    const q = document.getElementById("searchInput").value.toLowerCase().trim();
    const cards = document.querySelectorAll(".employee-card");
    let visible = 0;
    cards.forEach((c) => {
      const match = (c.dataset.name || "").includes(q);
      c.style.display = match ? "flex" : "none";
      if (match) visible++;
    });
    document.getElementById("noResults").style.display = visible === 0 ? "block" : "none";
  }

  function openAddEmployeeModal() {
    openModal("Добавить сотрудника", `
      <label>ФИО</label><input type="text" id="f_name" placeholder="Иван Иванов">
      <label>Должность</label><input type="text" id="f_position" placeholder="Менеджер" value="Менеджер">
      <label>Telegram username (без @, необязательно)</label><input type="text" id="f_username" placeholder="ivanov">
    `, async () => {
      const full_name = document.getElementById("f_name").value.trim();
      if (!full_name) return toast("Введите имя");
      const position = document.getElementById("f_position").value.trim();
      const tg_username = document.getElementById("f_username").value.trim() || null;
      try {
        await Api.addEmployee({ full_name, position, tg_username });
        toast("✅ Сотрудник добавлен");
        state.employees = await Api.getEmployees();
        renderEmployees();
        renderManagement();
      } catch (e) { toast("🚫 " + e.message); }
    });
  }

  function openEditEmployeeModal(id) {
    const emp = state.employees.find((e) => e.id === id);
    if (!emp) return;
    openModal(`Редактировать: ${emp.full_name}`, `
      <label>ФИО</label><input type="text" id="f_name" value="${escapeHtml(emp.full_name)}">
      <label>Должность</label><input type="text" id="f_position" value="${escapeHtml(emp.position || "")}">
      <label>Активен (доступ в приложение)</label>
      <select id="f_active"><option value="true" ${emp.is_active !== false ? "selected" : ""}>Да</option><option value="false" ${emp.is_active === false ? "selected" : ""}>Нет</option></select>
      <label>Администратор</label>
      <select id="f_admin"><option value="false" ${!emp.is_admin ? "selected" : ""}>Нет</option><option value="true" ${emp.is_admin ? "selected" : ""}>Да</option></select>
    `, async () => {
      try {
        await Api.updateEmployee(id, {
          full_name: document.getElementById("f_name").value.trim(),
          position: document.getElementById("f_position").value.trim(),
          is_active: document.getElementById("f_active").value === "true",
          is_admin: document.getElementById("f_admin").value === "true",
        });
        toast("✅ Изменения сохранены");
        state.employees = await Api.getEmployees();
        renderEmployees();
      } catch (e) { toast("🚫 " + e.message); }
    });
  }

  async function deleteEmployee(id, name) {
    if (!confirm(`Удалить сотрудника «${name}»? Доступ будет отозван.`)) return;
    try {
      await Api.deleteEmployee(id);
      toast("✅ Сотрудник удалён");
      state.employees = await Api.getEmployees();
      renderEmployees();
      renderManagement();
    } catch (e) { toast("🚫 " + e.message); }
  }

  function openChat(username) {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/${username}`);
    else window.open(`https://t.me/${username}`, "_blank");
  }

  // ---------------- ПРОФИЛЬ ----------------
  function renderProfile() {
    const e = state.employee;
    document.getElementById("profileAvatar").childNodes[0].nodeValue = e.avatar_emoji || "👤";
    document.getElementById("profileName").textContent = e.full_name;
    document.getElementById("profileRole").textContent = e.position || "Сотрудник";
    document.getElementById("profileTgId").textContent = e.tg_username ? `🆔 @${e.tg_username}` : `🆔 ${e.tg_id}`;
    document.getElementById("statRating").textContent = e.rating ?? "—";

    if (state.demo) return;

    const myShifts = state.shifts.filter((s) => s.employee_id === e.id && s.status !== "pending");
    const totalHours = myShifts.reduce((sum, s) => sum + hoursBetween(s.start_time, s.end_time), 0);
    document.getElementById("statShifts").textContent = myShifts.length;
    document.getElementById("statHours").textContent = Math.round(totalHours);

    const rate = e.default_rate || 350;
    const incomeContainer = document.getElementById("incomeContainer");
    let total = 0;
    let rows = myShifts
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date))
      .map((s) => {
        const pvz = state.pvz.find((p) => p.id === s.pvz_id);
        const hours = hoursBetween(s.start_time, s.end_time);
        const amount = Math.round(hours * rate);
        total += amount;
        return `<div class="profile-income-item">
          <div class="left"><div class="title">🏢 ${escapeHtml(pvz?.name || "—")}</div><div class="desc">${s.shift_date}, ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} • ${Math.round(hours)}ч</div></div>
          <div class="right">${amount.toLocaleString("ru-RU")} ₽</div>
        </div>`;
      });

    const myBF = state.bonusesFines.filter((b) => b.employee_id === e.id);
    myBF.forEach((b) => {
      const sign = b.kind === "bonus" ? 1 : -1;
      total += sign * b.amount;
      rows.push(`<div class="profile-income-item">
        <div class="left"><div class="title">${b.kind === "bonus" ? "⭐ Бонус" : "⚠️ Штраф"}</div><div class="desc">${escapeHtml(b.reason || "")}</div></div>
        <div class="right ${b.kind}">${sign > 0 ? "+" : "-"}${b.amount.toLocaleString("ru-RU")} ₽</div>
      </div>`);
    });

    incomeContainer.innerHTML = rows.join("") || `<div class="center-msg">Пока нет данных за месяц</div>`;
    document.getElementById("profileTotal").textContent = `${Math.round(total).toLocaleString("ru-RU")} ₽`;

    // уведомления
    if (state.notif) {
      document.getElementById("remindMinutes").value = state.notif.remind_minutes ?? 120;
      document.getElementById("dailyTime").value = state.notif.daily_time?.slice(0,5) || "08:00";
      document.getElementById("repeatMinutes").value = state.notif.repeat_minutes ?? 15;
      document.getElementById("pushSwitch").classList.toggle("active", state.notif.push_enabled !== false);
    }
  }

  function changeAvatar() {
    const emojis = ["👤","😊","😎","🧑‍💻","👨‍💼","👩‍💼","🦊","🐱","🐶","🦄","⭐","🔥","💪","🎯","🚀","🌟"];
    openModal("Выберите аватар", `
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; font-size:26px; text-align:center;">
        ${emojis.map((em) => `<button onclick="App._pickAvatar('${em}')" style="border:none; background:var(--card-secondary); border-radius:12px; padding:8px 0; cursor:pointer;">${em}</button>`).join("")}
      </div>
    `, null);
  }

  async function _pickAvatar(emoji) {
    closeModal();
    document.getElementById("profileAvatar").childNodes[0].nodeValue = emoji;
    state.employee.avatar_emoji = emoji;
    if (!state.demo) {
      try { await Api.updateEmployee(state.employee.id, { avatar_emoji: emoji }); }
      catch (e) { toast("🚫 " + e.message); }
    }
  }

  async function togglePush() {
    const el = document.getElementById("pushSwitch");
    el.classList.toggle("active");
    await saveNotificationSettings();
  }

  async function saveNotificationSettings() {
    if (state.demo) return;
    const fields = {
      remind_minutes: Number(document.getElementById("remindMinutes").value),
      daily_time: document.getElementById("dailyTime").value,
      repeat_minutes: Number(document.getElementById("repeatMinutes").value),
      push_enabled: document.getElementById("pushSwitch").classList.contains("active"),
    };
    try {
      await Api.saveNotificationSettings(fields);
      toast("🔔 Настройки сохранены");
    } catch (e) { toast("🚫 " + e.message); }
  }

  // ---------------- УПРАВЛЕНИЕ (АДМИН) ----------------
  function renderManagement() {
    if (!state.employee.is_admin || state.demo) return;

    const rate = (e) => e.default_rate || 350;
    let fund = 0, totalHoursAll = 0;

    const rows = state.employees.filter((e) => e.is_active !== false).map((e) => {
      const empShifts = state.shifts.filter((s) => s.employee_id === e.id && s.status !== "pending");
      const hours = empShifts.reduce((sum, s) => sum + hoursBetween(s.start_time, s.end_time), 0);
      const base = hours * rate(e);
      const bf = state.bonusesFines.filter((b) => b.employee_id === e.id);
      const bonuses = bf.filter((b) => b.kind === "bonus");
      const fines = bf.filter((b) => b.kind === "fine");
      const bonusSum = bonuses.reduce((s, b) => s + Number(b.amount), 0);
      const fineSum = fines.reduce((s, b) => s + Number(b.amount), 0);
      const amount = base + bonusSum - fineSum;
      fund += amount;
      totalHoursAll += hours;

      const empPvzIds = new Set(empShifts.map((s) => s.pvz_id));
      const markets = new Set([...empPvzIds].map((id) => state.pvz.find((p) => p.id === id)?.marketplace).filter(Boolean));

      return `<div class="finance-employee">
        <div class="left">
          <div class="name">${escapeHtml(e.full_name)}</div>
          <div class="details">${empShifts.length} смен • ${Math.round(hours)} ч • ставка ${rate(e)}₽/ч</div>
          ${bonuses.map((b) => `<div class="bonus-list">✨ Бонус: +${b.amount}₽ ${b.reason ? "(" + escapeHtml(b.reason) + ")" : ""}</div>`).join("")}
          ${fines.map((b) => `<div class="fine-list">⚠️ Штраф: -${b.amount}₽ ${b.reason ? "(" + escapeHtml(b.reason) + ")" : ""}</div>`).join("")}
        </div>
        <div class="right">
          ${[...markets].map((m) => `<span class="market-tag ${m}">${m.toUpperCase()}</span>`).join("")}
          <span class="amount">${Math.round(amount).toLocaleString("ru-RU")} ₽</span>
          <button class="edit-rate" onclick="App.openEditRateModal('${e.id}')">✏️</button>
        </div>
      </div>`;
    }).join("");

    document.getElementById("financeEmployeeList").innerHTML = rows || `<div class="center-msg">Нет сотрудников</div>`;
    document.getElementById("totalFund").textContent = `${Math.round(fund).toLocaleString("ru-RU")} ₽`;
    document.getElementById("totalFundSub").innerHTML = `${state.employees.length} сотрудников • <span>${Math.round(totalHoursAll)}</span> отработанных часов`;
    document.getElementById("financeGrandTotal").textContent = `${Math.round(fund).toLocaleString("ru-RU")} ₽`;

    document.getElementById("pvzTagRow").innerHTML = state.pvz.map((p) => `
      <span class="pvz-tag"><span class="dot" style="background:${p.color};"></span>${escapeHtml(p.name)}
        <button onclick="App.deletePvzConfirm('${p.id}', '${escapeHtml(p.name)}')" style="border:none; background:none; cursor:pointer; color:#ff3b30; font-size:11px;">✕</button>
      </span>`).join("");
  }

  function openEditRateModal(employeeId) {
    const emp = state.employees.find((e) => e.id === employeeId);
    openModal(`Ставка: ${emp.full_name}`, `
      <label>Ставка, ₽/час</label>
      <input type="number" id="f_rate" value="${emp.default_rate || 350}" min="0">
    `, async () => {
      const rate = Number(document.getElementById("f_rate").value);
      if (!rate || rate <= 0) return toast("Введите корректную сумму");
      try {
        await Api.updateEmployee(employeeId, { default_rate: rate });
        toast("✅ Ставка обновлена");
        state.employees = await Api.getEmployees();
        renderManagement();
      } catch (e) { toast("🚫 " + e.message); }
    });
  }

  function openBonusFineModal(kind) {
    const empOptions = state.employees.map((e) => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join("");
    openModal(kind === "bonus" ? "➕ Начислить бонус" : "⚠️ Оформить штраф", `
      <label>Сотрудник</label><select id="f_employee">${empOptions}</select>
      <label>Сумма, ₽</label><input type="number" id="f_amount" min="1" placeholder="1000">
      <label>Причина</label><input type="text" id="f_reason" placeholder="${kind === "bonus" ? "Качество работы" : "Опоздание"}">
    `, async () => {
      const employeeId = document.getElementById("f_employee").value;
      const amount = Number(document.getElementById("f_amount").value);
      const reason = document.getElementById("f_reason").value.trim();
      if (!amount || amount <= 0) return toast("Введите корректную сумму");
      try {
        await Api.addBonusFine(employeeId, kind, amount, reason);
        toast(kind === "bonus" ? "✅ Бонус добавлен" : "⚠️ Штраф добавлен");
        state.bonusesFines = await Api.getBonusesFines(state.year, state.month);
        renderManagement();
        renderProfile();
      } catch (e) { toast("🚫 " + e.message); }
    });
  }

  function openAddPvzModal() {
    openModal("Добавить ПВЗ", `
      <label>Название</label><input type="text" id="f_name" placeholder="Название ПВЗ">
      <label>Маркетплейс</label>
      <select id="f_market"><option value="wb">WB</option><option value="ozon">Ozon</option></select>
      <label>Цвет</label><input type="color" id="f_color" value="#007aff">
    `, async () => {
      const name = document.getElementById("f_name").value.trim();
      if (!name) return toast("Введите название");
      const marketplace = document.getElementById("f_market").value;
      const color = document.getElementById("f_color").value;
      try {
        await Api.addPvz(name, marketplace, color);
        toast("✅ ПВЗ добавлен");
        state.pvz = await Api.getPvzList();
        renderManagement();
        renderCalendar();
      } catch (e) { toast("🚫 " + e.message); }
    });
  }

  async function deletePvzConfirm(id, name) {
    if (!confirm(`Удалить ПВЗ «${name}»? Смены сохранятся в истории.`)) return;
    try {
      await Api.deletePvz(id);
      toast("✅ ПВЗ удалён");
      state.pvz = await Api.getPvzList();
      renderManagement();
      renderCalendar();
    } catch (e) { toast("🚫 " + e.message); }
  }

  function exportPayroll() {
    const rate = (e) => e.default_rate || 350;
    let csv = "Сотрудник;Смены;Часы;Ставка;Бонусы;Штрафы;Итого\n";
    state.employees.filter((e) => e.is_active !== false).forEach((e) => {
      const empShifts = state.shifts.filter((s) => s.employee_id === e.id && s.status !== "pending");
      const hours = empShifts.reduce((sum, s) => sum + hoursBetween(s.start_time, s.end_time), 0);
      const bf = state.bonusesFines.filter((b) => b.employee_id === e.id);
      const bonusSum = bf.filter((b) => b.kind === "bonus").reduce((s, b) => s + Number(b.amount), 0);
      const fineSum = bf.filter((b) => b.kind === "fine").reduce((s, b) => s + Number(b.amount), 0);
      const total = hours * rate(e) + bonusSum - fineSum;
      csv += `${e.full_name};${empShifts.length};${Math.round(hours)};${rate(e)};${bonusSum};${fineSum};${Math.round(total)}\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll_${state.year}_${state.month + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------- УНИВЕРСАЛЬНАЯ МОДАЛКА ----------------
  function openModal(title, bodyHtml, onConfirm, extraAction) {
    const box = document.getElementById("modalBox");
    box.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${bodyHtml}
      <div class="modal-actions">
        <button class="btn-cancel" onclick="App.closeModal()">Отмена</button>
        ${extraAction ? `<button class="btn-danger" id="modalExtraBtn">${escapeHtml(extraAction.label)}</button>` : ""}
        ${onConfirm ? `<button class="btn-confirm" id="modalConfirmBtn">Сохранить</button>` : ""}
      </div>
    `;
    document.getElementById("modalOverlay").classList.add("show");
    if (onConfirm) {
      document.getElementById("modalConfirmBtn").onclick = async () => { await onConfirm(); closeModal(); };
    }
    if (extraAction) {
      document.getElementById("modalExtraBtn").onclick = async () => { await extraAction.action(); closeModal(); };
    }
  }

  function closeModal() {
    document.getElementById("modalOverlay").classList.remove("show");
  }

  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });

  return {
    init, toggleTheme, switchTab, toggleAdmin, changeMonth, switchMarket,
    applyForShift, openEditShiftModal, resolveRequest,
    filterEmployees, openAddEmployeeModal, openEditEmployeeModal, deleteEmployee, openChat,
    changeAvatar, _pickAvatar, togglePush, saveNotificationSettings,
    openEditRateModal, openBonusFineModal, openAddPvzModal, deletePvzConfirm, exportPayroll,
    closeModal,
  };
})();

window.addEventListener("DOMContentLoaded", () => App.init());
