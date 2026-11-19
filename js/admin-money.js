// ============================================================
// АДМИНКА: «Бонусы и штрафы», «Тикеты», «Приёмка WB».
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast, pad2 } = A;
  const rub = (n) => A.pay.rub(n);
  const emp = (id) => S.employees.find((e) => e.id === id);
  const empName = (id) => (emp(id) ? fullName(emp(id)) : "—");
  const dmy = (d) => String(d).slice(0, 10).split("-").reverse().join(".");
  const $v = (id) => document.getElementById(id).value;
  const activeEmps = () => S.employees.filter((e) => e.is_active !== false && !A.pay.isBoss(e))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
  const empOptions = (cur) => activeEmps().map((e) => `<option value="${e.id}" ${cur === e.id ? "selected" : ""}>${esc(fullName(e))}</option>`).join("");
  const monthHead = (title, right = "") => `<div class="head"><div class="ttl"><h1>${title} · ${A.MONTHS[S.month]} ${S.year}</h1>
    <div class="stp"><button data-m="-1" data-tip="Предыдущий месяц">‹</button><button data-m="1" data-tip="Следующий месяц">›</button></div></div>${right}</div>`;
  const created = (b) => {
    const d = new Date(b.created_at);
    return isNaN(d) ? "" : new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }).format(d);
  };

  // ======================= БОНУСЫ И ШТРАФЫ =======================
  const B = { list: [] };
  async function bfEnter() { B.list = await Api.getBonusesFines(S.year, S.month); }

  function bfView() {
    const list = B.list.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const bonus = list.filter((b) => b.kind === "bonus").reduce((s, b) => s + Number(b.amount), 0);
    const fine = list.filter((b) => b.kind === "fine").reduce((s, b) => s + Number(b.amount), 0);
    const rows = list.map((b) => `<tr><td><b>${esc(empName(b.employee_id))}</b></td>
      <td><span class="mtag ${b.kind === "bonus" ? "okt" : "badt"}">${b.kind === "bonus" ? "Бонус" : "Штраф"}</span></td>
      <td class="num ${b.kind === "bonus" ? "pos" : "neg"}">${b.kind === "bonus" ? "+" : "−"}${rub(b.amount)}</td>
      <td>${esc(b.reason || "") || '<span class="dash">—</span>'}</td><td class="num">${created(b)}</td>
      <td class="acts"><button class="btn no" data-act="bf-del:${b.id}">Удалить</button></td></tr>`).join("");
    return monthHead("Бонусы и штрафы", `<div class="ag"><button data-act="bf-add:bonus">+ Бонус</button><button class="p r" data-act="bf-add:fine">+ Штраф</button></div>`) + `
      <div class="stats"><div class="card stat"><div class="mut">Бонусы</div><div class="big pos">+${rub(bonus)}</div></div>
        <div class="card stat"><div class="mut">Штрафы</div><div class="big neg">−${rub(fine)}</div></div>
        <div class="card stat"><div class="mut">Записей</div><div class="big">${list.length}</div></div></div>
      <div class="card tcard"><table class="tbl pay"><thead><tr><th>Сотрудник</th><th>Тип</th><th class="num">Сумма</th><th>Причина</th><th class="num">Добавлено</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">За этот месяц нет бонусов и штрафов</td></tr>'}</tbody></table></div>
      <div class="mut" style="margin-top:12px">В зарплату бонус или штраф попадает в ту половину месяца, в которой добавлен (1–15 или 16–конец).</div>`;
  }

  A.section("bonus", { view: bfView, enter: bfEnter });
  A.act("bf-add", (kind) => {
    A.modal(`${kind === "bonus" ? "Начислить бонус" : "Оформить штраф"} — ${A.MONTHS[S.month]} ${S.year}`, `
      <label>Сотрудник</label><select id="f_employee">${empOptions()}</select>
      <label>Сумма, ₽</label><input type="number" id="f_amount" min="1" placeholder="1000">
      <label>Причина</label><input type="text" id="f_reason" placeholder="${kind === "bonus" ? "Качество работы" : "Опоздание"}">`, async () => {
      const amount = Number($v("f_amount"));
      if (!$v("f_employee")) { toast("Выберите сотрудника"); return false; }
      if (!amount || amount <= 0) { toast("Введите корректную сумму"); return false; }
      try {
        await Api.addBonusFine($v("f_employee"), kind, amount, $v("f_reason").trim(), `${S.year}-${pad2(S.month + 1)}-01`);
        await bfEnter(); A.render(); toast(kind === "bonus" ? "✅ Бонус добавлен" : "⚠️ Штраф добавлен");
      } catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  });
  A.act("bf-del", async (id) => {
    const b = B.list.find((x) => x.id === id);
    if (!b || !confirm(`Удалить ${b.kind === "bonus" ? "бонус" : "штраф"} ${b.amount} ₽ (${empName(b.employee_id)})${b.reason ? " — " + b.reason : ""}?`)) return;
    try { await Api.deleteBonusFine(id); await bfEnter(); A.render(); toast("✅ Удалено"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });

  // ======================= ТИКЕТЫ =======================
  const T = { list: [] };
  const HALF = 5000;
  async function tEnter() { T.list = await Api.getAllowances(); }

  function tView() {
    const items = T.list.filter((a) => emp(a.employee_id)?.is_active !== false)
      .sort((a, b) => empName(a.employee_id).localeCompare(empName(b.employee_id), "ru"));
    const half = (a) => (a.amount !== null && a.amount !== undefined && a.amount !== "" ? Number(a.amount) : HALF);
    const rows = items.map((a) => `<tr><td><b>${esc(empName(a.employee_id))}</b></td>
      <td class="num">${rub(half(a))}</td><td class="num">${rub(half(a) * 2)}</td>
      <td class="acts"><button class="btn" data-act="t-edit:${a.id}">Изменить</button><button class="btn no" data-act="t-del:${a.id}">Убрать</button></td></tr>`).join("");
    return `<div class="head"><h1>Тикеты</h1><div class="ag"><button class="p" data-act="t-edit:">+ Назначить тикеты</button></div></div>
      <div class="card tcard" style="max-width:760px"><table class="tbl pay"><thead><tr><th>Сотрудник</th><th class="num">За 2 недели</th><th class="num">За месяц</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="empty">Тикеты никому не назначены</td></tr>'}</tbody></table></div>
      <div class="mut" style="margin-top:12px">Если сумма не вписана, начисляется ${rub(HALF)} за каждые 2 недели (1–15 и 16–конец). Попадает в «Зарплату».</div>`;
  }
  A.section("tickets", { view: tView, enter: tEnter });
  A.act("t-edit", (id) => {
    const cur = id ? T.list.find((a) => a.id === id) : null;
    A.modal(cur ? "Изменить тикеты" : "Назначить тикеты", `
      <label>Сотрудник</label><select id="f_al_emp" ${cur ? "disabled" : ""}>${empOptions(cur?.employee_id)}</select>
      <label>Сумма за 2 недели, ₽ (пусто — ${HALF})</label><input type="number" id="f_al_amount" min="1" placeholder="${HALF}" value="${cur?.amount ? Number(cur.amount) : ""}">`, async () => {
      const raw = $v("f_al_amount").trim(), amount = raw ? Number(raw) : null;
      if (!$v("f_al_emp")) { toast("Выберите сотрудника"); return false; }
      if (raw && (!amount || amount <= 0)) { toast("Введите корректную сумму"); return false; }
      try {
        if (cur) await Api.updateAllowance(cur.id, cur.type_id || null, amount, "Тикеты");
        else await Api.addAllowance($v("f_al_emp"), null, amount, "Тикеты");
        await tEnter(); A.render(); toast("✅ Тикеты сохранены");
      } catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  });
  A.act("t-del", async (id) => {
    const a = T.list.find((x) => x.id === id);
    if (!a || !confirm(`Убрать тикеты у ${empName(a.employee_id)}?`)) return;
    try { await Api.deleteAllowance(id); await tEnter(); A.render(); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });

  // ======================= ПРИЁМКА WB =======================
  const C = { list: [], staged: null, busy: false };
  const asum = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + rub(Math.abs(n));
  async function accEnter() { C.list = await Api.getAcceptance(S.year, S.month); S.pvz = await Api.getPvzList(); }

  function accView() {
    const list = C.list;
    const decidable = list.filter((a) => (a.shares || []).length);
    const counted = list.filter((a) => a.status === "counted").reduce((s, a) => s + Number(a.amount), 0);
    const pending = decidable.filter((a) => a.status === "pending").length;
    const wbPvz = S.pvz.filter((p) => p.marketplace === "wb");
    const st = C.staged;
    const upload = `<div class="card drop" id="accDrop"><div><b>Файлы приёмки с сайта WB</b><div class="mut">Перетащи сюда .xlsx (можно сразу несколько, по одному на ПВЗ) или выбери. Считаются все дни месяца, в зарплату приёмка добавляется только в конце месяца (вторая выплата).</div></div>
      <div class="ag"><button class="p" data-act="acc-pick">Выбрать файлы</button></div>
      <input type="file" id="accFile" accept=".xlsx,.xls,.csv" multiple style="display:none"></div>`;
    const staged = st ? `<div class="card staged"><div><b>Загружено:</b> файлов ${st.files}, строк ${st.rows.length}${st.errors.length ? `<div class="neg" style="margin-top:6px;font-size:13px">${st.errors.slice(0, 5).map(esc).join("<br>")}${st.errors.length > 5 ? `<br>…и ещё ${st.errors.length - 5}` : ""}</div>` : ""}</div>
      <div class="ag"><button data-act="acc-clear">Сбросить</button><button class="p r" data-act="acc-calc" ${C.busy ? "disabled" : ""}>Посчитать</button></div></div>` : "";

    const bulk = decidable.length ? `<div class="bulk"><button data-act="acc-bulk:all">✓ Засчитать все</button><button data-act="acc-bulk:none">✗ Не засчитывать все</button><button data-act="acc-bulk:plus">Только плюсы</button><button data-act="acc-bulk:minus">Только минусы</button><button data-act="acc-bulk:reset">↶ Сбросить все</button><button class="no" data-act="acc-delall">Удалить все</button></div>` : "";

    const rows = list.map((a) => {
      const pvz = S.pvz.find((p) => p.id === a.pvz_id), v = Number(a.amount), cls = v < 0 ? "neg" : "pos";
      const name = esc(pvz?.name || a.address || "ПВЗ " + a.wb_pvz_id);
      const del = `<button class="btn no" data-act="acc-del:${a.id}">✕</button>`;
      const shares = a.shares || [];
      if (!pvz) {
        return `<tr><td>${dmy(a.bonus_date)}</td><td>${name}</td><td colspan="2"><span class="mut">ПВЗ с ID ${esc(a.wb_pvz_id)} не найден — привяжи:</span>
          <select class="fld" id="accAssign_${esc(a.wb_pvz_id)}" style="display:inline-block;width:auto;margin:0 6px">${wbPvz.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><button class="btn" data-act="acc-assign:${esc(a.wb_pvz_id)}">Привязать</button></td>
          <td class="num ${cls}">${asum(v)}</td><td class="acts">${del}</td></tr>`;
      }
      if (!shares.length) return `<tr><td>${dmy(a.bonus_date)}</td><td>${name}</td><td colspan="2" class="mut">никто не работал с 9:00 — некому начислить</td><td class="num ${cls}">${asum(v)}</td><td class="acts">${del}</td></tr>`;
      const who = shares.map((x) => `${esc(empName(x.employee_id))}${shares.length > 1 ? ` (${asum(Number(x.amount))})` : ""}`).join(", ");
      const ctrl = a.status === "pending"
        ? `<button class="btn ok" data-act="acc-set:${a.id}:counted">Засчитать</button><button class="btn" data-act="acc-set:${a.id}:skipped">Не засчитывать</button>`
        : `<span class="mtag ${a.status === "counted" ? "okt" : "badt"}">${a.status === "counted" ? "засчитано" : "не засчитано"}</span><button class="btn" data-act="acc-set:${a.id}:pending">Отменить</button>`;
      return `<tr class="${a.status}"><td>${dmy(a.bonus_date)}</td><td>${name}</td><td>${who}</td><td class="acts" style="text-align:left">${ctrl}</td><td class="num ${cls}">${asum(v)}</td><td class="acts">${del}</td></tr>`;
    }).join("");

    return monthHead("Приёмка WB") + upload + staged + `
      <div class="stats"><div class="card stat"><div class="mut">Засчитано</div><div class="big">${asum(counted)}</div></div>
        <div class="card stat"><div class="mut">Ждут решения</div><div class="big">${pending}</div></div>
        <div class="card stat"><div class="mut">Записей</div><div class="big">${list.length}</div></div></div>${bulk}
      <div class="card tcard"><table class="tbl pay"><thead><tr><th>Дата</th><th>ПВЗ</th><th>Кто работал с 9:00</th><th>Решение</th><th class="num">Сумма</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">За этот месяц данных о приёмке нет</td></tr>'}</tbody></table></div>`;
  }

  async function takeFiles(files) {
    files = [...(files || [])];
    if (!files.length) return;
    if (typeof XLSX === "undefined") return toast("🚫 Не загрузилась библиотека Excel. Обнови страницу");
    const all = [], errors = [];
    for (const f of files) {
      try { const p = Acceptance.parseWorkbook(XLSX, await f.arrayBuffer(), f.name); all.push(...p.rows); errors.push(...p.errors); }
      catch (e) { errors.push(`${f.name}: ${e.message || e}`); }
    }
    const prev = C.staged;
    C.staged = { files: (prev ? prev.files : 0) + files.length, rows: Acceptance.mergeRows([...(prev ? prev.rows : []), ...all]), errors: [...(prev ? prev.errors : []), ...errors] };
    A.render();
  }
  document.addEventListener("change", (e) => { if (e.target.id === "accFile") { const f = e.target.files; takeFiles(f).then(() => { e.target.value = ""; }); } });
  document.addEventListener("dragover", (e) => { if (e.target.closest?.("#accDrop")) { e.preventDefault(); e.target.closest("#accDrop").classList.add("hot"); } });
  document.addEventListener("dragleave", (e) => { e.target.closest?.("#accDrop")?.classList.remove("hot"); });
  document.addEventListener("drop", (e) => { if (e.target.closest?.("#accDrop")) { e.preventDefault(); takeFiles(e.dataTransfer.files); } });

  const refresh = async () => { C.list = await Api.getAcceptance(S.year, S.month); A.render(); };
  A.section("acc", { view: accView, enter: accEnter });
  A.act("acc-pick", () => document.getElementById("accFile").click());
  A.act("acc-clear", () => { C.staged = null; A.render(); });
  A.act("acc-calc", async () => {
    const st = C.staged;
    if (!st || !st.rows.length) return toast("Сначала загрузите файл(ы)");
    C.busy = true; A.render();
    try {
      const pvzList = await Api.getPvzList(); S.pvz = pvzList;
      const months = [...new Set(st.rows.map((r) => r.date.slice(0, 7)))];
      const shifts = [];
      for (const ym of months) shifts.push(...(await Api.getShiftsForMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1)));
      const records = Acceptance.buildRecords(st.rows, pvzList, shifts);
      if (!records.length) { C.staged = null; toast("В файле нет строк — считать нечего"); return; }
      await Api.upsertAcceptance(records);
      C.staged = null;
      const unknown = new Set(records.filter((r) => !r.pvz_id).map((r) => r.wb_pvz_id)).size;
      const other = records.filter((r) => Number(r.bonus_date.slice(0, 4)) !== S.year || Number(r.bonus_date.slice(5, 7)) - 1 !== S.month).length;
      toast(`✅ Посчитано: ${records.length}${unknown ? ` • ПВЗ не найдено: ${unknown}` : ""}${other ? ` • за другие месяцы: ${other}` : ""}`);
    } catch (e) { toast("🚫 " + (e.message || e)); }
    finally { C.busy = false; await refresh().catch(() => A.render()); }
  });
  A.act("acc-set", async (v) => {
    const [id, status] = v.split(":"), a = C.list.find((x) => x.id === id);
    if (!a) return;
    try { await Api.setAcceptanceStatus([id], status); a.status = status; A.render(); } catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("acc-del", async (id) => {
    const a = C.list.find((x) => x.id === id);
    if (!a || !confirm(`Удалить запись приёмки ${dmy(a.bonus_date)} (${asum(Number(a.amount))})?`)) return;
    try { await Api.deleteAcceptance([id]); C.list = C.list.filter((x) => x.id !== id); A.render(); } catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("acc-delall", async () => {
    const ids = C.list.map((a) => a.id);
    if (!ids.length || !confirm(`Удалить ВСЮ приёмку за ${A.MONTHS[S.month]} (${ids.length} шт.)? Засчитанные суммы пропадут из зарплаты.`)) return;
    try { await Api.deleteAcceptance(ids); C.list = []; A.render(); toast("🗑 Приёмка за месяц удалена"); }
    catch (e) { toast("🚫 " + (e.message || e)); await refresh().catch(() => {}); }
  });
  A.act("acc-bulk", async (mode) => {
    const target = (a) => { const v = Number(a.amount); return mode === "all" ? "counted" : mode === "none" ? "skipped" : mode === "plus" ? (v > 0 ? "counted" : "skipped") : mode === "minus" ? (v < 0 ? "counted" : "skipped") : "pending"; };
    const groups = { counted: [], skipped: [], pending: [] };
    C.list.filter((a) => (a.shares || []).length).forEach((a) => { const t = target(a); if (a.status !== t) groups[t].push(a); });
    try {
      for (const k of Object.keys(groups)) { await Api.setAcceptanceStatus(groups[k].map((a) => a.id), k); groups[k].forEach((a) => { a.status = k; }); }
      A.render();
    } catch (e) { toast("🚫 " + (e.message || e)); await refresh().catch(() => {}); }
  });
  A.act("acc-assign", async (wbId) => {
    const sel = document.getElementById("accAssign_" + wbId);
    if (!sel || !sel.value) return;
    try {
      if (S.pvz.some((p) => String(p.wb_id || "").trim() === wbId)) return toast("Этот ID уже привязан к другому ПВЗ");
      await Api.updatePvz(sel.value, { wb_id: wbId });
      S.pvz = await Api.getPvzList();
      const shifts = await Api.getShiftsForMonth(S.year, S.month);
      const mine = C.list.filter((a) => a.wb_pvz_id === wbId);
      await Api.upsertAcceptance(Acceptance.buildRecords(mine.map((a) => ({ wbId, address: a.address || "", date: String(a.bonus_date).slice(0, 10), amount: Number(a.amount) })), S.pvz, shifts));
      await refresh(); toast("✅ ПВЗ привязан");
    } catch (e) { toast("🚫 " + (e.message || e)); }
  });
})();
