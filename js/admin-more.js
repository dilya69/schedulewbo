// ============================================================
// АДМИНКА: «Пожелания по графику», «Активность» (потеряшки + последний вход), правка смены.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast, pad2 } = A;
  const $v = (id) => document.getElementById(id).value;
  const isBoss = (e) => A.pay.isBoss(e);
  const mskToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const dmy = (d) => String(d).slice(0, 10).split("-").reverse().join(".");
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };

  // ======================= ПОЖЕЛАНИЯ =======================
  const W = { enabled: false, list: [] };
  const wkey = () => `${S.year}-${pad2(S.month + 1)}-01`;
  async function wEnter() {
    try { [W.enabled, W.list] = await Promise.all([Api.getWishMonth(wkey()), Api.getWishes(wkey())]); }
    catch (e) { W.enabled = false; W.list = []; throw new Error("Пожелания не загрузились: " + (e.message || e)); }
  }
  function summary(days) {
    const keys = Object.keys(days || {}).map(Number).sort((a, b) => a - b);
    const full = [], off = [], from = {}, range = [];
    for (const d of keys) {
      const e = days[d];
      if (e.t === "full") full.push(d); else if (e.t === "off") off.push(d);
      else if (e.t === "from") (from[e.from] ??= []).push(d);
      else if (e.t === "range") range.push(`${d} (${e.from}–${e.to})`);
    }
    const rows = [];
    if (full.length) rows.push(["🟢", "Полные дни", full.join(", ")]);
    Object.keys(from).sort().forEach((t) => rows.push(["🕔", `С ${t}`, from[t].join(", ")]));
    if (range.length) rows.push(["⏱", "Другие часы", range.join(", ")]);
    if (off.length) rows.push(["🔴", "Нужен выходной", off.join(", ")]);
    return rows;
  }
  function wView() {
    const cards = W.list.map((w) => {
      const rows = summary(w.days).map(([i, l, v]) => `<div class="dr"><span>${i} <b>${esc(l)}</b></span><span>${esc(v)}</span></div>`).join("");
      return `<div class="card wcard"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:15px">${esc(fullName(w.employees) || "Сотрудник")}</b><button class="btn no" data-act="wish-del:${w.id}">Удалить</button></div>
        ${rows || '<div class="mut">Дни не отмечены</div>'}${w.comment ? `<div class="wcom">💬 ${esc(w.comment)}</div>` : ""}</div>`;
    }).join("");
    return `<div class="head"><div class="ttl"><h1>Пожелания · ${A.MONTHS[S.month]} ${S.year}</h1><div class="stp"><button data-m="-1" data-tip="Предыдущий месяц">‹</button><button data-m="1" data-tip="Следующий месяц">›</button></div></div>
      ${W.list.length > 1 ? '<div class="ag"><button data-act="wish-clear">Очистить всё за месяц</button></div>' : ""}</div>
      <div class="card side" style="max-width:760px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px"><div><b>Приём пожеланий на ${A.MONTHS[S.month]}</b><div class="mut">${W.enabled ? "Включён — сотрудники могут отправлять и менять" : "Выключен — сотрудники не могут отправлять"}</div></div>
        <button class="sw2 ${W.enabled ? "on" : ""}" data-act="wish-toggle" aria-label="Переключить"></button></div>
      <div class="wgrid">${cards || `<div class="card empty" style="max-width:760px">Пожеланий на ${A.MONTHS[S.month]} пока нет</div>`}</div>`;
  }
  A.section("wish", { view: wView, enter: wEnter });
  A.act("wish-toggle", async () => {
    try { await Api.setWishMonthEnabled(wkey(), !W.enabled); W.enabled = !W.enabled; A.render(); toast(W.enabled ? "✅ Приём пожеланий включён" : "Приём пожеланий выключен"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("wish-del", async (id) => {
    const w = W.list.find((x) => x.id === id);
    if (!w || !confirm(`Удалить пожелания: ${fullName(w.employees) || "сотрудник"}?`)) return;
    try { await Api.deleteWish(id); W.list = W.list.filter((x) => x.id !== id); A.render(); } catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("wish-clear", async () => {
    if (!confirm(`Удалить ВСЕ пожелания за ${A.MONTHS[S.month]} (${W.list.length})?`)) return;
    try { await Api.deleteAllWishes(wkey()); W.list = []; A.render(); toast("🗑 Пожелания за месяц удалены"); } catch (e) { toast("🚫 " + (e.message || e)); }
  });

  // ======================= АКТИВНОСТЬ =======================
  const X = { days: 14, dates: [] };
  async function xEnter() { [X.dates, S.employees] = await Promise.all([Api.getAssignedShiftDates(), Api.getEmployees()]); }
  function lostCalc() {
    const today = mskToday(), last = new Map(), upcoming = new Set();
    for (const s of X.dates) { if (s.shift_date >= today) upcoming.add(s.employee_id); else if (!last.has(s.employee_id)) last.set(s.employee_id, s.shift_date); }
    const lost = [], none = [];
    for (const e of S.employees.filter((x) => x.is_active !== false && !/^начальник/i.test(String(x.position || "").trim()))) {
      if (upcoming.has(e.id)) continue;
      const d = last.get(e.id);
      if (!d) none.push(e); else if (daysBetween(d, today) >= X.days) lost.push({ e, gap: daysBetween(d, today), date: d });
    }
    lost.sort((a, b) => b.gap - a.gap);
    return { lost, none };
  }
  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return null;
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 2) return "только что";
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ч назад`;
    const d = Math.floor(h / 24);
    return `${d} ${plural(d, "день", "дня", "дней")} назад`;
  }
  const tg = (e) => (/^[A-Za-z0-9_]{3,32}$/.test(e.tg_username || "") ? `<a class="lnk" href="https://t.me/${e.tg_username}" target="_blank" rel="noopener">@${e.tg_username}</a>` : '<span class="dash">—</span>');
  function xView() {
    const { lost, none } = lostCalc();
    const lrows = lost.map((l) => `<tr><td><b>${esc(fullName(l.e))}</b></td><td>${tg(l.e)}</td><td class="num"><span class="mtag badt">${l.gap} дн.</span></td><td class="num">${dmy(l.date)}</td></tr>`).join("");
    const nrows = none.map((e) => `<tr><td><b>${esc(fullName(e))}</b></td><td>${tg(e)}</td><td colspan="2" class="mut">смен ещё не было</td></tr>`).join("");
    const seen = S.employees.filter((e) => e.is_active !== false && !isBoss(e)).sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));
    const srows = seen.map((e) => `<tr><td><b>${esc(fullName(e))}</b></td><td>${tg(e)}</td><td class="num">${e.last_seen_at ? esc(ago(e.last_seen_at) || "") : '<span class="dash">ещё не заходил</span>'}</td></tr>`).join("");
    return `<div class="head"><h1>Активность</h1></div><div class="two">
      <div class="card side"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><div class="dh" style="margin:0">Потеряшки</div>
        <div class="stp"><button data-act="lost-d:-7">−7</button><button data-act="lost-d:-1">−</button><span style="padding:0 10px;font-weight:700;font-size:13px">${X.days}+ дн.</span><button data-act="lost-d:1">+</button><button data-act="lost-d:7">+7</button></div></div>
        <div class="mut" style="margin-bottom:8px">Без смен ${X.days}+ дней. Кто стоит в графике на сегодня и позже — не показан.</div>
        <table class="tbl"><tbody>${lrows || '<tr><td class="empty">Таких нет 🎉</td></tr>'}</tbody></table>
        ${none.length ? `<div class="dh">Нет смен в графике</div><table class="tbl"><tbody>${nrows}</tbody></table>` : ""}</div>
      <div class="card side"><div class="dh" style="margin-top:0">Последний вход в бота</div>
        <table class="tbl"><tbody>${srows || '<tr><td class="empty">Нет данных</td></tr>'}</tbody></table></div></div>`;
  }
  A.section("act", { view: xView, enter: xEnter });
  A.act("lost-d", (v) => { X.days = Math.min(365, Math.max(1, X.days + Number(v))); A.render(); });

  // ======================= ПРАВКА СМЕНЫ =======================
  const addMin = (t, m) => { const [h, mi] = String(t).split(":").map(Number); const tot = Math.min((h || 0) * 60 + (mi || 0) + m, 23 * 60 + 59); return `${pad2(Math.floor(tot / 60))}:${pad2(tot % 60)}`; };
  const hm = (t) => String(t || "").slice(0, 5);
  let ctx = null; // { id, pvz, date }

  function readForm() {
    const pvz = ctx.pvz;
    if (document.getElementById("f_short").checked) {
      const dur = Math.round(Number(String($v("f_hours")).replace(",", ".")) * 60);
      const start = hm(pvz.default_start_time) || "09:00";
      return { start, end: addMin(start, dur), dur: dur > 0 ? dur : null };
    }
    return { start: $v("f_start"), end: $v("f_end"), dur: null };
  }
  function recalc() {
    if (!ctx) return;
    const { start, end, dur } = readForm();
    if (!start || !end || (!dur && document.getElementById("f_short").checked)) return;
    const auto = Math.round(A.pay.shiftAmount({ start_time: start, end_time: end, duration_minutes: dur, custom_amount: null, employee_id: $v("f_emp") || null, shift_date: ctx.date }, ctx.pvz));
    document.getElementById("f_auto").textContent = auto;
    const a = document.getElementById("f_amount");
    if (a.dataset.touched !== "1") a.value = auto;
  }
  document.addEventListener("input", (e) => {
    if (!ctx) return;
    if (e.target.id === "f_amount") e.target.dataset.touched = "1";
    else if (["f_start", "f_end", "f_hours"].includes(e.target.id)) recalc();
  });
  document.addEventListener("change", (e) => {
    if (!ctx) return;
    if (e.target.id === "f_short") {
      const on = e.target.checked;
      document.getElementById("f_time").style.display = on ? "none" : "";
      document.getElementById("f_shortb").style.display = on ? "" : "none";
      recalc();
    } else if (e.target.id === "f_emp") recalc();
  });

  A.act("shift-edit", (id) => {
    const shift = id ? S.shifts.find((s) => s.id === id) : null;
    const pvz = shift ? S.pvz.find((p) => p.id === shift.pvz_id) : S.pvz.find((p) => p.id === S.pvzId);
    if (!pvz) return;
    const date = shift ? shift.shift_date : A.ymd(S.year, S.month, Math.min(S.sel, new Date(S.year, S.month + 1, 0).getDate()));
    ctx = { id: id || undefined, pvz, date };
    const start = hm(shift?.start_time) || hm(pvz.default_start_time) || "09:00";
    const end = hm(shift?.end_time) || hm(pvz.default_end_time) || "21:00";
    const short = !!shift?.duration_minutes, hours = short ? shift.duration_minutes / 60 : 2;
    const auto = Math.round(A.pay.shiftAmount({ start_time: start, end_time: end, duration_minutes: short ? shift.duration_minutes : null, custom_amount: null, employee_id: shift?.employee_id, shift_date: date }, pvz));
    const custom = shift?.custom_amount != null;
    const emps = S.employees.filter((e) => e.is_active !== false).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
    A.modal(`${shift ? "Редактировать смену" : "Новая смена"} · ${pvz.name}, ${dmy(date)}`, `
      <label>Сотрудник</label>${A.empCombo("f_emp", "f_empn", shift?.employee_id)}
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink);cursor:pointer"><input type="checkbox" id="f_short" style="width:auto;margin:0" ${short ? "checked" : ""}> Короткая смена без точного времени (например, «2 ч»)</label>
      <div id="f_time" style="${short ? "display:none" : ""}"><label>Начало</label><input type="time" id="f_start" value="${start}"><label>Конец</label><input type="time" id="f_end" value="${end}"></div>
      <div id="f_shortb" style="${short ? "" : "display:none"}"><label>Сколько часов</label><input type="number" id="f_hours" min="0.5" max="12" step="0.5" value="${hours}"></div>
      <label>Ставка за смену, ₽</label><input type="number" id="f_amount" min="0" value="${custom ? Math.round(shift.custom_amount) : auto}" ${custom ? 'data-touched="1"' : ""}>
      <div class="mut" style="margin-top:4px">По умолчанию для этого времени: <span id="f_auto">${auto}</span> ₽</div>`, async () => {
      const { start: s, end: e2, dur } = readForm();
      if (document.getElementById("f_short").checked && !(dur > 0 && dur <= 720)) { toast("Длительность от 0.5 до 12 часов"); return false; }
      if (!s || !e2 || s >= e2) { toast("Начало должно быть раньше конца"); return false; }
      const emp = $v("f_emp") || null;
      if (!emp && $v("f_empn").trim()) { toast(`🚫 Нет сотрудника «${$v("f_empn").trim()}». Выберите из списка или очистите поле`); return false; }
      if (emp && !dur) {
        const toM = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
        const clash = S.shifts.find((x) => x.id !== ctx.id && x.employee_id === emp && x.shift_date === date && !x.duration_minutes && toM(hm(x.start_time)) < toM(e2) && toM(hm(x.end_time)) > toM(s));
        if (clash && !confirm(`${fullName(S.employees.find((x) => x.id === emp))} уже стоит в этот день с пересекающимся временем. Всё равно сохранить?`)) return false;
      }
      const am = document.getElementById("f_amount");
      try {
        await Api.upsertShift({ id: ctx.id, pvz_id: pvz.id, shift_date: date, start_time: s, end_time: e2, employee_id: emp, status: emp ? "confirmed" : "free", custom_amount: am.dataset.touched === "1" ? Number(am.value) : null, duration_minutes: dur });
        await A.loadShifts(); ctx = null; A.render(); toast("✅ Смена сохранена");
      } catch (er) { toast("🚫 " + (er.message || er)); return false; }
    });
  });
  // закрытие окна сбрасывает контекст формы
  new MutationObserver(() => { if (!document.getElementById("f_short")) ctx = null; }).observe(document.getElementById("modal") || document.body, { childList: true });
})();
