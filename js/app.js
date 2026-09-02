// ============================================================
// APP — состояние приложения и рендер интерфейса
// ============================================================
const App = (() => {
  const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  const AVATAR_COLORS = ["#007aff","#8e44ad","#e67e22","#e91e63","#8bc34a","#2e7d32","#ff9500","#34c759"];
  const MAX_NAMES_PER_DAY = 2;

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
    myRequests: [],
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
    return { id: "demo", tg_id: 0, full_name: "Демо-пользователь", position: "Менеджер", avatar_emoji: "👤", is_admin: true };
  }

  async function reloadAll() {
    if (state.demo) return;
    state.pvz = await Api.getPvzList();
    await reloadShifts();
    state.employees = await Api.getEmployees();
    state.bonusesFines = await Api.getBonusesFines(state.year, state.month);
    state.myRequests = await Api.getMyPendingRequests();
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

  async function reloadRequests() {
    if (state.demo) return;
    state.myRequests = await Api.getMyPendingRequests();
    if (state.employee.is_admin) state.requests = await Api.getPendingRequests();
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

  function pad2(n) { return String(n).padStart(2, "0"); }

  function dateStrFor(year, month, day) {
    return `${year}-${pad2(month + 1)}-${pad2(day)}`;
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

  // Сумма за смену зависит от ПВЗ и времени начала:
  //  - старт ровно в стандартное время открытия -> полная смена
  //  - старт в вечерний порог и позже -> вечерняя смена
  //  - старт где-то между ("вышел позже, но не вечером") -> почасовая ставка
  function shiftAmount(shift, pvz) {
    if (!pvz) return 0;
    const startStr = (shift.start_time || "").slice(0, 5);
    const openStr = (pvz.default_start_time || "09:00").slice(0, 5);
    const startHour = Number(startStr.split(":")[0]);
    const threshold = pvz.evening_threshold ?? 17;

    if (startStr === openStr) return Number(pvz.full_shift_pay || 0);
    if (startHour >= threshold) return Number(pvz.evening_pay || 0);
    return hoursBetween(shift.start_time, shift.end_time) * Number(pvz.mid_hourly_rate || 200);
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
    renderRequests();
    renderProfile();
    renderManagement();
  }

  function updateMonthLabel() {
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const label = `${MONTHS[state.month]} ${state.year} <span>• ${daysInMonth} дней</span>`;
    const l1 = document.getElementById("monthLabel");
    const l2 = document.getElementById("monthLabel2");
    if (l1) l1.innerHTML = label;
    if (l2) l2.innerHTML = label;
    const adminLabel = document.getElementById("adminMonthLabel");
    if (adminLabel) adminLabel.textContent = `${MONTHS[state.month]} ${state.year}`;
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
    const dStr = dateStrFor(state.year, state.month, day);
    return state.shifts
      .filter((s) => s.pvz_id === pvzId && s.shift_date === dStr)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  function renderCalendar() {
    const container = document.getElementById("calendarContainer");
    if (!container) return;

    const switcher = document.getElementById("marketSwitcher");
    if (switcher) switcher.style.display = "flex";

    if (state.demo) {
      container.innerHTML = `<div class="center-msg">Подключите Supabase (config.js), чтобы увидеть реальный график.</div>`;
      return;
    }

    const pvzList = state.pvz.filter((p) => p.marketplace === state.market);

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

      let totalShifts = 0, totalAmount = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dayShifts = shiftsForPvzAndDay(pvz.id, d);
        const isToday = isCurrentMonth && d === today.getDate();

        html += `<div class="day-cell ${isToday ? "today" : ""}"><span>${d}</span>`;

        if (dayShifts.length > 0) {
          html += `<div class="chip-row">`;
          const visible = dayShifts.slice(0, MAX_NAMES_PER_DAY);

          visible.forEach((shift) => {
            if (shift.employee_id) {
              totalShifts++;
              totalAmount += shiftAmount(shift, pvz);
              const isMine = shift.employee_id === state.employee.id;
              const empName = shift.employees?.full_name || "?";
              const bg = isMine ? "#ff6b00" : pvz.color;
              const title = `${empName} • ${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)} • ${Math.round(shiftAmount(shift, pvz))}₽`;
              html += `<span class="name-chip ${isMine ? "mine" : ""}" style="background:${bg};" title="${escapeHtml(title)}">${escapeHtml(empName)}</span>`;
            } else if (shift.status === "pending") {
              const cnt = state.requests.filter((r) => r.shift_id === shift.id).length;
              const title = `Есть отклики (${cnt || "?"}) • ${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)}`;
              if (state.isAdminView) {
                html += `<button class="chip-pending-dot" title="${escapeHtml(title)}" onclick="App.openShiftRequestsModal('${shift.id}')"></button>`;
              } else {
                html += `<button class="chip-pending-dot" title="Откликнуться • ${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)}" onclick="App.applyForShift('${shift.id}')"></button>`;
              }
            } else if (!state.isAdminView) {
              const title = `Свободно • ${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)} • нажмите, чтобы подать заявку`;
              html += `<button class="chip-free" title="${escapeHtml(title)}" onclick="App.applyForShift('${shift.id}')">+</button>`;
            } else {
              const title = `Свободно • ${shift.start_time.slice(0,5)}–${shift.end_time.slice(0,5)}`;
              html += `<span class="chip-free" title="${escapeHtml(title)}">·</span>`;
            }
          });

          if (dayShifts.length > MAX_NAMES_PER_DAY) {
            html += `<span class="chip-more">+${dayShifts.length - MAX_NAMES_PER_DAY}</span>`;
          }
          html += `</div>`;
        }

        if (state.isAdminView) {
          html += `<button class="edit-shift-btn" onclick="App.openDayShiftsModal('${pvz.id}', ${d})">✎</button>`;
        }

        html += `</div>`;
      }

      html += `</div>`;

      if (state.isAdminView) {
        html += `<div class="admin-panel" style="border-color:${pvz.color};">
          <div class="stat-row"><span>Смен назначено:</span><strong>${totalShifts}</strong></div>
          <div class="stat-row"><span>Сумма:</span><strong>${Math.round(totalAmount).toLocaleString("ru-RU")} ₽</strong></div>
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
      await reloadRequests();
      renderCalendar();
      renderMyShifts();
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  // ---------------- РЕДАКТИРОВАНИЕ СМЕН (АДМИН) ----------------
  function openDayShiftsModal(pvzId, day) {
    const pvz = state.pvz.find((p) => p.id === pvzId);
    const dStr = dateStrFor(state.year, state.month, day);
    const dayShifts = shiftsForPvzAndDay(pvzId, day);

    const rowsHtml = dayShifts.map((s) => {
      let label, clickAttr;
      if (s.employee_id) {
        label = escapeHtml(s.employees?.full_name || "—");
        clickAttr = `App.openShiftForm('${pvzId}', '${dStr}', '${s.id}')`;
      } else if (s.status === "pending") {
        const cnt = state.requests.filter((r) => r.shift_id === s.id).length;
        label = `⏳ ${cnt} отклик(ов) — посмотреть`;
        clickAttr = `App.openShiftRequestsModal('${s.id}')`;
      } else {
        label = "🆓 Свободно";
        clickAttr = `App.openShiftForm('${pvzId}', '${dStr}', '${s.id}')`;
      }
      return `<div class="day-shift-row">
        <div class="left" onclick="${clickAttr}">${label} • ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</div>
        <button onclick="App.deleteShiftConfirm('${s.id}', '${pvzId}', ${day})" title="Удалить">🗑️</button>
      </div>`;
    }).join("");

    openModal(`${pvz ? escapeHtml(pvz.name) : "ПВЗ"} • ${day} ${MONTHS[state.month].toLowerCase()}`, `
      <div id="dayShiftsList">${rowsHtml || '<div class="center-msg">Смен пока нет</div>'}</div>
      <button type="button" class="add-shift-btn" onclick="App.openShiftForm('${pvzId}', '${dStr}', null)">➕ Добавить смену</button>
    `, null);
  }

  function openShiftForm(pvzId, dStr, shiftId) {
    const shift = shiftId ? state.shifts.find((s) => s.id === shiftId) : null;
    const pvz = state.pvz.find((p) => p.id === pvzId);
    const [year, month, day] = dStr.split("-").map(Number);

    openModal(shiftId ? "Редактировать смену" : "Новая смена", `
      <label>Сотрудник</label>
      ${renderEmpPicker(shift?.employee_id || "")}
      <label>Начало</label>
      <input type="time" id="f_start" value="${shift?.start_time?.slice(0,5) || pvz?.default_start_time?.slice(0,5) || "09:00"}">
      <label>Конец</label>
      <input type="time" id="f_end" value="${shift?.end_time?.slice(0,5) || pvz?.default_end_time?.slice(0,5) || "21:00"}">
    `, async () => {
      const employeeId = document.getElementById("f_emp_hidden").value || null;
      const start = document.getElementById("f_start").value;
      const end = document.getElementById("f_end").value;
      try {
        await Api.upsertShift({
          id: shiftId || undefined, pvz_id: pvzId, shift_date: dStr,
          start_time: start, end_time: end, employee_id: employeeId,
          status: employeeId ? "confirmed" : "free",
        });
        toast("✅ Смена сохранена");
        await reloadShifts();
        renderCalendar();
        openDayShiftsModal(pvzId, day);
      } catch (e) {
        toast("🚫 " + e.message);
      }
    }, shiftId ? {
      label: "Удалить",
      action: async () => {
        try {
          await Api.deleteShift(shiftId);
          toast("🗑️ Смена удалена");
          await reloadShifts();
          renderCalendar();
        } catch (e) { toast("🚫 " + e.message); }
      },
    } : null);
  }

  async function deleteShiftConfirm(shiftId, pvzId, day) {
    if (!confirm("Удалить эту смену?")) return;
    try {
      await Api.deleteShift(shiftId);
      toast("🗑️ Смена удалена");
      await reloadShifts();
      renderCalendar();
      openDayShiftsModal(pvzId, day);
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  function openShiftRequestsModal(shiftId) {
    const list = state.requests
      .filter((r) => r.shift_id === shiftId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const rowsHtml = list.map((r, i) => `
      <div class="request-card" style="margin-bottom:6px;">
        <div class="info">
          <div class="name">${i + 1}. ${escapeHtml(r.employees?.full_name || "—")}</div>
          <div class="details">Откликнулся: ${new Date(r.created_at).toLocaleString("ru-RU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}</div>
        </div>
        <div class="actions">
          <button class="approve" onclick="App.resolveRequest('${r.id}', '${shiftId}', '${r.employee_id}', true)">✅</button>
          <button class="reject" onclick="App.resolveRequest('${r.id}', '${shiftId}', '${r.employee_id}', false)">❌</button>
        </div>
      </div>`).join("");

    openModal("Отклики на смену (по порядку)", rowsHtml || '<div class="center-msg">Откликов нет</div>', null);
  }

  // ---------------- ПОИСК СОТРУДНИКА (переиспользуемый виджет) ----------------
  function renderEmpPicker(selectedId) {
    const freeItem = `<div class="emp-picker-item ${!selectedId ? "selected" : ""}" data-always="1" onclick="App._selectEmp(this,'')">
      <span class="dot" style="background:#8e8e93;"></span>🆓 Свободно (без сотрудника)
    </div>`;
    const items = state.employees
      .filter((e) => e.is_active !== false)
      .map((e) => `<div class="emp-picker-item ${selectedId === e.id ? "selected" : ""}" data-name="${escapeHtml(e.full_name.toLowerCase())}" onclick="App._selectEmp(this,'${e.id}')">
        <span class="dot" style="background:${colorForName(e.full_name)};"></span>${escapeHtml(e.full_name)}
      </div>`).join("");

    return `<div class="emp-picker">
      <input type="text" placeholder="Поиск сотрудника..." oninput="App._filterEmpPicker(this)">
      <input type="hidden" id="f_emp_hidden" value="${selectedId || ""}">
      <div class="emp-picker-list" id="empPickerList">${freeItem}${items}</div>
    </div>`;
  }

  function _filterEmpPicker(inputEl) {
    const q = inputEl.value.toLowerCase().trim();
    const list = inputEl.parentElement.querySelector(".emp-picker-list");
    list.querySelectorAll(".emp-picker-item").forEach((item) => {
      if (item.dataset.always === "1") { item.style.display = "flex"; return; }
      const match = (item.dataset.name || "").includes(q);
      item.style.display = match ? "flex" : "none";
    });
  }

  function _selectEmp(itemEl, empId) {
    const list = itemEl.closest(".emp-picker-list");
    list.querySelectorAll(".emp-picker-item").forEach((i) => i.classList.remove("selected"));
    itemEl.classList.add("selected");
    document.getElementById("f_emp_hidden").value = empId;
  }

  // ---------------- МОИ СМЕНЫ / ЗАЯВКИ ----------------
  function renderMyShifts() {
    const container = document.getElementById("myShiftsContainer");
    if (!container) return;
    if (state.demo) { container.innerHTML = `<div class="center-msg">Нет данных</div>`; return; }

    const mineConfirmed = state.shifts.filter((s) => s.employee_id === state.employee.id);
    const minePending = state.myRequests.filter((r) => r.shifts); // из shift_requests, ещё не подтверждено

    const items = [
      ...mineConfirmed.map((s) => ({ pending: false, date: s.shift_date, start: s.start_time, end: s.end_time, pvzId: s.pvz_id })),
      ...minePending.map((r) => ({ pending: true, date: r.shifts.shift_date, start: r.shifts.start_time, end: r.shifts.end_time, pvzName: r.shifts.pvz?.name, pvzColor: r.shifts.pvz?.color })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    if (items.length === 0) {
      container.innerHTML = `<div class="center-msg">В этом месяце смен пока нет</div>`;
      return;
    }

    container.innerHTML = items.map((it) => {
      const pvz = it.pvzId ? state.pvz.find((p) => p.id === it.pvzId) : null;
      const pvzName = pvz?.name || it.pvzName || "—";
      const pvzColor = pvz?.color || it.pvzColor || "#007aff";
      const dateObj = new Date(it.date + "T00:00:00");
      const dateLabel = dateObj.toLocaleDateString("ru-RU", { day: "numeric", month: "short", weekday: "short" });
      return `<div class="my-shift-card" style="border-left-color:${pvzColor};">
        <div class="info">
          <div class="pzv-name">🏢 ${escapeHtml(pvzName)}</div>
          <div class="date-time">${dateLabel} • ${it.start.slice(0,5)}–${it.end.slice(0,5)}</div>
          ${it.pending ? `<div class="status-badge pending">⏳ Заявка отправлена</div>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  function renderRequests() {
    const container = document.getElementById("requestsContainer");
    const badge = document.getElementById("requestsBadge");
    if (!container) return;
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
            <button class="approve" onclick="App.resolveRequest('${r.id}', '${r.shift_id}', '${r.employee_id}', true)">✅</button>
            <button class="reject" onclick="App.resolveRequest('${r.id}', '${r.shift_id}', '${r.employee_id}', false)">❌</button>
          </div>
        </div>`).join("");
    }
  }

  async function resolveRequest(requestId, shiftId, employeeId, approve) {
    try {
      await Api.resolveRequest(requestId, shiftId, employeeId, approve);
      toast(approve ? "✅ Заявка одобрена, остальные отклики на эту смену закрыты" : "❌ Заявка отклонена");
      await reloadRequests();
      await reloadShifts();
      renderRequests();
      renderCalendar();
      closeModal();
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  // ---------------- СОТРУДНИКИ ----------------
  function renderEmployees() {
    const container = document.getElementById("employeeList");
    const countEl = document.getElementById("employeeCount");
    if (countEl) countEl.textContent = state.demo ? "" : `${state.employees.length} чел.`;
    if (!container) return;
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
          <button class="delete admin-only" onclick="App.openDeleteEmployeeModal('${e.id}', '${escapeHtml(e.full_name)}')" title="Уволить">🗑️</button>
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
    openModal(`Редактировать: ${escapeHtml(emp.full_name)}`, `
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

  function openDeleteEmployeeModal(id, name) {
    openModal(`Уволить: ${escapeHtml(name)}`, `
      <p style="font-size:13px; color:var(--text); line-height:1.5; margin-bottom:10px;">
        После увольнения данные сотрудника будут удалены из базы через 7 дней без возможности восстановления.
        Рекомендуем сначала скачать его историю смен и зарплат.
      </p>
      <button type="button" class="add-shift-btn" onclick="App.exportEmployeeHistory('${id}','${escapeHtml(name)}')">📥 Скачать данные сотрудника</button>
    `, null, {
      label: "🗑️ Уволить",
      action: async () => {
        try {
          await Api.deleteEmployee(id);
          toast("✅ Уволен. Данные будут удалены через 7 дней");
          state.employees = await Api.getEmployees();
          renderEmployees();
          renderManagement();
        } catch (e) { toast("🚫 " + e.message); }
      },
    });
  }

  async function exportEmployeeHistory(employeeId, name) {
    const data = await Api.getEmployeeFullHistory(employeeId);
    let csv = "Тип;Дата/Месяц;ПВЗ;Начало;Конец;Сумма;Причина\n";
    data.shifts.forEach((s) => {
      const pvz = s.pvz || state.pvz.find((p) => p.id === s.pvz_id);
      const amount = Math.round(shiftAmount(s, pvz));
      csv += `Смена;${s.shift_date};${pvz?.name || ""};${s.start_time?.slice(0,5) || ""};${s.end_time?.slice(0,5) || ""};${amount};\n`;
    });
    data.bonusesFines.forEach((b) => {
      csv += `${b.kind === "bonus" ? "Бонус" : "Штраф"};${b.period_month};;;;${b.amount};${(b.reason || "").replace(/;/g, ",")}\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "_")}_история.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("✅ Файл скачан");
  }

  function openChat(username) {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/${username}`);
    else window.open(`https://t.me/${username}`, "_blank");
  }

  // ---------------- ПРОФИЛЬ ----------------
  function renderProfile() {
    const e = state.employee;
    const avatarEl = document.getElementById("profileAvatar");
    if (avatarEl) avatarEl.childNodes[0].nodeValue = e.avatar_emoji || "👤";
    const nameEl = document.getElementById("profileName");
    if (nameEl) nameEl.textContent = e.full_name;
    const roleEl = document.getElementById("profileRole");
    if (roleEl) roleEl.textContent = e.position || "Сотрудник";
    const tgEl = document.getElementById("profileTgId");
    if (tgEl) tgEl.textContent = e.tg_username ? `🆔 @${e.tg_username}` : `🆔 ${e.tg_id}`;

    if (state.demo) return;

    const myShifts = state.shifts.filter((s) => s.employee_id === e.id);
    document.getElementById("statShifts").textContent = myShifts.length;
    const totalHours = myShifts.reduce((sum, s) => sum + hoursBetween(s.start_time, s.end_time), 0);
    document.getElementById("statHours").textContent = Math.round(totalHours);

    const incomeContainer = document.getElementById("incomeContainer");
    let total = 0;

    const pendingRows = state.myRequests.filter((r) => r.shifts).map((r) => {
      const s = r.shifts;
      return `<div class="profile-income-item">
        <div class="left"><div class="title">⏳ ${escapeHtml(s.pvz?.name || "—")}</div><div class="desc">${s.shift_date}, ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} • заявка на рассмотрении</div></div>
        <div class="right" style="color:var(--text-secondary); font-weight:500;">—</div>
      </div>`;
    });

    const confirmedRows = myShifts
      .slice()
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date))
      .map((s) => {
        const pvz = state.pvz.find((p) => p.id === s.pvz_id);
        const amount = Math.round(shiftAmount(s, pvz));
        total += amount;
        return `<div class="profile-income-item">
          <div class="left"><div class="title">🏢 ${escapeHtml(pvz?.name || "—")}</div><div class="desc">${s.shift_date}, ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</div></div>
          <div class="right">${amount.toLocaleString("ru-RU")} ₽</div>
        </div>`;
      });

    let rows = pendingRows.concat(confirmedRows);

    const myBF = state.bonusesFines.filter((b) => b.employee_id === e.id);
    myBF.forEach((b) => {
      const sign = b.kind === "bonus" ? 1 : -1;
      total += sign * Number(b.amount);
      rows.push(`<div class="profile-income-item">
        <div class="left"><div class="title">${b.kind === "bonus" ? "⭐ Бонус" : "⚠️ Штраф"}</div><div class="desc">${escapeHtml(b.reason || "")}</div></div>
        <div class="right ${b.kind}">${sign > 0 ? "+" : "-"}${Number(b.amount).toLocaleString("ru-RU")} ₽</div>
      </div>`);
    });

    incomeContainer.innerHTML = rows.join("") || `<div class="center-msg">Пока нет данных за месяц</div>`;
    document.getElementById("profileTotal").textContent = `${Math.round(total).toLocaleString("ru-RU")} ₽`;

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
        ${emojis.map((em) => `<button type="button" onclick="App._pickAvatar('${em}')" style="border:none; background:var(--card-secondary); border-radius:12px; padding:8px 0; cursor:pointer;">${em}</button>`).join("")}
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
    const listEl = document.getElementById("financeEmployeeList");
    if (!listEl) return;
    if (!state.employee.is_admin || state.demo) return;

    renderPurgeWarning();

    let fund = 0, totalShiftsAll = 0;

    const rows = state.employees.filter((e) => e.is_active !== false).map((e) => {
      const empShifts = state.shifts.filter((s) => s.employee_id === e.id);
      const base = empShifts.reduce((sum, s) => sum + shiftAmount(s, state.pvz.find((p) => p.id === s.pvz_id)), 0);
      const bf = state.bonusesFines.filter((b) => b.employee_id === e.id);
      const bonuses = bf.filter((b) => b.kind === "bonus");
      const fines = bf.filter((b) => b.kind === "fine");
      const bonusSum = bonuses.reduce((s, b) => s + Number(b.amount), 0);
      const fineSum = fines.reduce((s, b) => s + Number(b.amount), 0);
      const amount = base + bonusSum - fineSum;
      fund += amount;
      totalShiftsAll += empShifts.length;

      const empPvzIds = new Set(empShifts.map((s) => s.pvz_id));
      const markets = new Set([...empPvzIds].map((id) => state.pvz.find((p) => p.id === id)?.marketplace).filter(Boolean));

      return `<div class="finance-employee">
        <div class="left">
          <div class="name">${escapeHtml(e.full_name)}</div>
          <div class="details">${empShifts.length} смен • ${Math.round(base).toLocaleString("ru-RU")} ₽ по тарифам ПВЗ</div>
          ${bonuses.map((b) => `<div class="bonus-list">✨ Бонус: +${b.amount}₽ ${b.reason ? "(" + escapeHtml(b.reason) + ")" : ""}</div>`).join("")}
          ${fines.map((b) => `<div class="fine-list">⚠️ Штраф: -${b.amount}₽ ${b.reason ? "(" + escapeHtml(b.reason) + ")" : ""}</div>`).join("")}
        </div>
        <div class="right">
          ${[...markets].map((m) => `<span class="market-tag ${m}">${m.toUpperCase()}</span>`).join("")}
          <span class="amount">${Math.round(amount).toLocaleString("ru-RU")} ₽</span>
        </div>
      </div>`;
    }).join("");

    listEl.innerHTML = rows || `<div class="center-msg">Нет сотрудников</div>`;
    document.getElementById("totalFund").textContent = `${Math.round(fund).toLocaleString("ru-RU")} ₽`;
    document.getElementById("totalFundSub").innerHTML = `${state.employees.length} сотрудников • <span>${totalShiftsAll}</span> смен за месяц`;
    document.getElementById("financeGrandTotal").textContent = `${Math.round(fund).toLocaleString("ru-RU")} ₽`;

    document.getElementById("pvzTagRow").innerHTML = state.pvz.map((p) => `
      <div class="pvz-grid-item">
        <button class="pvz-edit-rate" onclick="App.openPvzRateModal('${p.id}')" title="Тарифы">✏️</button>
        <button class="pvz-remove" onclick="App.deletePvzConfirm('${p.id}', '${escapeHtml(p.name)}')" title="Удалить">✕</button>
        <span class="dot" style="background:${p.color};"></span>
        <span class="pvz-name">${escapeHtml(p.name)}</span>
      </div>`).join("");
  }

  function openPvzRateModal(pvzId) {
    const pvz = state.pvz.find((p) => p.id === pvzId);
    if (!pvz) return;
    openModal(`Тарифы: ${escapeHtml(pvz.name)}`, `
      <label>Полная смена, ₽</label>
      <input type="number" id="f_full" value="${pvz.full_shift_pay}" min="0">
      <label>"Вечерняя" смена, ₽</label>
      <input type="number" id="f_evening" value="${pvz.evening_pay}" min="0">
      <label>С какого часа смена считается вечерней (0–23)</label>
      <input type="number" id="f_threshold" value="${pvz.evening_threshold}" min="0" max="23">
      <label>Промежуточная смена (не в открытие и не вечером), ₽/час</label>
      <input type="number" id="f_mid" value="${pvz.mid_hourly_rate ?? 200}" min="0">
      <label>Стандартное начало смены (это время = "полная смена")</label>
      <input type="time" id="f_dstart" value="${pvz.default_start_time?.slice(0,5) || "09:00"}">
      <label>Стандартный конец смены</label>
      <input type="time" id="f_dend" value="${pvz.default_end_time?.slice(0,5) || "21:00"}">
    `, async () => {
      const full_shift_pay = Number(document.getElementById("f_full").value);
      const evening_pay = Number(document.getElementById("f_evening").value);
      const evening_threshold = Number(document.getElementById("f_threshold").value);
      const mid_hourly_rate = Number(document.getElementById("f_mid").value);
      const default_start_time = document.getElementById("f_dstart").value;
      const default_end_time = document.getElementById("f_dend").value;
      if (!full_shift_pay || full_shift_pay <= 0) return toast("Введите сумму за полную смену");
      try {
        await Api.updatePvz(pvzId, { full_shift_pay, evening_pay, evening_threshold, mid_hourly_rate, default_start_time, default_end_time });
        toast("✅ Тарифы обновлены");
        state.pvz = await Api.getPvzList();
        renderManagement();
        renderCalendar();
        renderProfile();
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
        toast("✅ ПВЗ добавлен, не забудьте настроить тарифы (✏️)");
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

  async function bulkFreeMonthConfirm() {
    const label = `${MONTHS[state.month]} ${state.year}`;
    if (!confirm(`Создать свободные смены на все дни ${label} для всех ПВЗ, где смен ещё нет? Уже назначенные смены не тронет.`)) return;
    try {
      const count = await Api.bulkCreateFreeMonth(state.year, state.month);
      toast(count > 0 ? `✅ Создано свободных смен: ${count}` : "Нечего создавать — все дни уже заняты сменами");
      await reloadShifts();
      renderCalendar();
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  function exportPayroll() {
    let csv = "Сотрудник;Смены;Сумма по тарифам;Бонусы;Штрафы;Итого\n";
    state.employees.filter((e) => e.is_active !== false).forEach((e) => {
      const empShifts = state.shifts.filter((s) => s.employee_id === e.id);
      const base = empShifts.reduce((sum, s) => sum + shiftAmount(s, state.pvz.find((p) => p.id === s.pvz_id)), 0);
      const bf = state.bonusesFines.filter((b) => b.employee_id === e.id);
      const bonusSum = bf.filter((b) => b.kind === "bonus").reduce((s, b) => s + Number(b.amount), 0);
      const fineSum = bf.filter((b) => b.kind === "fine").reduce((s, b) => s + Number(b.amount), 0);
      const total = base + bonusSum - fineSum;
      csv += `${e.full_name};${empShifts.length};${Math.round(base)};${bonusSum};${fineSum};${Math.round(total)}\n`;
    });
    downloadCsv(csv, `payroll_${state.year}_${state.month + 1}.csv`);
  }

  function exportShiftsDetailed() {
    let csv = "Дата;ПВЗ;Сотрудник;Начало;Конец;Статус;Сумма\n";
    state.shifts.slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date)).forEach((s) => {
      const pvz = state.pvz.find((p) => p.id === s.pvz_id);
      const empName = s.employees?.full_name || "";
      const amount = s.employee_id ? Math.round(shiftAmount(s, pvz)) : "";
      csv += `${s.shift_date};${pvz?.name || ""};${empName};${s.start_time?.slice(0,5)};${s.end_time?.slice(0,5)};${s.status};${amount}\n`;
    });
    downloadCsv(csv, `смены_${state.year}_${state.month + 1}.csv`);
  }

  function downloadCsv(csv, filename) {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // экспорт произвольного (в т.ч. прошлого) месяца, не трогая текущий вид календаря
  async function exportMonth(year, month) {
    try {
      const [shifts, bf] = await Promise.all([
        Api.getShiftsForMonth(year, month),
        Api.getBonusesFines(year, month),
      ]);
      let csv = "Дата;ПВЗ;Сотрудник;Начало;Конец;Статус;Сумма\n";
      shifts.slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date)).forEach((s) => {
        const pvz = state.pvz.find((p) => p.id === s.pvz_id);
        const empName = s.employees?.full_name || "";
        const amount = s.employee_id ? Math.round(shiftAmount(s, pvz)) : "";
        csv += `${s.shift_date};${pvz?.name || ""};${empName};${s.start_time?.slice(0,5)};${s.end_time?.slice(0,5)};${s.status};${amount}\n`;
      });
      csv += "\nБонусы/Штрафы\nСотрудник;Тип;Сумма;Причина\n";
      bf.forEach((b) => {
        const emp = state.employees.find((e) => e.id === b.employee_id);
        csv += `${emp?.full_name || "—"};${b.kind === "bonus" ? "Бонус" : "Штраф"};${b.amount};${(b.reason || "").replace(/;/g, ",")}\n`;
      });
      downloadCsv(csv, `данные_${year}_${month + 1}.csv`);
      toast("✅ Файл скачан");
    } catch (e) {
      toast("🚫 " + e.message);
    }
  }

  function renderPurgeWarning() {
    const el = document.getElementById("purgeWarning");
    if (!el) return;
    const now = new Date();
    const day = now.getDate();
    if (day >= 10 && day <= 14) {
      let prevMonth = now.getMonth() - 1, prevYear = now.getFullYear();
      if (prevMonth < 0) { prevMonth = 11; prevYear--; }
      const daysLeft = 15 - day;
      el.style.display = "block";
      el.innerHTML = `⚠️ Через ${daysLeft} дн. (15 числа) будут удалены смены и финансы за ${MONTHS[prevMonth].toLowerCase()} и раньше.
        <button type="button" onclick="App.exportMonth(${prevYear}, ${prevMonth})">📥 Скачать за ${MONTHS[prevMonth].toLowerCase()}</button>`;
    } else {
      el.style.display = "none";
    }
  }

  // ---------------- УНИВЕРСАЛЬНАЯ МОДАЛКА ----------------
  function openModal(title, bodyHtml, onConfirm, extraAction) {
    const box = document.getElementById("modalBox");
    box.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${bodyHtml}
      <div class="modal-actions">
        <button class="btn-cancel" onclick="App.closeModal()">Закрыть</button>
        ${extraAction ? `<button class="btn-danger" id="modalExtraBtn">${escapeHtml(extraAction.label)}</button>` : ""}
        ${onConfirm ? `<button class="btn-confirm" id="modalConfirmBtn">Сохранить</button>` : ""}
      </div>
    `;
    document.getElementById("modalOverlay").classList.add("show");
    if (onConfirm) {
      document.getElementById("modalConfirmBtn").onclick = async () => { await onConfirm(); };
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
    applyForShift, openDayShiftsModal, openShiftForm, deleteShiftConfirm, openShiftRequestsModal, resolveRequest,
    _filterEmpPicker, _selectEmp,
    filterEmployees, openAddEmployeeModal, openEditEmployeeModal, openDeleteEmployeeModal, exportEmployeeHistory, openChat,
    changeAvatar, _pickAvatar, togglePush, saveNotificationSettings,
    openPvzRateModal, openBonusFineModal, openAddPvzModal, deletePvzConfirm, bulkFreeMonthConfirm,
    exportPayroll, exportShiftsDetailed, exportMonth,
    closeModal,
  };
})();

window.addEventListener("DOMContentLoaded", () => App.init());
