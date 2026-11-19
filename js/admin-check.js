// ============================================================
// АДМИНКА: «Сверка смен» — рассылка в бота перед зарплатой и список, кто отметился.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast } = A;
  const GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const K = { last: null, body: null, busy: false, err: "" };

  // период от текущей даты: 1–15 → «с 1 по 15», с 16-го → «с 16 по последний день»
  function period(date = new Date()) {
    const y = date.getFullYear(), m = date.getMonth(), first = date.getDate() <= 15, last = new Date(y, m + 1, 0).getDate();
    return { label: `${first ? "с 1 по 15" : `с 16 по ${last}`} ${GEN[m]}`, end: new Date(y, m, first ? 15 : last) };
  }
  // сверка актуальна, пока не наступил день зарплаты
  const active = (createdAt) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()) < period(new Date(createdAt)).end; };
  const yanaLink = () => {
    const y = S.employees.find((e) => String(e.full_name || "").trim().toLowerCase() === "яна" && e.is_active !== false);
    const u = String(y?.tg_username || "").replace(/^@/, "");
    return /^[A-Za-z0-9_]{4,32}$/.test(u) ? `https://t.me/${u}` : "";
  };
  function defaults() {
    const { label } = period(), link = yanaLink();
    return {
      title: `Сверка смен ${label}`,
      body: `Всем добрый вечер!\n\nПросьба сверить свои смены ${label} включительно 🙏\n\nЕсли есть расхождения с графиком — ${link ? `пишите Яне: ${link}` : "пишите Яне в личку"} 🙏\n\nЕсли всё хорошо и нареканий нет — нажмите кнопку «Всё в порядке» под этим сообщением.\n\nНужны отметки абсолютно ОТ ВСЕХ!`,
    };
  }

  async function enter() {
    K.err = "";
    try { K.last = await Api.getLatestScheduleCheck(); } catch (e) { K.last = null; K.err = e.message || String(e); }
  }

  function view() {
    const def = defaults();
    const c = K.last && active(K.last.created_at) ? K.last : null;
    let status = '<div class="mut">Активной сверки нет</div>';
    if (K.err) status = `<div class="neg">Не удалось загрузить: ${esc(K.err)}</div>`;
    if (c) {
      const rank = (r) => (r.status === "ok" ? 1 : 0);
      const reps = c.replies.slice().sort((a, b) => rank(a) - rank(b) || fullName(a.employees).localeCompare(fullName(b.employees), "ru"));
      const ok = reps.filter((r) => r.status === "ok").length;
      const when = new Date(c.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const rows = reps.map((r) => `<tr><td><b>${esc(fullName(r.employees) || "—")}</b></td><td>${r.status === "ok" ? '<span class="mtag okt">отметился</span>' : r.status === "failed" ? '<span class="mtag badt">не доставлено</span>' : '<span class="mtag">ждём</span>'}</td></tr>`).join("");
      status = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div><b>${esc(c.title)}</b><div class="mut">отправлено ${when} · отметились <b>${ok}</b> из ${reps.length}</div></div>
        ${ok < reps.length ? `<button class="btn" data-act="chk-resend:${c.id}" ${K.busy ? "disabled" : ""}>Напомнить не отметившимся</button>` : '<span class="mtag okt">все отметились</span>'}</div>
        <div class="progress"><i style="width:${reps.length ? Math.round((ok / reps.length) * 100) : 0}%"></i></div>
        <table class="tbl pay" style="margin-top:10px"><tbody>${rows}</tbody></table>`;
    }
    const n = S.employees.filter((e) => e.is_active !== false && !A.pay.isBoss(e) && e.tg_id > 0).length;
    return `<div class="head"><h1>Сверка смен</h1></div>
      <div class="two"><div class="card side"><div class="dh" style="margin-top:0">Новая рассылка</div>
        <div class="mut" style="margin-bottom:10px">Уйдёт в бота всем сотрудникам с доступом (кроме Ивана и Светланы), сейчас ${n}. Под сообщением кнопка «Всё в порядке».</div>
        <textarea class="fld" id="chkBody" rows="11" style="width:100%;resize:vertical;line-height:1.45">${esc(K.body ?? def.body)}</textarea>
        <input type="hidden" id="chkTitle" value="${esc(def.title)}">
        <button class="sm d" data-act="chk-send" style="margin-top:12px;padding:10px 20px" ${K.busy ? "disabled" : ""}>Отправить всем</button></div>
      <div class="card side"><div class="dh" style="margin-top:0">Кто отметился</div>${status}</div></div>`;
  }

  document.addEventListener("input", (e) => { if (e.target.id === "chkBody") K.body = e.target.value; });

  async function send(payload, okText) {
    K.busy = true; A.render();
    try {
      const r = await Api.sendScheduleCheck(payload);
      toast(`✅ ${okText}: ${r.sent}${r.failed?.length ? " · не дошло: " + r.failed.join(", ") : ""}`);
      K.body = null;
    } catch (e) { toast("🚫 " + (e.message || e)); }
    K.busy = false;
    await enter(); A.render();
  }
  A.section("check", { view, enter });
  A.act("chk-send", () => {
    const body = (document.getElementById("chkBody")?.value || "").trim();
    if (!body) return toast("Введите текст сообщения");
    if (!confirm("Отправить это сообщение сотрудникам в бота?")) return;
    send({ title: document.getElementById("chkTitle").value || "Сверка смен", body }, "Отправлено");
  });
  A.act("chk-resend", (id) => {
    if (!confirm("Отправить напоминание тем, кто ещё не нажал «Всё в порядке»?")) return;
    send({ resend_check_id: id }, "Напомнили");
  });
})();
