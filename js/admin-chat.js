// ============================================================
// АДМИНКА: «Чат бота» — то же, что команда /settings в рабочем групповом чате:
// какие команды включены (/help, /today, /need), утреннее объявление, напоминание по /help,
// кого звать по /help и на каких ПВЗ.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast } = A;
  const C = { chats: [], busy: false };
  const REMIND = [5, 10, 15, 30, 0];
  const hhmm = (t) => String(t ?? "08:00").slice(0, 5);
  const mskMinutes = () => {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
    return (h % 24) * 60 + m;
  };
  const toMin = (t) => { const [h, m] = hhmm(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const mskToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());

  async function enter() {
    const [chats, emps] = await Promise.all([Api.getHelpChats(), Api.getEmployees()]);
    C.chats = chats; S.employees = emps;
  }

  const people = () => S.employees.filter((e) => e.camera_access && e.is_active !== false).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));

  function chatCard(c) {
    const sw = (key, label, hint) => `<button class="chip ${c[key] ? "on" : ""}" data-act="ch-t:${c.chat_id}:${key}" ${C.busy ? "disabled" : ""}>${c[key] ? "✅" : "⬜"} ${label}</button><span class="mut" style="margin-right:10px">${hint}</span>`;
    return `<div class="card side" style="margin-bottom:16px"><div class="dh" style="margin-top:0">${esc(c.title || "Рабочий чат")}</div>
      <div class="dh">Команды в чате</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px 0;align-items:center">
        ${sw("help_on", "/help", "позвать тех, кто смотрит камеры")}
        ${sw("today_on", "/today", "кто сегодня на смене")}
        ${sw("need_on", "/need", "нужен человек на смену")}
      </div>
      <div class="dh">Утреннее объявление «кто сегодня на смене» (без звука)</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="chip ${c.morning_on ? "on" : ""}" data-act="ch-t:${c.chat_id}:morning_on" ${C.busy ? "disabled" : ""}>${c.morning_on ? "✅ Включено" : "⬜ Выключено"}</button>
        <span class="mut">Время (по Москве):</span>
        <input type="time" class="fld" style="flex:none;width:120px" value="${hhmm(c.morning_time)}" data-chtime="${c.chat_id}">
      </div>
      <div class="dh">Напоминание по /help, если никто не откликнулся</div>
      <div class="chips">${REMIND.map((n) => `<button class="chip ${Number(c.remind_min) === n ? "on" : ""}" data-act="ch-r:${c.chat_id}:${n}" ${C.busy ? "disabled" : ""}>${n ? `через ${n} мин` : "выкл"}</button>`).join("")}</div>
    </div>`;
  }

  function whoCard() {
    const list = people();
    const rows = list.map((e) => {
      const all = !e.help_pvz_ids?.length;
      const scope = all ? S.pvz.map((p) => p.id) : e.help_pvz_ids;
      const chips = S.pvz.map((p) => `<button class="chip ${scope.includes(p.id) ? "on" : ""}" data-act="ch-p:${e.id}:${p.id}" ${C.busy ? "disabled" : ""}><i class="dot" style="background:${p.color}"></i>${esc(p.name)} ${p.marketplace === "wb" ? "WB" : "Ozon"}</button>`).join("");
      return `<div class="lcard"><div class="lrow"><b>${esc(fullName(e))}</b><span class="mut">${all ? "все ПВЗ" : `${scope.length} из ${S.pvz.length} ПВЗ`}</span></div>
        <div class="chips" style="margin:8px 0 0">${chips}${all ? "" : `<button class="chip" data-act="ch-pall:${e.id}">Звать на всех ПВЗ</button>`}</div></div>`;
    }).join("");
    return `<div class="card side"><div class="dh" style="margin-top:0">Кого звать по /help</div>
      <div class="mut" style="margin-bottom:10px">Здесь люди с включённым «Доступом к камерам» (включается в карточке сотрудника). Выбери, на каких ПВЗ их звать. Если ПВЗ в сообщении не определился, зовём всех.</div>
      ${rows || '<div class="mut">Ни у кого нет доступа к камерам</div>'}</div>`;
  }

  function view() {
    const left = C.chats.length
      ? C.chats.map(chatCard).join("")
      : `<div class="card side"><div class="dh" style="margin-top:0">Чат не подключён</div><div class="mut">Добавь бота в рабочую группу и напиши там <b>/help_here</b> (от имени админа). После этого чат появится здесь.</div></div>`;
    return `<div class="head"><h1>Чат бота</h1></div><div class="two">${left}${whoCard()}</div>
      <div class="mut" style="max-width:1200px;margin-top:6px">Меню команд «/» в самом чате обновится, когда выключенные или включённые команды перезапишет сам бот (в чате команда /settings делает это сразу). Сами команды перестают работать сразу.</div>`;
  }

  async function patchChat(chatId, patch) {
    C.busy = true; A.render();
    try {
      const c = await Api.updateHelpChat(chatId, patch);
      C.chats = C.chats.map((x) => (String(x.chat_id) === String(chatId) ? { ...x, ...c } : x));
      toast("✅ Сохранено");
    } catch (e) { toast("🚫 " + (e.message || e)); }
    C.busy = false; A.render();
  }
  const find = (id) => C.chats.find((x) => String(x.chat_id) === String(id));

  A.section("botchat", { view, enter });

  A.act("ch-t", (arg) => {
    const [id, key] = arg.split(":"), c = find(id);
    if (!c) return;
    const patch = { [key]: !c[key] };
    // если время объявления сегодня уже прошло, первое объявление будет завтра
    if (key === "morning_on" && patch.morning_on) patch.morning_last = mskMinutes() >= toMin(c.morning_time) ? mskToday() : null;
    patchChat(id, patch);
  });
  A.act("ch-r", (arg) => { const [id, n] = arg.split(":"); patchChat(id, { remind_min: Number(n) }); });
  document.addEventListener("change", (e) => {
    const id = e.target.dataset?.chtime;
    if (!id || !e.target.value) return;
    patchChat(id, { morning_time: e.target.value, morning_on: true, morning_last: mskMinutes() >= toMin(e.target.value) ? mskToday() : null });
  });

  async function savePvz(empId, next) {
    C.busy = true; A.render();
    try {
      await Api.updateEmployee(empId, { help_pvz_ids: next });
      S.employees = S.employees.map((e) => (e.id === empId ? { ...e, help_pvz_ids: next } : e));
      toast("✅ Сохранено");
    } catch (e) { toast("🚫 " + (e.message || e)); }
    C.busy = false; A.render();
  }
  A.act("ch-p", (arg) => {
    const [empId, pid] = arg.split(":"), e = S.employees.find((x) => x.id === empId);
    if (!e) return;
    const allIds = S.pvz.map((p) => p.id), cur = e.help_pvz_ids?.length ? e.help_pvz_ids : allIds;
    let next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
    if (!next.length) return toast("Оставь хотя бы один ПВЗ");
    if (next.length === allIds.length) next = null;
    savePvz(empId, next);
  });
  A.act("ch-pall", (empId) => savePvz(empId, null));
})();
