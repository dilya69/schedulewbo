// ============================================================
// АДМИНКА: «Импорт из Excel» (автоимпорт по ссылкам + ручной файл), «Экспорт», «Управление ПВЗ» (тарифы).
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, tint, toast, pad2 } = A;
  const $v = (id) => document.getElementById(id).value;
  const PALETTE = ["#FACC15","#F97316","#EF4444","#EC4899","#A855F7","#8B5CF6","#3B82F6","#06B6D4","#14B8A6","#16A34A","#84CC16","#64748B"];
  const mkt = (p) => (p.marketplace === "wb" ? "WB" : "Ozon");

  // ======================= ИМПОРТ =======================
  const L = { links: [], err: "", running: false };
  const I = { imp: null, busy: false };
  const SYNC_STATUS = { ok: "✅ Всё применено", attention: "⚠️ Нужно внимание", error: "🚫 Ошибка", skipped: "⏸ Пропущено" };
  const shortUrl = (url) => { try { const u = new URL(url); const path = (u.pathname + u.search).replace(/^\//, ""); return u.hostname + "/" + (path.length > 40 ? path.slice(0, 40) + "…" : path); } catch (_) { return url; } };
  const when = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  async function impEnter() {
    L.err = "";
    try { L.links = await Api.getSyncLinks(); } catch (e) { L.links = []; L.err = e.message || String(e); }
  }

  function linksHtml() {
    const cards = L.links.map((l) => {
      const st = !l.enabled ? '<div class="mut">Выключена: бот её не обновляет.</div>'
        : !l.last_run_at ? '<div class="mut">Ещё не запускалась.</div>'
        : `<div class="lstat ${l.last_status === "error" ? "neg" : l.last_status === "attention" ? "warnc" : ""}"><b>${SYNC_STATUS[l.last_status] || esc(l.last_status || "—")}</b> · ${when(l.last_run_at)}<div>${esc(l.last_message || "").replace(/\n/g, "<br>")}</div></div>`;
      return `<div class="lcard ${l.enabled ? "" : "off"}"><div class="lrow"><div style="min-width:0;flex:1"><b>${esc(l.last_month || "Месяц определится при первом запуске")}</b><div class="mut" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortUrl(l.url))}</div></div>
        <button class="sw2 ${l.enabled ? "on" : ""}" data-act="sync-toggle:${l.id}" data-tip="${l.enabled ? "Выключить" : "Включить"}" aria-label="Переключить"></button>
        <button class="btn no" data-act="sync-del:${l.id}">Удалить</button></div>${st}</div>`;
    }).join("");
    return `<div class="card side"><div class="dh" style="margin-top:0">Автоимпорт по ссылкам</div>
      <div class="mut" style="margin-bottom:12px">Бот сам берёт файлы по этим ссылкам каждые 30 минут и обновляет смены. Месяц определяется по названию в файле, поэтому можно держать текущий и следующий одновременно. Ссылки: Яндекс Диск, OneDrive, SharePoint.</div>
      ${L.err ? `<div class="neg" style="margin-bottom:10px">Нет списка ссылок: ${esc(L.err)}</div>` : ""}
      ${cards || '<div class="mut" style="margin-bottom:10px">Ссылок пока нет. Добавь первую ниже.</div>'}
      <div style="display:flex;gap:8px;margin-top:12px"><input class="fld" id="syncNewUrl" type="url" placeholder="Ссылка на файл графика"><button class="sm d" data-act="sync-add">Добавить</button></div>
      <button class="btn ok" data-act="sync-run" style="margin-top:12px" ${L.running ? "disabled" : ""}>${L.running ? "Загружаю…" : "Обновить сейчас"}</button></div>`;
  }

  function importHtml() {
    const im = I.imp;
    const head = `<div class="card side"><div class="dh" style="margin-top:0">Импорт из файла</div>
      <div class="mut" style="margin-bottom:12px">Выбери файл .xlsx с графиком (из Excel или скачанный из Яндекс Таблиц). Сначала покажу, что изменится, и только потом запишу.</div>
      <div class="drop" id="impDrop" style="margin:0;padding:16px 18px"><div class="mut">${im ? esc(im.fileName) : "Перетащи файл сюда"}</div><button class="btn" data-act="imp-pick">Выбрать файл</button></div>
      <input type="file" id="impFile" accept=".xlsx,.xls" style="display:none"><div id="impBody">${im ? planHtml() : ""}</div></div>`;
    return head;
  }

  function view() { return `<div class="head"><h1>Импорт из Excel</h1></div><div class="two">${linksHtml()}${importHtml()}</div>`; }

  // ---- разбор файла и план ----
  async function takeFile(file) {
    if (!file) return;
    if (typeof XLSX === "undefined" || typeof SheetImport === "undefined") return toast("🚫 Не загрузилась библиотека Excel. Обнови страницу");
    try {
      const data = await file.arrayBuffer();
      let best = null;
      for (const y of [S.year, S.year + 1, S.year - 1]) {
        const parsed = SheetImport.parseWorkbook(XLSX, data, y);
        const errs = parsed.errors.length + parsed.blocks.reduce((n, b) => n + b.errors.length, 0);
        if (!best || errs < best.errs) best = { parsed, year: y, errs };
        if (errs === 0) break;
      }
      const { parsed, year } = best;
      if (parsed.errors.length) { I.imp = { fileName: file.name, fatal: parsed.errors }; return A.render(); }
      const [pvz, employees, shifts] = await Promise.all([Api.getPvzList(), Api.getEmployees(), Api.getShiftsForMonth(year, parsed.month - 1)]);
      if (shifts.length && !("source" in shifts[0])) throw new Error("В таблице shifts нет колонки source — выполните sql/migration_sheet_import.sql");
      S.pvz = pvz; S.employees = employees;
      I.imp = { fileName: file.name, parsed, year, shifts, mappings: { pvz: {}, emp: {} }, pvzKeys: [], pvzTitles: {}, nameKeys: [], names: {}, plan: null };
      recalc();
    } catch (e) { console.error(e); I.imp = { fileName: file.name, fatal: [e.message || String(e)] }; A.render(); }
  }
  function recalc() {
    const im = I.imp;
    im.plan = SheetImport.buildPlan({ parsed: im.parsed, year: im.year, month: im.parsed.month, pvzList: S.pvz, employees: S.employees, shifts: im.shifts, mappings: im.mappings });
    for (const u of im.plan.unmatchedPvz) { if (!im.pvzKeys.includes(u.key)) im.pvzKeys.push(u.key); im.pvzTitles[u.key] = u.title; }
    for (const u of im.plan.unmatchedNames) { if (!im.nameKeys.includes(u.key)) im.nameKeys.push(u.key); im.names[u.key] = { name: u.name, count: u.count, examples: u.examples, ambiguous: u.ambiguous }; }
    A.render();
  }

  function planHtml() {
    const im = I.imp;
    if (im.fatal) return `<div class="isec err"><b>Не получилось прочитать файл</b>${im.fatal.map((e) => `<div>${esc(e)}</div>`).join("")}</div>`;
    const p = im.plan;
    const empName = (id) => S.employees.find((e) => e.id === id)?.full_name || "—";
    const pvzName = (id) => S.pvz.find((x) => x.id === id)?.name || "—";
    const dm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
    const lines = (arr, n, fmt) => arr.slice(0, n).map((x) => `<div>${fmt(x)}</div>`).join("") + (arr.length > n ? `<div class="mut">…и ещё ${arr.length - n}</div>` : "");
    const sec = (cls, title, inner) => `<div class="isec ${cls}"><b>${title}</b>${inner}</div>`;
    let h = `<div class="mut" style="margin:12px 0 8px">${esc(im.parsed.monthName)} ${im.year} · блоков ПВЗ: ${im.parsed.blocks.length}</div>`;
    if (p.blockErrors.length) h += sec("err", "Блоки с ошибками (пропущены)", p.blockErrors.map((b) => `<div><b>${esc(b.title)}</b>: ${esc(b.errors.slice(0, 3).join("; "))}${b.errors.length > 3 ? "…" : ""}</div>`).join(""));
    if (im.pvzKeys.length) {
      const rows = im.pvzKeys.map((key, i) => {
        const cur = im.mappings.pvz[key] || "";
        return `<div class="irow"><span>«${esc(im.pvzTitles[key])}»</span><select class="fld" data-imppvz="${i}"><option value="">— выбрать ПВЗ —</option>${S.pvz.map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${mkt(x)} · ${esc(x.name)}</option>`).join("")}</select></div>`;
      }).join("");
      h += sec(p.unmatchedPvz.length ? "warn" : "", "Какой это ПВЗ в приложении?", rows + '<div class="mut">Выбор запомнится. Если не выбрать, блок будет пропущен.</div>');
    }
    if (im.nameKeys.length) {
      const act = S.employees.filter((e) => e.is_active !== false);
      const rows = im.nameKeys.map((key, i) => {
        const cur = im.mappings.emp[key] || "", info = im.names[key];
        return `<div class="irow"><span><b>${esc(info.name)}</b> <small>${info.ambiguous ? "подходит нескольким · " : ""}встречается ${info.count} раз(а)${info.examples?.length ? ": " + esc(info.examples[0]) : ""}</small></span>
          <select class="fld" data-impemp="${i}"><option value="">— выбрать сотрудника —</option>${act.map((e) => `<option value="${e.id}" ${e.id === cur ? "selected" : ""}>${esc(fullName(e))}</option>`).join("")}<option value="__skip__" ${cur === "__skip__" ? "selected" : ""}>Не загружать эти записи</option></select></div>`;
      }).join("");
      h += sec(p.unmatchedNames.length ? "warn" : "", "Кто это в приложении?", rows + '<div class="mut">Выбор запомнится. Дни с неопознанными именами пропускаю и ничего в них не удаляю.</div>');
    }
    const s = p.stats;
    h += sec("", "Что изменится", `<div class="isum"><span>➕ Создам: ${s.inserted}</span><span>✏️ Обновлю / займу свободные: ${s.claimed + s.adopt}</span><span>🗑 Удалю: ${s.deleted}</span><span>✔️ Без изменений: ${s.keep}</span></div>
      <div class="mut">Записей людей: ${p.peopleEntries}, свободных («?»): ${p.freeEntries}. Блоков ПВЗ разобрано: ${p.matchedBlocks} из ${im.parsed.blocks.length}.</div>`);
    if (p.conflicts.length) h += sec("err", `Один человек в двух местах сразу: ${p.conflicts.length}`, lines(p.conflicts, 8, (c) => `${esc(empName(c.empId))}, ${dm(c.date)}: ${esc(pvzName(c.a.pvzId))} ${c.a.start}–${c.a.end} и ${esc(pvzName(c.b.pvzId))} ${c.b.start}–${c.b.end}`));
    if (p.cellErrors.length) h += sec("warn", `Непонятные ячейки: ${p.cellErrors.length}`, lines(p.cellErrors, 8, (c) => `${esc(c.block)}, ${esc(c.cell)}: «${esc(c.raw)}» — ${esc(c.error)}`) + '<div class="mut">В такие дни ничего не удаляю.</div>');
    if (p.duplicatePeople.length) h += sec("warn", `Один человек дважды в ПВЗ за день: ${p.duplicatePeople.length}`, lines(p.duplicatePeople, 5, (d) => `${esc(d.block)}, ${dm(d.date)}: ${esc(d.name)}`));
    if (p.bonuses.length) h += sec("", `Помечено «+» (бонус): ${p.bonuses.length}`, lines(p.bonuses, 6, (b) => `${dm(b.date)} ${esc(b.pvz)}: ${esc(b.name)}`) + '<div class="mut">Смену загружу как обычную, бонус начисли вручную в «Бонусы и штрафы».</div>');
    if (p.tentatives.length) h += sec("", `Под вопросом («?»): ${p.tentatives.length}`, lines(p.tentatives, 8, (b) => `${dm(b.date)} ${esc(b.pvz)}: ${esc(b.name)}, ${b.start}–${b.end}`) + '<div class="mut">Эти смены останутся свободными, никого не назначаю.</div>');
    if (p.trainings.length) h += sec("", `Обучение: ${p.trainings.length}`, lines(p.trainings, 6, (b) => `${dm(b.date)} ${esc(b.pvz)}: ${esc(b.name)}`) + '<div class="mut">Смена загрузится по обычному тарифу, платить иначе или нет — решаешь вручную.</div>');
    if (p.manualExtra.length) h += sec("", `Есть в приложении, нет в таблице: ${p.manualExtra.length}`, '<div class="mut">Смены, добавленные вручную. Оставляю как есть.</div>' + lines(p.manualExtra, 5, (m) => `${dm(m.date)} ${esc(m.block)}: ${esc(empName(m.empId))} ${m.start}–${m.end}`));
    if (p.pendingKept.length) h += sec("", `Смены с откликами не трогаю: ${p.pendingKept.length}`, '<div class="mut">Сначала реши по откликам в «Заявках».</div>');
    if (p.comments.length || p.strays.length) h += sec("", "Текст в таблице вне графика", lines(p.comments.concat(p.strays), 6, (c) => `${esc(c.block)}: ${esc(c.text)}`) + '<div class="mut">Импорт это не загружает, только показывает.</div>');
    const n = p.changeCount;
    const hasMaps = Object.keys(im.mappings.pvz).length + Object.keys(im.mappings.emp).filter((k) => im.mappings.emp[k] !== "__skip__").length > 0;
    return h + `<button class="sm d" data-act="imp-apply" style="margin-top:14px;padding:11px 22px" ${(n === 0 && !hasMaps) || I.busy ? "disabled" : ""}>${n ? `Применить (${n} изм.)` : hasMaps ? "Сохранить выбор" : "Нечего менять"}</button>`;
  }

  async function persistMappings() {
    const im = I.imp;
    for (const [key, pvzId] of Object.entries(im.mappings.pvz)) if (pvzId) await Api.updatePvz(pvzId, { sheet_title: im.pvzTitles[key] });
    const byEmp = {};
    for (const [key, empId] of Object.entries(im.mappings.emp)) { if (!empId || empId === "__skip__") continue; (byEmp[empId] ??= []).push(im.names[key].name); }
    for (const [empId, names] of Object.entries(byEmp)) {
      const e = S.employees.find((x) => x.id === empId);
      const have = String(e?.sheet_alias || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
      const add = names.filter((n) => !have.some((h) => SheetImport.normKey(h) === SheetImport.normKey(n)));
      if (add.length) await Api.updateEmployee(empId, { sheet_alias: [...have, ...add].join(";") });
    }
  }

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "impFile") { const f = t.files?.[0]; takeFile(f).then(() => { t.value = ""; }); }
    else if (t.dataset?.imppvz !== undefined && I.imp) { const k = I.imp.pvzKeys[+t.dataset.imppvz]; if (t.value) I.imp.mappings.pvz[k] = t.value; else delete I.imp.mappings.pvz[k]; recalc(); }
    else if (t.dataset?.impemp !== undefined && I.imp) { const k = I.imp.nameKeys[+t.dataset.impemp]; if (t.value) I.imp.mappings.emp[k] = t.value; else delete I.imp.mappings.emp[k]; recalc(); }
  });
  document.addEventListener("dragover", (e) => { const d = e.target.closest?.("#impDrop"); if (d) { e.preventDefault(); d.classList.add("hot"); } });
  document.addEventListener("dragleave", (e) => { e.target.closest?.("#impDrop")?.classList.remove("hot"); });
  document.addEventListener("drop", (e) => { if (e.target.closest?.("#impDrop")) { e.preventDefault(); takeFile(e.dataTransfer.files?.[0]); } });

  A.section("import", { view, enter: impEnter });
  A.act("imp-pick", () => document.getElementById("impFile").click());
  A.act("imp-apply", async () => {
    const im = I.imp;
    if (!im?.plan) return;
    const plan = im.plan;
    if (plan.conflicts.length && !confirm(`Найдено пересечений: ${plan.conflicts.length} (один человек в двух ПВЗ в одно время). Всё равно применить?`)) return;
    if (plan.deletes.length && !confirm(`Будет удалено смен: ${plan.deletes.length} (их раньше принёс импорт, а в таблице их больше нет). Продолжить?`)) return;
    I.busy = true; A.render();
    try {
      await persistMappings();
      await Api.applySheetPlan(plan, (done, total) => toast(`Записываю… ${done} из ${total}`));
      toast(plan.changeCount ? `✅ Готово: изменений ${plan.changeCount}` : "✅ Выбор сохранён");
      I.imp = null;
      S.employees = await Api.getEmployees(); S.pvz = await Api.getPvzList(); await A.loadShifts();
    } catch (e) { console.error(e); toast("🚫 " + (e.message || e)); }
    I.busy = false; A.render();
  });
  const reloadLinks = async () => { L.links = await Api.getSyncLinks(); A.render(); };
  A.act("sync-add", async () => {
    const url = ($v("syncNewUrl") || "").trim();
    if (!url) return toast("Вставь ссылку на файл");
    try { await Api.addSyncLink(url); await reloadLinks(); toast("✅ Ссылка добавлена. Нажми «Обновить сейчас» или подожди до 30 минут"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("sync-toggle", async (id) => { const l = L.links.find((x) => x.id === id); if (!l) return; try { await Api.setSyncLinkEnabled(id, !l.enabled); await reloadLinks(); } catch (e) { toast("🚫 " + (e.message || e)); } });
  A.act("sync-del", async (id) => {
    if (!confirm("Удалить ссылку? Смены в боте останутся как есть, просто перестанут обновляться из этого файла.")) return;
    try { await Api.deleteSyncLink(id); await reloadLinks(); toast("🗑️ Ссылка удалена"); } catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("sync-run", async () => {
    if (!L.links.some((l) => l.enabled)) return toast("Нет включённых ссылок");
    L.running = true; A.render();
    let r = null;
    try { r = await Api.runScheduleSync(); await A.loadShifts(); } catch (e) { toast("🚫 " + (e.message || e)); }
    L.running = false;
    try { L.links = await Api.getSyncLinks(); } catch (_) { /* */ }
    A.render();
    if (r) toast(r.status === "ok" ? "✅ График обновлён" : "Готово, смотри статус у каждой ссылки");
  });

  // ======================= ЭКСПОРТ =======================
  const periodNow = () => A.pay.getPeriod();
  const seg = (val, label) => `<button class="${periodNow() === val ? "on" : ""}" data-act="exp-period:${val}">${label}</button>`;
  function expView() {
    const card = (t, d, act, btn) => `<div class="card side expc"><div><b>${t}</b><div class="mut">${d}</div></div><button class="btn" data-act="${act}">${btn}</button></div>`;
    return `<div class="head"><div class="ttl"><h1>Экспорт · ${A.MONTHS[S.month]} ${S.year}</h1><div class="stp"><button data-m="-1" data-tip="Предыдущий месяц">‹</button><button data-m="1" data-tip="Следующий месяц">›</button></div></div></div>
      <div class="seg" style="margin-bottom:16px">${seg("full", "Весь месяц")}${seg("first", "1–15")}${seg("second", "16–конец")}</div>
      <div style="display:grid;gap:12px;max-width:760px">
        ${card("Ведомость по зарплате", "Сотрудники, смены, суммы по тарифам, бонусы, штрафы, итого. Учитывается выбранный период.", "pay-export", "Отправить в Telegram")}
        ${card("Все смены периода", "Дата, ПВЗ, сотрудник, время, статус, сумма. Учитывается выбранный период.", "pay-export-shifts", "Отправить в Telegram")}
        ${card("Все данные месяца", "Смены и бонусы/штрафы за весь месяц одним файлом.", "exp-month", "Отправить в Telegram")}</div>
      <div class="mut" style="margin-top:14px">Файлы приходят тебе в чат с ботом (.csv, открываются в Excel).</div>`;
  }
  A.section("export", { view: expView, enter: () => A.pay.enter() });
  A.act("exp-period", (v) => { A.pay.setPeriod(v); A.render(); });
  A.act("exp-month", async () => {
    try {
      const { csvRow, sendCsv, shiftAmount, money } = A.pay;
      const [shifts, bf] = await Promise.all([Api.getShiftsForMonth(S.year, S.month), Api.getBonusesFines(S.year, S.month)]);
      let csv = csvRow(["Дата", "ПВЗ", "Сотрудник", "Начало", "Конец", "Статус", "Сумма"]);
      shifts.slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date)).forEach((s) => {
        const p = S.pvz.find((x) => x.id === s.pvz_id);
        csv += csvRow([s.shift_date, p?.name || "", fullName(s.employees), s.duration_minutes ? `${s.duration_minutes / 60} ч` : s.start_time?.slice(0, 5), s.duration_minutes ? "" : s.end_time?.slice(0, 5), s.status, s.employee_id ? money(shiftAmount(s, p)) : ""]);
      });
      csv += "\r\n" + csvRow(["Бонусы/Штрафы"]) + csvRow(["Сотрудник", "Тип", "Сумма", "Причина"]);
      bf.forEach((b) => { csv += csvRow([fullName(S.employees.find((e) => e.id === b.employee_id)) || "—", b.kind === "bonus" ? "Бонус" : "Штраф", b.amount, b.reason || ""]); });
      await sendCsv(csv, `данные_${S.year}_${S.month + 1}.csv`);
    } catch (e) { toast("🚫 " + (e.message || e)); }
  });

  // ======================= УПРАВЛЕНИЕ ПВЗ =======================
  const hhmm = (t, d) => String(t || d).slice(0, 5);
  function pvzView() {
    const card = (p) => {
      const full = Number(p.full_shift_pay || 0);
      return `<div class="card pv"><i class="sq" style="background:${p.color}"></i>
        <div style="width:170px"><b>${esc(p.name)}</b><div class="mut">${mkt(p)}</div></div>
        <div class="pvfacts"><div><span class="mut">Полная смена</span><b>${full ? full.toLocaleString("ru-RU") + " ₽" : "—"}</b></div>
          <div><span class="mut">Часы работы</span><b>${hhmm(p.default_start_time, "09:00")}–${hhmm(p.default_end_time, "21:00")}</b></div>
          ${p.marketplace === "wb" ? `<div><span class="mut">ID в WB</span><b>${esc(p.wb_id || "—")}</b></div>` : ""}</div>
        <div class="sw">${PALETTE.map((x) => `<button data-c="${p.id}|${x}" data-tip="Выбрать цвет" class="${x.toLowerCase() === String(p.color).toLowerCase() ? "on" : ""}" style="background:${x}" aria-label="Цвет"></button>`).join("")}</div>
        <div class="pvbtn"><button class="btn" data-act="pvz-rate:${p.id}">Тариф</button><button class="btn no" data-act="pvz-del:${p.id}">Удалить</button></div></div>`;
    };
    const group = (net, title) => { const l = S.pvz.filter((p) => p.marketplace === net); return l.length ? `<h3 style="margin:18px 0 10px">${title}</h3>${l.map(card).join("")}` : ""; };
    return `<div class="head"><h1>Управление ПВЗ</h1><div class="ag"><button class="p" data-act="pvz-add">+ Добавить ПВЗ</button></div></div>${group("wb", "Wildberries")}${group("ozon", "Ozon")}
      <div class="mut" style="margin-top:12px">Любая смена, кроме полной: часы × 250 ₽ (началась до 17:00) или × 200 ₽ (с 17:00). Стажёры: полная смена 2 700 ₽ (не больше суммы ПВЗ), остальное по 200 ₽/ч.</div>`;
  }
  A.section("pvz", { view: pvzView, enter: async () => { S.pvz = await Api.getPvzList(); } });
  A.act("pvz-add", () => {
    A.modal("Добавить ПВЗ", `<label>Название</label><input type="text" id="f_name" placeholder="Название ПВЗ">
      <label>Маркетплейс</label><select id="f_market"><option value="wb">WB</option><option value="ozon">Ozon</option></select>
      <label>Цвет</label><input type="color" id="f_color" value="${PALETTE[S.pvz.length % PALETTE.length]}" style="height:42px;padding:4px">`, async () => {
      const name = $v("f_name").trim();
      if (!name) { toast("Введите название"); return false; }
      try { await Api.addPvz(name, $v("f_market"), $v("f_color")); S.pvz = await Api.getPvzList(); A.render(); toast("✅ ПВЗ добавлен, настрой тариф"); }
      catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  });
  A.act("pvz-rate", (id) => {
    const p = S.pvz.find((x) => x.id === id);
    if (!p) return;
    A.modal(`Тариф: ${p.name}`, `<div class="mut" style="margin-bottom:6px">Полная смена (от открытия до закрытия) — фиксированная сумма.</div>
      <label>Полная смена, ₽</label><input type="number" id="f_full_pay" min="0" value="${Number(p.full_shift_pay || 0)}">
      <label>Открытие ПВЗ</label><input type="time" id="f_dstart" value="${hhmm(p.default_start_time, "09:00")}">
      <label>Закрытие ПВЗ</label><input type="time" id="f_dend" value="${hhmm(p.default_end_time, "21:00")}">
      ${p.marketplace === "wb" ? `<label>ID ПВЗ в WB (из файла приёмки)</label><input type="text" id="f_wb_id" inputmode="numeric" placeholder="например, 50211720" value="${esc(p.wb_id || "")}">` : ""}`, async () => {
      const full_shift_pay = Number($v("f_full_pay")), a = $v("f_dstart"), b = $v("f_dend");
      if (!(full_shift_pay > 0)) { toast("Укажи сумму за полную смену"); return false; }
      if (!a || !b || a >= b) { toast("Закрытие должно быть позже открытия"); return false; }
      const fields = { full_shift_pay, default_start_time: a, default_end_time: b };
      const wbEl = document.getElementById("f_wb_id");
      if (wbEl) {
        const wb = wbEl.value.trim();
        if (wb && S.pvz.some((x) => x.id !== p.id && String(x.wb_id || "").trim() === wb)) { toast("Такой ID WB уже указан у другого ПВЗ"); return false; }
        if ("wb_id" in p || wb) fields.wb_id = wb || null;
      }
      try { await Api.updatePvz(p.id, fields); S.pvz = await Api.getPvzList(); A.render(); toast("✅ Тариф обновлён"); }
      catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  });
  A.act("pvz-del", async (id) => {
    const p = S.pvz.find((x) => x.id === id);
    if (!p || !confirm(`Удалить ПВЗ «${p.name}»? Смены сохранятся в истории.`)) return;
    try { await Api.deletePvz(id); S.pvz = await Api.getPvzList(); if (S.pvzId === id) S.pvzId = S.pvz[0]?.id || null; A.render(); toast("✅ ПВЗ удалён"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
})();
