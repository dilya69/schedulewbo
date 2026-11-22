// ============================================================
// АДМИНКА ДЛЯ КОМПЬЮТЕРА — отдельная страница (admin.html).
// Те же данные и тот же вход через Telegram, что и в мини-приложении
// (Api из api.js), только раскладка под большой экран.
// ============================================================
const Admin = (() => {
  const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const WD = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
  const PALETTE = ["#FACC15","#F97316","#EF4444","#EC4899","#A855F7","#8B5CF6","#3B82F6","#06B6D4","#14B8A6","#16A34A","#84CC16","#64748B"];
  const QUICK = [["с 17","Приходит к 17:00"],["до 19","Уходит в 19:00"],["с 9 до 17","Часть смены по времени"],["2ч","Короткая смена на 2 часа"],["?","Свободная смена, ждёт отклика"]];
  const GROUPS = [
    { k: "g1", l: "Смены", it: [["cal", "График"], ["req", "Заявки на смены"], ["wish", "Пожелания по графику"], ["check", "Сверка смен"]] },
    { k: "g2", l: "Люди и деньги", it: [["emp", "Сотрудники"], ["act", "Активность"], ["bcast", "Рассылка"], ["pay", "Зарплата"], ["tickets", "Тикеты"], ["bonus", "Бонусы и штрафы"], ["acc", "Приёмка WB"]] },
    { k: "g3", l: "Данные", it: [["import", "Импорт из Excel"], ["export", "Экспорт"], ["botchat", "Чат бота"]] },
  ];
  const IN_APP = { check: "Сверка смен", pay: "Зарплата", tickets: "Тикеты", bonus: "Бонусы и штрафы", acc: "Приёмка WB", import: "Импорт из Excel", export: "Экспорт" };

  const now = new Date();
  const S = {
    me: null, sec: "cal", pvzId: null, year: now.getFullYear(), month: now.getMonth(),
    sel: now.getDate(), pvz: [], shifts: [], employees: [], requests: [], q: "", busy: false,
    closed: {},
  };
  try { S.closed = JSON.parse(localStorage.getItem("adm-closed") || "{}"); } catch (e) { /* без памяти */ }
  try { S.pvzId = localStorage.getItem("adm-pvz") || null; } catch (e) { /* без памяти */ }

  // разделы и действия, которые подключают другие файлы (admin-pay.js и т.д.)
  const SECS = {};
  const ACTS = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const tint = (c, k) => `color-mix(in srgb, ${c} ${k}%, #fff)`;
  const fullName = (e) => String((e && (e.real_name || e.full_name)) || "").trim();
  const curPvz = () => S.pvz.find((p) => p.id === S.pvzId) || S.pvz[0];
  const daysIn = () => new Date(S.year, S.month + 1, 0).getDate();

  let toastT;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("on"), 3200);
  }

  // ---------- время смены ----------
  const hh = (t) => {
    const [h, m] = String(t).slice(0, 5).split(":");
    return Number(h) + (Number(m) ? ":" + m : "");
  };
  const toMin = (t) => { const [h, m] = String(t || "0:0").slice(0, 5).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const toHHMM = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

  // подпись времени: полная смена — пусто, иначе «с 17», «до 19», «с 9 до 17», «2ч»
  function timeLabel(s, p) {
    if (s.duration_minutes) {
      const h = s.duration_minutes / 60;
      return `${Number.isInteger(h) ? h : h.toFixed(1)}ч`;
    }
    const ds = (p?.default_start_time || "09:00").slice(0, 5), de = (p?.default_end_time || "21:00").slice(0, 5);
    const a = s.start_time.slice(0, 5), b = s.end_time.slice(0, 5);
    const late = toMin(a) > toMin(ds), early = toMin(b) < toMin(de);
    if (late && early) return `с ${hh(a)} до ${hh(b)}`;
    if (late) return `с ${hh(a)}`;
    if (early) return `до ${hh(b)}`;
    return "";
  }

  // «Катя с 17», «Коля до 19», «Даня с 9 до 17», «Женя 2ч», «?»  →  поля смены
  function parseInput(text, p) {
    const t = text.trim().replace(/\s+/g, " ");
    const ds = (p?.default_start_time || "09:00").slice(0, 5), de = (p?.default_end_time || "21:00").slice(0, 5);
    if (t === "?") return { free: true, start: ds, end: de };
    let name = t, start = ds, end = de, dur = null, m;
    if ((m = t.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*ч$/i))) {
      name = m[1]; dur = Math.round(Number(m[2].replace(",", ".")) * 60);
      if (!(dur > 0 && dur <= 720)) return { error: "Длительность от 0.5 до 12 часов" };
      end = toHHMM(toMin(ds) + dur);
    } else if ((m = t.match(/^(.+?)\s+((?:с|до)\s.+)$/i))) {
      name = m[1];
      const a = m[2].match(/(?:^|\s)с\s+(\d{1,2})(?::(\d{2}))?/i);
      const b = m[2].match(/(?:^|\s)до\s+(\d{1,2})(?::(\d{2}))?/i);
      if (a) start = `${pad2(a[1])}:${a[2] || "00"}`;
      if (b) end = `${pad2(b[1])}:${b[2] || "00"}`;
      if (toMin(start) >= toMin(end)) return { error: "Начало должно быть раньше конца" };
    }
    return { name: name.trim(), start, end, dur };
  }

  function findEmployee(name) {
    const n = name.toLowerCase().replace(/ё/g, "е");
    const act = S.employees.filter((e) => e.is_active !== false);
    const keys = (e) => [e.full_name, e.real_name].filter(Boolean).map((x) => String(x).trim().toLowerCase().replace(/ё/g, "е"));
    return act.find((e) => keys(e).includes(n)) || act.find((e) => keys(e).some((k) => k.startsWith(n)));
  }

  // ---------- данные ----------
  // смены на сегодня живут отдельно от просматриваемого месяца: блок «Сегодня» виден всегда
  const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  async function loadShifts() {
    S.shifts = await Api.getShiftsForMonth(S.year, S.month);
    if (S.year === new Date().getFullYear() && S.month === new Date().getMonth()) { S.todayShifts = S.shifts; S.todayKey = monthKey(new Date()); }
  }
  async function loadToday() {
    const t = new Date();
    if (S.year === t.getFullYear() && S.month === t.getMonth()) { S.todayShifts = S.shifts; }
    else S.todayShifts = await Api.getShiftsForMonth(t.getFullYear(), t.getMonth());
    S.todayKey = monthKey(t);
  }
  async function loadRequests() { S.requests = await Api.getPendingRequests(); }
  async function loadAll() {
    S.pvz = await Api.getPvzList();
    if (!S.pvz.find((p) => p.id === S.pvzId)) S.pvzId = S.pvz[0]?.id || null;
    S.employees = await Api.getEmployees();
    await Promise.all([loadShifts(), loadRequests()]);
    await loadToday();
  }

  // ---------- Сегодня: кто на смене, по адресам ----------
  // «Ярославский 1 WB» и «Ярославский 1 Ozon» -> один адрес «Ярославский 1»
  const MP_TOK = new Set(["wb", "ozon", "вб", "озон", "wildberries"]);
  const addrKey = (name) => String(name || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 ]/g, " ").split(" ")
    .filter((t) => t && !MP_TOK.has(t)).map((t) => t.replace(/^к(\d+)$/, "$1")).join(" ");
  const addrLabel = (name) => String(name || "").replace(/(^|\s)(wb|ozon|вб|озон|wildberries)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim() || String(name || "");

  function todayBlock() {
    const t = new Date();
    const k = ymd(t.getFullYear(), t.getMonth(), t.getDate());
    if (S.todayKey !== monthKey(t) && !S.todayLoading) { // страница открыта с прошлого месяца — подтянуть заново
      S.todayLoading = true;
      loadToday().catch(() => {}).finally(() => { S.todayLoading = false; if (S.sec === "cal") render(); });
    }
    const list = (S.todayShifts || []).filter((s) => s.shift_date === k);
    const groups = [];
    const byKey = {};
    S.pvz.forEach((p) => {
      const key = addrKey(p.name);
      if (!byKey[key]) { byKey[key] = { label: addrLabel(p.name), items: [] }; groups.push(byKey[key]); }
      byKey[key].items.push(p);
    });
    const people = new Set(list.filter((s) => s.employee_id).map((s) => s.employee_id)).size;
    const free = list.filter((s) => !s.employee_id).length;
    const cards = groups.map((g) => {
      g.items.sort((a, b) => (a.marketplace === b.marketplace ? 0 : a.marketplace === "wb" ? -1 : 1));
      const rows = g.items.map((p) => {
        const sh = list.filter((s) => s.pvz_id === p.id)
          .sort((a, b) => (a.employee_id ? 0 : 1) - (b.employee_id ? 0 : 1) || a.start_time.localeCompare(b.start_time));
        const chips = sh.map((s) => {
          if (!s.employee_id) return s.status === "pending" ? '<span class="ch pend">? есть отклики</span>' : '<span class="ch q">? свободна</span>';
          const lb = timeLabel(s, p);
          return `<span class="ch" style="background:${tint(p.color, 42)}">${esc(s.employees?.full_name || "?")}${lb ? ` <i>${lb}</i>` : ""}</span>`;
        }).join("");
        return `<button class="trow ${p.id === S.pvzId ? "on" : ""}" data-tp="${p.id}" style="border-left-color:${p.color};${p.id === S.pvzId ? `background:${tint(p.color, 14)}` : ""}" data-tip="Открыть график этого ПВЗ">
          <span class="mtag ${p.marketplace === "wb" ? "wb" : "ozon"}">${p.marketplace === "wb" ? "WB" : "Ozon"}</span>
          <span class="tpeople">${chips || '<span class="mut">никого</span>'}</span></button>`;
      }).join("");
      return `<div class="tg"><div class="tgt">${esc(g.label)}</div>${rows}</div>`;
    }).join("");
    return `<div class="card today"><div class="thead"><div class="ttl2"><span class="tbadge">Сегодня</span><b>${WD[t.getDay()]}, ${t.getDate()} ${MONTHS_GEN[t.getMonth()]}</b></div>
      <div style="display:flex;gap:8px"><span class="pill">На смене: ${people}</span>${free ? `<span class="pill" style="background:#FFF4DC;color:#7A4B00;border-color:#F0D79A">${free} свободных</span>` : ""}</div></div>
      <div class="tgrid">${cards}</div></div>`;
  }

  function openToday(id) {
    const t = new Date();
    S.pvzId = id;
    try { localStorage.setItem("adm-pvz", id); } catch (_) { /* */ }
    const same = S.year === t.getFullYear() && S.month === t.getMonth();
    S.year = t.getFullYear(); S.month = t.getMonth(); S.sel = t.getDate();
    if (same) return render();
    loadShifts().then(render).catch((er) => toast("🚫 " + er.message));
  }
  const isCurrentMonth = () => S.year === now.getFullYear() && S.month === now.getMonth();
  function dayShifts(pvzId, d) {
    const k = ymd(S.year, S.month, d);
    return S.shifts.filter((s) => s.pvz_id === pvzId && s.shift_date === k)
      .sort((a, b) => (a.employee_id ? 0 : 1) - (b.employee_id ? 0 : 1) || a.start_time.localeCompare(b.start_time));
  }

  // ---------- каркас ----------
  // иконки Lucide (lucide.dev), вшиты в код, чтобы ничего не грузить из сети
  const LI = {
    g1: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    g2: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    g3: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    req: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    wish: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    emp: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    act: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    bcast: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    pay: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    tickets: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
    bonus: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    acc: '<path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/>',
    import: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M12 12v6M15 15l-3-3-3 3"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    botchat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    pvz: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/>',
    close: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18M16 15l-3-3 3-3"/>',
    open: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18M14 9l3 3-3 3"/>',
  };
  const ico = (k) => `<svg class="li" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LI[k] || ""}</svg>`;
  try { S.rail = localStorage.getItem("adm-rail") === "1"; } catch (e) { /* без памяти */ }

  function nav() {
    $("app").classList.toggle("rail", !!S.rail);
    const fsOn = !!(window.Telegram?.WebApp?.isFullscreen || document.fullscreenElement);
    let h = `<div class="brand"><span class="lbl">Смены ПВЗ</span><button class="fsbtn" data-fs="1" data-rt="${fsOn ? "Обычное окно" : "Полный экран"}" title="${fsOn ? "Обычное окно" : "Полный экран"}">${fsOn ? "⤡" : "⛶"}</button><button class="railbtn" data-rail="1" data-rt="${S.rail ? "Развернуть меню" : "Свернуть меню"}" aria-label="${S.rail ? "Развернуть меню" : "Свернуть меню"}">${ico(S.rail ? "open" : "close")}</button></div>`;
    GROUPS.forEach((g) => {
      const cl = S.closed[g.k];
      h += `<button class="grp ${cl ? "closed" : ""}" data-g="${g.k}" data-rt="${g.l}"><span class="gi">${ico(g.k)}</span><span class="lbl">${g.l}</span><span class="chev">›</span></button><div class="items ${cl ? "closed" : ""}">`;
      g.it.forEach(([id, name]) => {
        const n = id === "req" ? S.requests.length : 0;
        const badge = n ? `<span class="badge" data-tip="Новых заявок: ${n}">${n}</span>` : "";
        h += `<button class="nav ${S.sec === id ? "on" : ""}" data-s="${id}" data-rt="${name}">${ico(id)}<span class="lbl">${name}</span>${badge}</button>`;
      });
      h += "</div>";
    });
    return h + `<div class="foot"><button class="nav ${S.sec === "pvz" ? "on" : ""}" data-s="pvz" data-rt="Управление ПВЗ">${ico("pvz")}<span class="lbl">Управление ПВЗ</span></button></div>`;
  }

  function render() {
    $("side").innerHTML = nav();
    const views = { cal: viewCal, req: viewReq, emp: viewEmp, pvz: viewPvz };
    $("main").innerHTML = (SECS[S.sec]?.view || views[S.sec] || viewOther)();
    const q = $("q");
    if (q) {
      q.addEventListener("input", (e) => { S.q = e.target.value; });
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") addShift(); });
    }
  }

  async function go(sec) {
    S.sec = sec;
    render();
    const d = SECS[sec];
    if (d?.enter) {
      try { await d.enter(); } catch (e) { toast("🚫 " + (e.message || e)); }
      if (S.sec === sec) render();
    }
  }

  // ---------- окно ----------
  function modal(title, body, onOk, okText) {
    const m = $("modal");
    m.innerHTML = `<div class="mbox"><div class="mhead"><div class="mtitle">${esc(title)}</div><button class="mx" data-mclose aria-label="Закрыть">✕</button></div><div class="mbody">${body}</div>
      <div class="mfoot"><button class="btn" data-mclose>${onOk ? "Отмена" : "Закрыть"}</button>${onOk ? `<button class="btn ok" id="mok">${esc(okText || "Сохранить")}</button>` : ""}</div></div>`;
    m.classList.add("on"); $("app").classList.add("pan");
    m.scrollTop = 0;
    if (onOk) $("mok").onclick = async () => { if ((await onOk()) !== false) closeModal(); };
    const f = m.querySelector("input,select,textarea");
    if (f) f.focus();
  }
  function closeModal() { const m = $("modal"); m.classList.remove("on"); m.innerHTML = ""; $("app").classList.remove("pan"); }

  // ---------- График ----------
  function pvzTabs(net) {
    return S.pvz.filter((p) => p.marketplace === net).map((p) => {
      const on = p.id === S.pvzId;
      return `<button class="pill" data-p="${p.id}" style="background:${on ? tint(p.color, 26) : "#fff"};border-color:${on ? p.color : "#E1E4EB"}"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</button>`;
    }).join("");
  }

  function viewCal() {
    const p = curPvz();
    if (!p) return `<div class="head"><h1>График</h1></div><div class="card side">Нет ПВЗ. Добавьте их в «Управление ПВЗ».</div>`;
    const c = p.color;
    const first = new Date(S.year, S.month, 1).getDay();
    const offset = first === 0 ? 6 : first - 1;
    const n = daysIn();
    const prevN = new Date(S.year, S.month, 0).getDate();
    let total = 0, free = 0, cells = "";
    for (let d = 1; d <= n; d++) dayShifts(p.id, d).forEach((s) => (s.employee_id ? total++ : free++));

    for (let i = 0; i < Math.ceil((offset + n) / 7) * 7; i++) {
      const d = i - offset + 1, inM = d >= 1 && d <= n;
      const num = d < 1 ? prevN + d : d > n ? d - n : d;
      const chips = inM ? dayShifts(p.id, d).map((s) => {
        if (!s.employee_id) return s.status === "pending" ? '<div class="ch pend">? есть отклики</div>' : '<div class="ch q">? свободна</div>';
        const lb = timeLabel(s, p);
        return `<div class="ch" style="background:${tint(c, 42)}">${esc(s.employees?.full_name || "?")}${lb ? ` <i>${lb}</i>` : ""}</div>`;
      }).join("") : "";
      const today = inM && isCurrentMonth() && d === now.getDate();
      cells += `<div class="c ${inM ? "" : "dim"} ${today ? "today" : ""}" ${inM ? `data-d="${d}"` : ""} style="background:${inM ? "rgba(255,255,255,.72)" : tint(c, 14)};${inM && d === S.sel ? `outline:2px solid ${c};outline-offset:-2px` : ""}"><span class="n">${num}</span>${chips}</div>`;
    }

    const sel = Math.min(S.sel, n);
    const rows = dayShifts(p.id, sel).map((s) => {
      const lb = timeLabel(s, p);
      const who = s.employee_id ? `${esc(s.employees?.full_name || "?")} · ${lb || "вся смена"}` : "Свободная смена";
      return `<div class="row"><span>${who}</span><span style="display:flex;gap:4px"><button class="sm" data-act="shift-edit:${s.id}" data-tip="Изменить смену" style="padding:3px 9px">✎</button><button class="sm" data-x="${s.id}" data-tip="Убрать смену" style="padding:3px 9px">✕</button></span></div>`;
    }).join("");
    const dow = WD[new Date(S.year, S.month, sel).getDay()];

    return `<div class="head"><div class="ttl"><i class="dot" style="width:16px;height:16px;background:${c}"></i><h1>${MONTHS[S.month]} · ${esc(p.name)} ${p.marketplace === "wb" ? "WB" : "Ozon"}</h1>
      <div class="stp"><button data-m="-1" data-tip="Предыдущий месяц">‹</button><button data-today style="font-size:13px;padding:0 10px" data-tip="К сегодняшнему дню">Сегодня</button><button data-m="1" data-tip="Следующий месяц">›</button></div></div>
      <div class="ag"><button data-freemonth data-tip="Создать свободные смены на дни, где смен ещё нет">Создать свободные смены</button><button data-sync data-tip="Загрузить график из файла по ссылкам автоимпорта">Обновить из Excel</button></div></div>
      ${todayBlock()}<div class="nets"><div class="netrow"><span class="net">WB</span>${pvzTabs("wb")}</div><div class="netrow"><span class="net">Ozon</span>${pvzTabs("ozon")}</div></div>
      <div class="layout"><div><div class="sum"><span class="pill">${total} смен</span><span class="pill" data-tip="Смены без сотрудника, на них можно откликнуться" style="background:#FFF4DC;color:#7A4B00;border-color:#F0D79A">${free} свободных</span></div>
      <div class="card calbox" style="background:${tint(c, 10)}"><div class="grid" style="margin-bottom:6px">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => `<div class="dow">${x}</div>`).join("")}</div><div class="grid">${cells}</div></div></div>
      <div class="card side"><div style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${c}"></i><b style="font-size:16px">${dow}, ${sel} ${MONTHS_GEN[S.month]}</b></div>
      <div class="mut" style="margin:2px 0 16px">${esc(p.name)} ${p.marketplace === "wb" ? "WB" : "Ozon"}</div>
      <div style="display:flex;gap:8px"><input class="fld" id="q" list="emps" value="${esc(S.q)}" placeholder="Имя, с 17, до 19, 2ч…" aria-label="Смена" autocomplete="off"><button class="sm d" data-add>Добавить</button></div>
      <datalist id="emps">${S.employees.filter((e) => e.is_active !== false).map((e) => `<option value="${esc(e.full_name)}">`).join("")}</datalist>
      <div style="margin:12px 0 6px;display:flex;gap:6px;flex-wrap:wrap">${QUICK.map((k) => `<button class="sm" data-q="${k[0]}" data-tip="${k[1]}">${k[0]}</button>`).join("")}</div>
      <div style="margin-top:10px">${rows || '<div class="mut" style="padding:10px 0">В этот день смен нет</div>'}</div>
      <button class="btn" data-act="shift-edit:" style="margin-top:12px;width:100%">+ Смена с настройками (время, сумма)</button></div></div>`;
  }

  async function addShift() {
    const p = curPvz();
    const text = ($("q")?.value ?? S.q).trim();
    if (!p || !text || S.busy) return;
    const r = parseInput(text, p);
    if (r.error) return toast("🚫 " + r.error);
    let emp = null;
    if (!r.free) {
      emp = findEmployee(r.name);
      if (!emp) return toast(`🚫 Нет сотрудника «${r.name}». Он должен быть в списке «Сотрудники»`);
      const day = dayShifts(p.id, S.sel).find((s) => s.employee_id === emp.id && !s.duration_minutes && !r.dur && toMin(s.start_time) < toMin(r.end) && toMin(s.end_time) > toMin(r.start));
      if (day && !confirm(`${emp.full_name} уже стоит на этот день с пересекающимся временем. Добавить ещё одну смену?`)) return;
    }
    S.busy = true;
    try {
      await Api.upsertShift({
        pvz_id: p.id, shift_date: ymd(S.year, S.month, S.sel), start_time: r.start, end_time: r.end,
        employee_id: emp ? emp.id : null, status: emp ? "confirmed" : "free", custom_amount: null, duration_minutes: r.dur || null,
      });
      S.q = "";
      await loadShifts();
      render();
      toast("✅ Смена добавлена");
    } catch (e) { toast("🚫 " + (e.message || e)); }
    S.busy = false;
  }

  async function removeShift(id) {
    const s = S.shifts.find((x) => x.id === id);
    if (!s) return;
    if (!confirm(s.employee_id ? `Убрать смену: ${s.employees?.full_name || "?"}?` : "Убрать свободную смену?")) return;
    try {
      await Api.deleteShift(id);
      await loadShifts();
      render();
      toast("🗑️ Смена удалена");
    } catch (e) { toast("🚫 " + (e.message || e)); }
  }

  async function changeMonth(delta) {
    const d = new Date(S.year, S.month + delta, 1);
    S.year = d.getFullYear(); S.month = d.getMonth();
    S.sel = isCurrentMonth() ? now.getDate() : 1;
    try { await loadShifts(); await SECS[S.sec]?.enter?.(); } catch (e) { toast("🚫 " + (e.message || e)); }
    render();
  }

  async function freeMonth() {
    if (!confirm(`Создать свободные смены на ${MONTHS[S.month].toLowerCase()} ${S.year} для всех ПВЗ? Только на дни, где смен ещё нет.`)) return;
    try {
      const n = await Api.bulkCreateFreeMonth(S.year, S.month);
      await loadShifts();
      render();
      toast(n ? `✅ Создано свободных смен: ${n}` : "Везде уже есть смены");
    } catch (e) { toast("🚫 " + (e.message || e)); }
  }

  async function syncNow() {
    toast("Загружаю график…");
    try {
      const r = await Api.runScheduleSync();
      await loadShifts();
      render();
      toast(r.status === "ok" ? "✅ График обновлён" : "Готово, подробности по ссылкам — в мини-приложении");
    } catch (e) { toast("🚫 " + (e.message || e)); }
  }

  // ---------- Заявки ----------
  function reqTime(r) {
    const s = r.shifts;
    if (r.requested_start_time) return `с ${r.requested_start_time.slice(0, 5)} до ${(r.requested_end_time || s?.end_time || "").slice(0, 5)}`;
    return s ? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)} (вся смена)` : "";
  }

  function viewReq() {
    const list = S.requests.map((r) => {
      const dt = r.shifts?.shift_date ? r.shifts.shift_date.split("-").reverse().join(".") : "";
      return `<div class="card req"><div class="who"><b>${esc(fullName(r.employees) || "—")}</b>
        <div class="mut">${esc(r.shifts?.pvz?.name || "ПВЗ")} · ${dt} · ${esc(reqTime(r))}</div></div>
        <button class="btn ok" data-ra="${r.id}">${r.requested_start_time ? "Принять как просит" : "Принять"}</button>
        <button class="btn no" data-rr="${r.id}">Отклонить</button></div>`;
    }).join("");
    return `<div class="head"><h1>Заявки на смены</h1></div>${list || '<div class="card empty" style="max-width:900px">Нет активных заявок</div>'}`;
  }

  async function resolveReq(id, action) {
    const r = S.requests.find((x) => x.id === id);
    if (!r || S.busy) return;
    S.busy = true;
    try {
      const s = r.shifts;
      if (action === "reject") {
        await Api.resolveRequest({ requestId: id, shiftId: r.shift_id, action: "reject" });
      } else if (r.requested_start_time) {
        await Api.resolveRequest({
          requestId: id, shiftId: r.shift_id, employeeId: r.employee_id, action: "approve_with_time",
          pvzId: s?.pvz_id, shiftDate: s?.shift_date, overrideStart: r.requested_start_time, overrideEnd: r.requested_end_time || s?.end_time,
        });
      } else {
        await Api.resolveRequest({ requestId: id, shiftId: r.shift_id, employeeId: r.employee_id, action: "approve_as_is" });
      }
      await Promise.all([loadRequests(), loadShifts()]);
      render();
      toast(action === "reject" ? "❌ Заявка отклонена" : "✅ Заявка принята");
    } catch (e) { toast("🚫 " + (e.message || e)); }
    S.busy = false;
  }

  // ---------- Сотрудники (просмотр) ----------
  function viewEmp() {
    const act = S.employees.filter((e) => e.is_active !== false).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), "ru"));
    const wait = S.employees.filter((e) => e.is_active === false);
    const tbl = (arr) => `<table class="tbl"><tr><th>Имя в календаре</th><th>Полное имя</th><th>Должность</th><th>Telegram</th></tr>${arr.map((e) =>
      `<tr><td><b>${esc(e.full_name)}</b></td><td>${esc(e.real_name || "—")}</td><td>${esc(e.position || "—")}</td><td>${e.tg_username ? "@" + esc(e.tg_username) : "—"}</td></tr>`).join("")}</table>`;
    return `<div class="head"><h1>Сотрудники</h1><span class="pill">${act.length} активных</span></div>
      <div class="card" style="max-width:900px;margin-bottom:16px">${tbl(act)}</div>
      ${wait.length ? `<h3 style="margin:18px 0 8px">Ожидают доступа</h3><div class="card" style="max-width:900px">${tbl(wait)}</div>` : ""}
      <div class="mut" style="margin-top:12px">Редактирование сотрудников пока в мини-приложении.</div>`;
  }

  // ---------- Управление ПВЗ ----------
  function viewPvz() {
    const rows = S.pvz.map((p) => `<div class="card pv"><i class="sq" style="background:${p.color}"></i><div style="width:170px"><b>${esc(p.name)}</b><div class="mut">${p.marketplace === "wb" ? "WB" : "Ozon"}</div></div>
      <div class="sw">${PALETTE.map((x) => `<button data-c="${p.id}|${x}" data-tip="Выбрать цвет" class="${x.toLowerCase() === String(p.color).toLowerCase() ? "on" : ""}" style="background:${x}" aria-label="Цвет"></button>`).join("")}</div>
      <div style="background:${tint(p.color, 10)};border-radius:14px;padding:8px 10px"><div class="ch" style="background:${tint(p.color, 42)}">Катя <i>с 17</i></div></div></div>`).join("");
    return `<div class="head"><h1>Управление ПВЗ</h1></div>${rows}
      <div class="card pv" style="margin-top:18px"><input class="fld" id="npName" placeholder="Название нового ПВЗ" style="max-width:260px">
      <select class="fld" id="npNet" style="max-width:120px"><option value="wb">WB</option><option value="ozon">Ozon</option></select>
      <button class="sm d" data-addpvz style="padding:8px 16px">+ Добавить ПВЗ</button></div>
      <div class="mut" style="margin-top:12px">Цвет сохраняется в базе и меняется и в мини-приложении. Тарифы и часы работы ПВЗ пока правятся там.</div>`;
  }

  async function setColor(id, color) {
    try {
      await Api.updatePvz(id, { color });
      const p = S.pvz.find((x) => x.id === id);
      if (p) p.color = color;
      render();
    } catch (e) { toast("🚫 " + (e.message || e)); }
  }

  async function addPvz() {
    const name = $("npName").value.trim(), net = $("npNet").value;
    if (!name) return toast("Введите название");
    try {
      await Api.addPvz(name, net, PALETTE[S.pvz.length % PALETTE.length]);
      S.pvz = await Api.getPvzList();
      render();
      toast("✅ ПВЗ добавлен");
    } catch (e) { toast("🚫 " + (e.message || e)); }
  }

  // ---------- остальные разделы ----------
  function viewOther() {
    const name = IN_APP[S.sec] || "Раздел";
    return `<div class="head"><h1>${name}</h1></div><div class="card side" style="max-width:520px">Этот раздел пока работает в мини-приложении в Telegram. Сюда он переедет следующим.</div>`;
  }

  // подсказка у иконок в свёрнутом меню (обычный title/tooltip обрезался бы из-за прокрутки панели)
  let rt = null;
  function hideRt() { if (rt) rt.classList.remove("on"); }
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-rt]");
    if (!el || !S.rail || !el.closest("#side")) return hideRt();
    if (!rt) { rt = document.createElement("div"); rt.className = "rtip"; document.body.appendChild(rt); }
    const r = el.getBoundingClientRect();
    rt.textContent = el.dataset.rt;
    rt.style.left = r.right + 10 + "px";
    rt.style.top = r.top + r.height / 2 + "px";
    rt.classList.add("on");
  });
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest("[data-rt]")) hideRt(); });

  // ---------- события ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("modal")?.classList.contains("on")) { e.preventDefault(); closeModal(); }
  });
  function onClick(e) {
    if (e.target.closest("[data-mclose]")) return closeModal();
    // клик мимо панели, по пустому месту (не по кнопке, ссылке, полю и т. п.)
    if ($("modal")?.classList.contains("on") && e.target.isConnected && !e.target.closest("#modal, button, a, input, select, textarea, label, [data-act], [data-s], [data-p], [data-d], [data-c], [data-x], [data-q], [data-add], [data-today], [data-m], [data-g], [data-rail], [data-fs], [data-tp], #toast, .toast")) return closeModal();
    const a = e.target.closest("[data-act]");
    if (a) {
      const [name, ...rest] = a.dataset.act.split(":");
      if (ACTS[name]) return void ACTS[name](rest.join(":"), a, e);
    }
    const t = e.target.closest("[data-rail],[data-g],[data-s],[data-p],[data-d],[data-c],[data-x],[data-q],[data-add],[data-today],[data-m],[data-freemonth],[data-sync],[data-ra],[data-rr],[data-addpvz],[data-fs],[data-tp]");
    if (!t) return;
    const d = t.dataset;
    if (d.tp) openToday(d.tp);
    else if (d.rail) { S.rail = !S.rail; try { localStorage.setItem("adm-rail", S.rail ? "1" : "0"); } catch (_) { /* */ } hideRt(); $("side").innerHTML = nav(); }
    else if (d.g && S.rail) return;
    else if (d.g) { S.closed[d.g] = !S.closed[d.g]; try { localStorage.setItem("adm-closed", JSON.stringify(S.closed)); } catch (_) { /* */ } render(); }
    else if (d.s) go(d.s);
    else if (d.p) { S.pvzId = d.p; try { localStorage.setItem("adm-pvz", d.p); } catch (_) { /* */ } render(); }
    else if (d.d) { S.sel = +d.d; render(); }
    else if (d.c) { const [id, c] = d.c.split("|"); setColor(id, c); }
    else if (d.x) removeShift(d.x);
    else if (d.q !== undefined) { const cur = $("q")?.value ?? S.q; S.q = d.q === "?" ? "?" : (cur ? cur + " " : "") + d.q; if ($("q")) { $("q").value = S.q; $("q").focus(); } }
    else if (t.hasAttribute("data-add")) addShift();
    else if (t.hasAttribute("data-today")) { S.year = now.getFullYear(); S.month = now.getMonth(); S.sel = now.getDate(); loadShifts().then(render).catch((er) => toast("🚫 " + er.message)); }
    else if (d.m) changeMonth(+d.m);
    else if (t.hasAttribute("data-freemonth")) freeMonth();
    else if (t.hasAttribute("data-sync")) syncNow();
    else if (d.ra) resolveReq(d.ra, "approve");
    else if (d.rr) resolveReq(d.rr, "reject");
    else if (t.hasAttribute("data-addpvz")) addPvz();
    else if (t.hasAttribute("data-fs")) toggleFullscreen();
  }

  function toggleFullscreen() {
    const tg = window.Telegram?.WebApp;
    try {
      if (tg?.requestFullscreen) {
        if (tg.isFullscreen) tg.exitFullscreen(); else tg.requestFullscreen();
      } else if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } catch (e) { toast("🚫 Полный экран недоступен в этой версии Telegram"); }
    setTimeout(() => { $("side").innerHTML = nav(); }, 400);
  }

  async function init() {
    const boot = $("boot");
    // обычное окно Telegram (можно сворачивать, двигать, прижимать к краям); полноэкранный режим не включаем
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready(); tg.expand();
        tg.disableVerticalSwipes?.();
        const resync = () => { const sd = $("side"); if (sd && S.me) sd.innerHTML = nav(); };
        tg.onEvent?.("fullscreenChanged", resync);
        tg.onEvent?.("fullscreenFailed", () => toast("🚫 Telegram не дал включить полный экран"));
      }
    } catch (e) { /* не получилось — останется обычное окно */ }
    try {
      const r = await Api.login();
      if (r.demo) { boot.innerHTML = "Откройте админку из Telegram (лучше в Telegram Desktop на компьютере): вход идёт через бота."; return; }
      S.me = r.employee;
      if (!S.me?.is_admin) { boot.textContent = "Эта страница только для администраторов."; return; }
      await loadAll();
      boot.style.display = "none";
      $("app").style.display = "grid";
      document.addEventListener("click", onClick);
      render();
    } catch (e) {
      console.error(e);
      boot.textContent = "🚫 " + (e.message || "Ошибка загрузки");
    }
  }

  return {
    init, parseInput, timeLabel, S, MONTHS, WD, SECS, ACTS, $, esc, pad2, ymd, tint, fullName, toast, render, go, modal, closeModal,
    setMonth: changeMonth, loadShifts,
    section: (id, def) => { SECS[id] = def; },
    act: (name, fn) => { ACTS[name] = fn; },
  };
})();

if (typeof window !== "undefined") window.addEventListener("DOMContentLoaded", Admin.init);
