// ============================================================
// АДМИНКА: «Рассылка» — сообщение выбранным сотрудникам от имени автора, с кнопкой «Принял(а)».
// Отправляет серверная функция broadcast-check (режим kind: "broadcast"), как кнопка «📢 Рассылка» в боте.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast } = A;
  const R = { sel: new Set(), body: "", list: [], members: new Map(), busy: false, init: false, open: null };
  const dt = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const reachable = () => S.employees.filter((e) => e.is_active !== false && Number(e.tg_id) > 0).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));

  async function enter() {
    const d = new Date(), months = [-1, 0, 1].map((k) => new Date(d.getFullYear(), d.getMonth() + k, 1));
    const [emps, list, ...ms] = await Promise.all([Api.getEmployees(), Api.getBroadcasts(10), ...months.map((m) => Api.getShiftsForMonth(m.getFullYear(), m.getMonth()))]);
    S.employees = emps; R.list = list;
    R.members = new Map();
    for (const s of ms.flat()) { if (!s.employee_id) continue; if (!R.members.has(s.pvz_id)) R.members.set(s.pvz_id, new Set()); R.members.get(s.pvz_id).add(s.employee_id); }
  }

  function view() {
    const emps = reachable(), nobot = S.employees.filter((e) => e.is_active !== false && !(Number(e.tg_id) > 0));
    const ids = new Set(emps.map((e) => e.id));
    for (const id of [...R.sel]) if (!ids.has(id)) R.sel.delete(id);
    const chips = S.pvz.map((p) => {
      const m = [...(R.members.get(p.id) || [])].filter((id) => ids.has(id));
      if (!m.length) return "";
      const all = m.every((id) => R.sel.has(id));
      return `<button class="chip ${all ? "on" : ""}" data-act="bc-pvz:${p.id}"><i class="dot" style="background:${p.color}"></i><span class="chn">${esc(A.addrLabel(p.name))}</span><span class="mtag ${p.marketplace === "wb" ? "wb" : "ozon"}">${p.marketplace === "wb" ? "WB" : "Ozon"}</span><span class="chc">${m.length}</span></button>`;
    }).join("");
    const people = emps.map((e) => `<label class="pick ${R.sel.has(e.id) ? "on" : ""}" title="${esc(fullName(e))}"><input type="checkbox" data-bce="${e.id}" ${R.sel.has(e.id) ? "checked" : ""}><span>${esc(fullName(e))}</span></label>`).join("");
    const me = S.me;
    const hist = R.list.map((b) => {
      const ok = b.replies.filter((r) => r.status === "ok").length, fail = b.replies.filter((r) => r.status === "failed").length, open = R.open === b.id;
      const rows = b.replies.slice().sort((a, c) => (a.status === "ok") - (c.status === "ok") || fullName(a.employees).localeCompare(fullName(c.employees), "ru"))
        .map((r) => `<div class="dr"><span>${esc(fullName(r.employees) || "—")}</span>${r.status === "ok" ? '<span class="mtag okt">принял</span>' : r.status === "failed" ? '<span class="mtag badt">не доставлено</span>' : '<span class="mtag">ждём</span>'}</div>`).join("");
      return `<div class="lcard"><div class="lrow" data-act="bc-open:${b.id}" style="cursor:pointer"><div style="min-width:0;flex:1"><b>${esc(String(b.body).slice(0, 70))}${b.body.length > 70 ? "…" : ""}</b>
        <div class="mut">${dt(b.created_at)} · ${esc(b.author_name)} · приняли ${ok} из ${b.replies.length}${fail ? ` · не доставлено ${fail}` : ""}</div></div><button class="lx" data-act="bc-del:${b.id}" title="Удалить рассылку из истории" aria-label="Удалить рассылку">🗑</button><span class="chev2" style="transform:rotate(${open ? 90 : 0}deg)">›</span></div>
        ${open ? `<div class="lbody"><div class="lfull">${esc(b.body)}</div>${rows}<div class="lbtns">${ok < b.replies.length - fail ? `<button class="btn" data-act="bc-remind:${b.id}" ${R.busy ? "disabled" : ""}>Напомнить не принявшим</button>` : ""}<button class="btn no" data-act="bc-del:${b.id}">Удалить рассылку</button></div></div>` : ""}</div>`;
    }).join("");
    return `<div class="head"><h1>Рассылка</h1></div><div class="two">
      <div class="card side"><div class="dh" style="margin-top:0">Новая рассылка</div>
        <div class="dh">Кому · выбрано ${R.sel.size} из ${emps.length}</div>
        <div class="bulk" style="margin-bottom:8px"><button data-act="bc-all">Выбрать всех</button><button data-act="bc-none">Снять всех</button></div>
        <div class="chips">${chips}</div>
        <div class="picks">${people}</div>
        ${nobot.length ? `<div class="mut" style="margin-top:8px">Не запускали бота, написать нельзя: ${esc(nobot.map((e) => e.full_name).join(", "))}</div>` : ""}
        <div class="dh">Текст</div>
        <textarea class="fld bcta" id="bcBody" rows="7" placeholder="Что нужно сообщить">${esc(R.body)}</textarea>
        <div class="mut" style="margin-top:6px">Подпись добавится автоматически: «— ${esc(me?.full_name || "")}». Под сообщением будет кнопка «Принял(а)».</div>
        <button class="sm d" data-act="bc-send" style="margin-top:14px;padding:11px 22px" ${R.busy ? "disabled" : ""}>${R.busy ? "Отправляю…" : `Отправить (${R.sel.size})`}</button></div>
      <div class="card side"><div class="dh" style="margin-top:0">Последние рассылки</div>${hist || '<div class="mut">Рассылок пока не было</div>'}</div></div>`;
  }

  document.addEventListener("input", (e) => { if (e.target.id === "bcBody") R.body = e.target.value; });
  document.addEventListener("change", (e) => {
    const id = e.target.dataset?.bce;
    if (!id) return;
    if (e.target.checked) R.sel.add(id); else R.sel.delete(id);
    A.render();
  });

  A.section("bcast", { view, enter });
  A.act("bc-all", () => { R.sel = new Set(reachable().map((e) => e.id)); A.render(); });
  A.act("bc-none", () => { R.sel = new Set(); A.render(); });
  A.act("bc-pvz", (pid) => {
    const ids = new Set(reachable().map((e) => e.id));
    const m = [...(R.members.get(pid) || [])].filter((id) => ids.has(id));
    const all = m.every((id) => R.sel.has(id));
    m.forEach((id) => (all ? R.sel.delete(id) : R.sel.add(id)));
    A.render();
  });
  A.act("bc-del", async (id) => {
    if (!confirm("Удалить рассылку из истории? Сообщения, которые уже пришли сотрудникам в Telegram, останутся у них.")) return;
    try {
      await Api.deleteBroadcast(id);
      if (R.open === id) R.open = null;
      await enter();
      toast("🗑️ Рассылка удалена");
    } catch (e) { toast("🚫 " + (e.message || e)); }
    A.render();
  });
  A.act("bc-open", (id) => { R.open = R.open === id ? null : id; A.render(); });

  async function call(payload) {
    R.busy = true; A.render();
    try { return await Api.sendScheduleCheck(payload); }
    finally { R.busy = false; }
  }
  A.act("bc-send", async () => {
    const body = (document.getElementById("bcBody")?.value || R.body).trim();
    if (!R.sel.size) return toast("Выбери получателей");
    if (!body) return toast("Введи текст сообщения");
    if (!confirm(`Отправить сообщение ${R.sel.size} сотрудникам в бота?`)) return;
    try {
      const r = await call({ kind: "broadcast", body, employee_ids: [...R.sel], author_id: S.me.id });
      toast(`✅ Отправлено: ${r.sent}${r.failed?.length ? " · не дошло: " + r.failed.join(", ") : ""}`);
      R.body = ""; R.sel = new Set();
      await enter(); R.open = r.broadcast_id || null;
    } catch (e) { toast("🚫 " + (e.message || e)); }
    A.render();
  });
  A.act("bc-remind", async (id) => {
    if (!confirm("Отправить напоминание тем, кто ещё не нажал «Принял(а)»?")) return;
    try {
      const r = await call({ resend_broadcast_id: id });
      toast(r.sent ? `🔔 Напомнили: ${r.sent}${r.failed?.length ? " · не дошло: " + r.failed.join(", ") : ""}` : "Некому напоминать — все уже приняли или недоступны");
      await enter();
    } catch (e) { toast("🚫 " + (e.message || e)); }
    A.render();
  });
})();
