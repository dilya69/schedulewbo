// ============================================================
// АДМИНКА: выбор сотрудника с поиском (печатать или выбирать), «Несколько смен сразу»,
// правка дня прямо в ячейке календаря (двойной щелчок).
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast, pad2, ymd } = A;
  const norm = (x) => String(x || "").toLowerCase().replace(/ё/g, "е").trim();
  const $i = (id) => document.getElementById(id);
  const hm = (t) => String(t || "").slice(0, 5);
  const addMin = (t, m) => { const [h, mi] = String(t).split(":").map(Number); const tot = Math.min((h || 0) * 60 + (mi || 0) + m, 23 * 60 + 59); return `${pad2(Math.floor(tot / 60))}:${pad2(tot % 60)}`; };
  const activeEmps = () => S.employees.filter((e) => e.is_active !== false).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
  const mpName = (p) => (p.marketplace === "wb" ? "WB" : "Ozon");
  const pvzTitle = (p) => (/(^|\s)(wb|ozon|вб|озон|wildberries)(\s|$)/i.test(p.name || "") ? p.name : `${p.name} ${mpName(p)}`);

  // ======================= СОТРУДНИК: ПЕЧАТАТЬ ИЛИ ВЫБРАТЬ =======================
  // поле + список; id сотрудника лежит в скрытом поле hiddenId (пусто = свободная смена)
  function empCombo(hiddenId, textId, selectedId) {
    const cur = selectedId ? S.employees.find((e) => e.id === selectedId) : null;
    return `<div class="cmb"><input id="${textId}" class="cmbi" autocomplete="off" placeholder="Печатайте имя или выберите из списка…" value="${esc(cur ? fullName(cur) : "")}">
      <input type="hidden" id="${hiddenId}" value="${cur ? cur.id : ""}"><div class="cmbl" hidden></div></div>`;
  }
  function comboList(box) {
    const inp = box.querySelector(".cmbi"), list = box.querySelector(".cmbl");
    const q = norm(inp.value);
    const hid = box.querySelector("input[type=hidden]");
    const sel = hid.value ? S.employees.find((e) => e.id === hid.value) : null;
    // если показываем выбранного — список полный, иначе фильтр по набранному
    const all = activeEmps().filter((e) => !q || (sel && norm(fullName(sel)) === q) || [e.full_name, e.real_name].some((n) => norm(n).includes(q)));
    list.innerHTML = `<button type="button" class="cmbo free" data-cmbv="">— свободная смена —</button>` +
      all.map((e) => `<button type="button" class="cmbo ${e.id === hid.value ? "on" : ""}" data-cmbv="${e.id}">${esc(fullName(e))}</button>`).join("") +
      (all.length ? "" : '<div class="mut" style="padding:8px 10px">Никого не нашла</div>');
    list.hidden = false;
  }
  function comboSet(box, id) {
    const hid = box.querySelector("input[type=hidden]"), inp = box.querySelector(".cmbi");
    const e = id ? S.employees.find((x) => x.id === id) : null;
    hid.value = e ? e.id : "";
    inp.value = e ? fullName(e) : "";
    inp.classList.remove("bad");
    box.querySelector(".cmbl").hidden = true;
    hid.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.addEventListener("focusin", (e) => { const b = e.target.closest?.(".cmb"); if (b && e.target.classList.contains("cmbi")) comboList(b); });
  document.addEventListener("input", (e) => {
    const b = e.target.closest?.(".cmb");
    if (!b || !e.target.classList.contains("cmbi")) return;
    const hid = b.querySelector("input[type=hidden]");
    const t = e.target.value.trim();
    const m = t ? A.findEmployee(t) : null;
    const exact = m && [m.full_name, m.real_name].some((n) => norm(n) === norm(t));
    const prev = hid.value;
    hid.value = exact ? m.id : "";
    e.target.classList.toggle("bad", !!t && !exact);
    comboList(b);
    if (prev !== hid.value) hid.dispatchEvent(new Event("change", { bubbles: true }));
  });
  document.addEventListener("mousedown", (e) => {
    const o = e.target.closest?.(".cmbo");
    if (o) { e.preventDefault(); comboSet(o.closest(".cmb"), o.dataset.cmbv); return; }
    document.querySelectorAll(".cmbl").forEach((l) => { if (!l.parentElement.contains(e.target)) l.hidden = true; });
  });
  document.addEventListener("focusout", (e) => {
    const b = e.target.closest?.(".cmb");
    if (!b || !e.target.classList.contains("cmbi")) return;
    setTimeout(() => {
      if (b.contains(document.activeElement)) return;
      b.querySelector(".cmbl").hidden = true;
      // «Кир» без выбора из списка: если по началу имени подходит один человек — подставляем
      const hid = b.querySelector("input[type=hidden]"), t = e.target.value.trim();
      if (t && !hid.value) { const m = A.findEmployee(t); if (m) comboSet(b, m.id); }
    }, 120);
  });
  A.empCombo = empCombo;

  // ======================= НЕСКОЛЬКО СМЕН СРАЗУ =======================
  let B = null;
  const WDN = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]; // индекс 0 = Пн
  const wdIdx = (date) => (date.getDay() + 6) % 7;

  function bulkBody() {
    const n = new Date(S.year, S.month + 1, 0).getDate();
    const dstr = (d) => ymd(S.year, S.month, d);
    const emps = activeEmps();
    const nets = [["wb", "WB"], ["ozon", "Ozon"]];
    return `
      <label>Сотрудники <span class="mut" style="text-transform:none;letter-spacing:0;font-weight:500">(никого не выбрано — будут свободные смены)</span></label>
      <input id="b_q" placeholder="Найти по имени…" autocomplete="off">
      <div class="bpicks" id="b_list">${emps.map((e) => `<div class="bpick" data-bemp="${e.id}" data-n="${esc(norm(fullName(e)) + " " + norm(e.real_name))}"><i class="bck"></i>${esc(fullName(e))}</div>`).join("")}</div>
      <div class="mut" id="b_cnt" style="margin-top:4px"></div>

      <label>ПВЗ</label>
      <div class="bchips">
        <button type="button" class="bchip" data-bpall="all">Все</button>
        ${nets.map(([k, l]) => `<button type="button" class="bchip" data-bpall="${k}">Все ${l}</button>`).join("")}
      </div>
      <div class="bchips" id="b_pvz">${S.pvz.map((p) => `<button type="button" class="bchip ${B.pvz.has(p.id) ? "on" : ""}" data-bpvz="${p.id}"><i class="dot" style="background:${p.color}"></i>${esc(A.addrLabel(p.name))} <span class="mut">${mpName(p)}</span></button>`).join("")}</div>

      <label>Даты (${A.MONTHS[S.month].toLowerCase()})</label>
      <div style="display:flex;gap:8px"><input type="date" id="b_from" value="${dstr(Math.min(S.sel, n))}" min="${dstr(1)}" max="${dstr(n)}"><input type="date" id="b_to" value="${dstr(n)}" min="${dstr(1)}" max="${dstr(n)}"></div>
      <div class="bchips" style="margin-top:8px"><button type="button" class="bchip" data-brange="day">Только выбранный день</button><button type="button" class="bchip" data-brange="rest">До конца месяца</button><button type="button" class="bchip" data-brange="month">Весь месяц</button></div>
      <div class="bchips" id="b_wd">${WDN.map((w, i) => `<button type="button" class="bchip ${B.wd.has(i) ? "on" : ""}" data-bwd="${i}">${w}</button>`).join("")}</div>

      <label>Время</label>
      <select id="b_mode"><option value="full">Вся смена (как у ПВЗ)</option><option value="custom">Своё время</option><option value="short">Короткая, без точного времени</option></select>
      <div id="b_custom" style="display:none;gap:8px;margin-top:8px"><input type="time" id="b_start" value="09:00"><input type="time" id="b_end" value="21:00"></div>
      <div id="b_short" style="display:none;margin-top:8px"><input type="number" id="b_hours" min="0.5" max="12" step="0.5" value="2" placeholder="Часов"></div>

      <label class="bchk"><input type="checkbox" id="b_skip" ${B.skipTouched ? "" : "checked"} style="width:auto;margin:0"> <span id="b_skiptxt"></span></label>
      <div class="bsum" id="b_sum"></div>`;
  }

  function bPlan() {
    const n = new Date(S.year, S.month + 1, 0).getDate();
    const from = $i("b_from").value ? Number($i("b_from").value.slice(8, 10)) : 1;
    const to = $i("b_to").value ? Number($i("b_to").value.slice(8, 10)) : n;
    const mode = $i("b_mode").value;
    const skip = $i("b_skip").checked;
    const emps = [...B.emps];
    const rows = []; let skipped = 0;
    let err = "";
    if (!B.pvz.size) err = "Выберите хотя бы один ПВЗ";
    else if (to < from) err = "Дата «по» раньше даты «с»";
    else if (!B.wd.size) err = "Выберите хотя бы один день недели";
    let dur = null, cs = "", ce = "";
    if (mode === "short") { dur = Math.round(Number(String($i("b_hours").value).replace(",", ".")) * 60); if (!(dur > 0 && dur <= 720)) err = err || "Длительность от 0.5 до 12 часов"; }
    if (mode === "custom") { cs = $i("b_start").value; ce = $i("b_end").value; if (!cs || !ce || cs >= ce) err = err || "Начало должно быть раньше конца"; }
    if (err) return { rows, skipped, err };
    for (const p of S.pvz) {
      if (!B.pvz.has(p.id)) continue;
      const ds = hm(p.default_start_time) || "09:00", de = hm(p.default_end_time) || "21:00";
      const start = mode === "custom" ? cs : ds;
      const end = mode === "custom" ? ce : mode === "short" ? addMin(ds, dur) : de;
      for (let d = from; d <= to; d++) {
        if (!B.wd.has(wdIdx(new Date(S.year, S.month, d)))) continue;
        const k = ymd(S.year, S.month, d);
        const have = S.shifts.filter((s) => s.pvz_id === p.id && s.shift_date === k);
        const base = { pvz_id: p.id, shift_date: k, start_time: start, end_time: end, custom_amount: null, duration_minutes: dur };
        if (!emps.length) {
          if (skip && have.length) { skipped++; continue; }
          rows.push({ ...base, employee_id: null, status: "free" });
        } else {
          if (skip && have.some((s) => s.employee_id)) { skipped++; continue; } // «только где никого нет»
          for (const id of emps) {
            if (have.some((s) => s.employee_id === id)) { skipped++; continue; } // этот человек уже там стоит
            rows.push({ ...base, employee_id: id, status: "confirmed" });
          }
        }
      }
    }
    return { rows, skipped, err: "" };
  }

  function bRefresh() {
    if (!B || !$i("b_sum")) return;
    const emps = B.emps.size;
    $i("b_cnt").textContent = emps ? `Выбрано: ${emps}` : "";
    $i("b_skiptxt").textContent = emps ? "Пропускать дни, где на ПВЗ уже кто-то стоит" : "Пропускать дни, где на ПВЗ уже есть смены";
    if (!B.skipTouched) $i("b_skip").checked = !emps;
    document.querySelectorAll("[data-bemp]").forEach((x) => x.classList.toggle("on", B.emps.has(x.dataset.bemp)));
    document.querySelectorAll("[data-bpvz]").forEach((x) => x.classList.toggle("on", B.pvz.has(x.dataset.bpvz)));
    document.querySelectorAll("[data-bwd]").forEach((x) => x.classList.toggle("on", B.wd.has(Number(x.dataset.bwd))));
    $i("b_custom").style.display = $i("b_mode").value === "custom" ? "flex" : "none";
    $i("b_short").style.display = $i("b_mode").value === "short" ? "" : "none";
    const r = bPlan();
    $i("b_sum").innerHTML = r.err ? `<span style="color:#B42318">${esc(r.err)}</span>`
      : `Будет создано: <b>${r.rows.length}</b> ${r.rows.length === 1 ? "смена" : "смен"}${r.skipped ? ` · пропущено: ${r.skipped}` : ""}`;
  }

  A.act("shift-bulk", () => {
    const cur = S.pvz.find((p) => p.id === S.pvzId);
    B = { emps: new Set(), pvz: new Set(cur ? [cur.id] : []), wd: new Set([0, 1, 2, 3, 4, 5, 6]), skipTouched: false };
    A.modal("Несколько смен сразу", bulkBody(), async () => {
      const r = bPlan();
      if (r.err) { toast("🚫 " + r.err); return false; }
      if (!r.rows.length) { toast("Нечего создавать: всё уже занято"); return false; }
      if (r.rows.length > 40 && !confirm(`Создать смен: ${r.rows.length}?`)) return false;
      try {
        await Api.applySheetPlan({ updates: [], inserts: r.rows, deletes: [] });
        await A.loadShifts(); B = null; A.render();
        toast(`✅ Создано смен: ${r.rows.length}`);
      } catch (e) { toast("🚫 " + (e.message || e)); return false; }
    }, "Создать");
    bRefresh();
  });

  document.addEventListener("click", (e) => {
    if (!B || !$i("b_sum")) return;
    const t = e.target.closest("[data-bemp],[data-bpvz],[data-bpall],[data-brange],[data-bwd],#b_skip");
    if (!t) return;
    const d = t.dataset;
    if (d.bemp) { B.emps.has(d.bemp) ? B.emps.delete(d.bemp) : B.emps.add(d.bemp); }
    else if (d.bpvz) { B.pvz.has(d.bpvz) ? B.pvz.delete(d.bpvz) : B.pvz.add(d.bpvz); }
    else if (d.bpall) { B.pvz = new Set(S.pvz.filter((p) => d.bpall === "all" || p.marketplace === d.bpall).map((p) => p.id)); }
    else if (d.bwd !== undefined) { const i = Number(d.bwd); B.wd.has(i) ? B.wd.delete(i) : B.wd.add(i); }
    else if (d.brange) {
      const n = new Date(S.year, S.month + 1, 0).getDate();
      const sel = Math.min(S.sel, n);
      const [a, b] = d.brange === "day" ? [sel, sel] : d.brange === "rest" ? [sel, n] : [1, n];
      $i("b_from").value = ymd(S.year, S.month, a); $i("b_to").value = ymd(S.year, S.month, b);
    } else if (t.id === "b_skip") B.skipTouched = true;
    bRefresh();
  });
  document.addEventListener("input", (e) => {
    if (!B || !$i("b_sum")) return;
    if (e.target.id === "b_q") {
      const q = norm(e.target.value);
      document.querySelectorAll("[data-bemp]").forEach((x) => { x.style.display = !q || x.dataset.n.includes(q) ? "" : "none"; });
    } else bRefresh();
  });
  document.addEventListener("change", (e) => { if (B && $i("b_sum") && ["b_mode", "b_from", "b_to"].includes(e.target.id)) bRefresh(); });
  new MutationObserver(() => { if (!$i("b_sum")) B = null; }).observe($i("modal") || document.body, { childList: true });

  // ======================= ПРАВКА ПРЯМО В ЯЧЕЙКЕ =======================
  let CE = null; // { day }
  function ceClose() { document.getElementById("cedit")?.remove(); CE = null; }
  function ceHtml() {
    const p = A.curPvz();
    const k = ymd(S.year, S.month, CE.day);
    const list = A.dayShifts(p.id, CE.day);
    const wd = A.WD[new Date(S.year, S.month, CE.day).getDay()];
    const rows = list.map((s) => {
      const lb = A.timeLabel(s, p);
      const who = s.employee_id ? `${esc(s.employees?.full_name || "?")}${lb ? ` <i>${lb}</i>` : ""}` : "свободная смена";
      return `<div class="cer"><span class="cew ${s.employee_id ? "" : "fr"}" ${s.employee_id ? `style="background:${A.tint(p.color, 42)}"` : ""}>${who}</span>
        <button class="cex" data-ce="edit:${s.id}" title="Изменить время и сумму">✎</button>
        <button class="cex" data-ce="${s.employee_id ? "clear" : "del"}:${s.id}" title="${s.employee_id ? "Убрать сотрудника со смены" : "Удалить свободную смену"}">✕</button></div>`;
    }).join("");
    return `<div class="cet"><b>${wd}, ${CE.day} ${A.MONTHS_GEN[S.month]}</b><span class="mut"> · ${esc(pvzTitle(p))}</span></div>
      ${rows || '<div class="mut" style="padding:2px 2px 8px">Смен нет</div>'}
      <input class="fld" id="ce_q" list="emps" placeholder="Имя, «с 17», «до 19», «2ч», «?» — Enter" autocomplete="off">
      <div class="mut" style="font-size:12px;margin-top:6px">Enter — добавить · Esc — закрыть</div>`;
  }
  function cePlace() {
    const el = document.getElementById("cedit"), cell = document.querySelector(`.c[data-d="${CE.day}"]`);
    if (!el || !cell) return;
    const r = cell.getBoundingClientRect();
    const w = Math.max(280, r.width + 8);
    el.style.width = w + "px";
    let left = r.left - 4, top = r.top - 4;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const h = el.offsetHeight;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    el.style.left = left + "px"; el.style.top = top + "px";
  }
  function ceRender(focus) {
    const el = document.getElementById("cedit");
    if (!el) return;
    el.innerHTML = ceHtml();
    cePlace();
    if (focus) $i("ce_q")?.focus();
  }
  async function ceAfter() { await A.loadShifts(); A.render(); ceRender(true); }

  A.act("cell-edit", (day) => {
    ceClose();
    const d = Number(day);
    S.sel = d;
    A.render(); // подсветить выбранный день и обновить правую панель
    CE = { day: d };
    const el = document.createElement("div");
    el.id = "cedit"; el.className = "cedit";
    document.body.appendChild(el);
    ceRender(true);
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const b = e.target.closest("[data-ce]");
      if (!b) return;
      const [act, id] = b.dataset.ce.split(":");
      const s = S.shifts.find((x) => x.id === id);
      if (!s) return;
      try {
        if (act === "edit") { ceClose(); A.ACTS["shift-edit"](id); return; }
        if (act === "clear") {
          await Api.upsertShift({ id: s.id, pvz_id: s.pvz_id, shift_date: s.shift_date, start_time: s.start_time, end_time: s.end_time, employee_id: null, status: "free", custom_amount: null, duration_minutes: s.duration_minutes });
          toast(`Убрала ${s.employees?.full_name || "сотрудника"} — смена стала свободной`);
        } else if (act === "del") { await Api.deleteShift(id); toast("🗑️ Свободная смена удалена"); }
        await ceAfter();
      } catch (er) { toast("🚫 " + (er.message || er)); }
    });
    el.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || e.target.id !== "ce_q") return;
      e.preventDefault();
      const text = e.target.value.trim();
      if (!text) return;
      if (await A.addShiftText(text, CE.day, false)) ceRender(true);
    });
  });
  document.addEventListener("mousedown", (e) => { if (CE && !e.target.closest("#cedit")) ceClose(); }, true);
  document.addEventListener("keydown", (e) => { if (CE && e.key === "Escape") { e.stopImmediatePropagation(); ceClose(); } }, true);
  window.addEventListener("resize", () => { if (CE) cePlace(); });
})();
