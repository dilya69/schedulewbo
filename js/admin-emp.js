// ============================================================
// АДМИНКА: раздел «Сотрудники» — список, поиск, добавление, правка, увольнение,
// выдача доступа новым, график за месяц, выгрузка истории.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, toast, pad2 } = A;
  const PINNED = ["светлана", "иван", "яна"];
  const nm = (e) => String(e?.full_name || "").trim().toLowerCase();
  const pinIdx = (e) => PINNED.indexOf(nm(e));
  const isBoss = (e) => ["иван", "светлана"].includes(nm(e));
  const isYana = (e) => nm(e) === "яна";
  const safeUser = (u) => (/^[A-Za-z0-9_]{3,32}$/.test(String(u || "")) ? String(u) : "");
  const E = { q: "" };
  const byId = (id) => S.employees.find((e) => e.id === id);
  const reload = async () => { S.employees = await Api.getEmployees(); };
  const bday = (e) => (e.birth_day && e.birth_month ? `${pad2(e.birth_day)}.${pad2(e.birth_month)}` : "");

  function seen(e) {
    if (!e.last_seen_at) return '<span class="dash">—</span>';
    const d = new Date(e.last_seen_at);
    if (isNaN(d)) return '<span class="dash">—</span>';
    return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(",", "");
  }

  function badges(e) {
    const b = [];
    if (e.is_admin) b.push('<span class="mtag adm">админ</span>');
    if (/стаж[её]р/i.test(e.position || "")) b.push('<span class="mtag tr">стажёр</span>');
    if (e.camera_access) b.push('<span class="mtag cam">камеры</span>');
    return b.join("") || '<span class="dash">—</span>';
  }

  function view() {
    const act = S.employees.filter((e) => e.is_active !== false).sort((a, b) => {
      const pa = pinIdx(a), pb = pinIdx(b);
      if (pa >= 0 || pb >= 0) return (pa >= 0 ? pa : 99) - (pb >= 0 ? pb : 99);
      return String(a.full_name).localeCompare(String(b.full_name), "ru");
    });
    const wait = S.employees.filter((e) => e.is_active === false);
    const key = (e) => esc((e.full_name + " " + (e.real_name || "") + " " + (e.tg_username || "")).toLowerCase());
    const rows = act.map((e) => `<tr data-key="${key(e)}"><td><b>${esc(fullName(e))}</b>${e.real_name ? `<div class="mut">в календаре: ${esc(e.full_name)}</div>` : ""}</td>
      <td>${esc(e.position || "Менеджер")}</td>
      <td>${safeUser(e.tg_username) ? `<a class="lnk" href="https://t.me/${safeUser(e.tg_username)}" target="_blank" rel="noopener">@${safeUser(e.tg_username)}</a>` : '<span class="dash">—</span>'}</td>
      <td>${esc(e.phone || "") || '<span class="dash">—</span>'}</td><td>${badges(e)}</td><td class="num">${seen(e)}</td>
      <td class="acts">${isBoss(e) ? "" : `<button class="btn" data-act="emp-sched:${e.id}">График</button>`}<button class="btn" data-act="emp-edit:${e.id}">Изменить</button><button class="btn no" data-act="emp-fire:${e.id}">Уволить</button></td></tr>`).join("");
    const pend = wait.map((e) => `<tr><td><b>${esc(fullName(e))}</b></td>
      <td>${e.tg_id > 0 ? "ID " + e.tg_id : "ждёт первого входа"}${e.tg_username ? " · @" + esc(e.tg_username) : ""}${e.terminated_at ? " · уволен" : ""}</td>
      <td class="acts"><button class="btn ok" data-act="emp-grant:${e.id}">Дать доступ</button><button class="btn" data-act="emp-edit:${e.id}">Изменить</button><button class="btn no" data-act="emp-fire:${e.id}">Удалить</button></td></tr>`).join("");
    return `<div class="head"><div class="ttl"><h1>Сотрудники</h1><span class="pill">${act.length} чел.</span></div>
      <div class="ag"><button class="p" data-act="emp-add">+ Добавить сотрудника</button></div></div>
      <input class="fld" id="empSearch" placeholder="Поиск по имени или @username" value="${esc(E.q)}" style="max-width:420px;margin-bottom:14px;display:block">
      <div class="card tcard"><table class="tbl pay" id="empTbl"><thead><tr><th>Сотрудник</th><th>Должность</th><th>Telegram</th><th>Телефон</th><th>Метки</th><th class="num">Последний вход</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">Нет сотрудников</td></tr>'}</tbody></table></div>
      ${wait.length ? `<h3 style="margin:24px 0 10px">Ожидают доступа · ${wait.length}</h3><div class="card tcard"><table class="tbl pay"><thead><tr><th>Сотрудник</th><th>Данные</th><th></th></tr></thead><tbody>${pend}</tbody></table></div>` : ""}`;
  }

  function applySearch() {
    const q = E.q.toLowerCase().trim().replace(/^@/, "");
    document.querySelectorAll("#empTbl tbody tr[data-key]").forEach((r) => { r.style.display = !q || r.dataset.key.includes(q) ? "" : "none"; });
  }
  document.addEventListener("input", (e) => { if (e.target.id === "empSearch") { E.q = e.target.value; applySearch(); } });

  // ---- форма добавления / правки ----
  const $v = (id) => document.getElementById(id).value;

  function openAdd() {
    A.modal("Добавить сотрудника", `
      <label>Имя в календаре (коротко)</label><input type="text" id="f_name" placeholder="Ваня">
      <label>Полное имя (Имя Фамилия)</label><input type="text" id="f_realname" placeholder="Иван Иванов">
      <label>Должность</label><input type="text" id="f_position" value="Менеджер">
      <label>Telegram username (без @, необязательно)</label><input type="text" id="f_username" placeholder="ivanov" autocomplete="off">`, async () => {
      const full_name = $v("f_name").trim();
      if (!full_name) { toast("Введите имя"); return false; }
      try {
        await Api.addEmployee({ full_name, position: $v("f_position").trim(), tg_username: $v("f_username").trim().replace(/^@/, "") || null, real_name: $v("f_realname").trim() || null });
        await reload(); A.render(); toast("✅ Сотрудник добавлен");
      } catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  }

  function openEdit(id) {
    const emp = byId(id);
    if (!emp) return;
    const sel = (cur, name) => `<select id="${name}"><option value="false" ${!cur ? "selected" : ""}>Нет</option><option value="true" ${cur ? "selected" : ""}>Да</option></select>`;
    A.modal(`Редактировать: ${fullName(emp)}`, `
      <label>Имя в календаре (коротко)</label><input type="text" id="f_name" value="${esc(emp.full_name)}">
      <label>Полное имя (Имя Фамилия)</label><input type="text" id="f_realname" value="${esc(emp.real_name || "")}">
      <label>Должность</label><input type="text" id="f_position" value="${esc(emp.position || "")}">
      <label>Стажёр с (дата первой смены; если в должности «стажер»)</label><input type="date" id="f_trainee_from" value="${esc(emp.trainee_from || "")}">
      <label>Telegram username (без @)</label><input type="text" id="f_username" autocomplete="off" value="${esc(emp.tg_username || "")}">
      <label>Активен (доступ в приложение)</label>${sel(emp.is_active !== false, "f_active")}
      <label>Администратор</label>${sel(emp.is_admin, "f_admin")}
      <label>День рождения (ДД.ММ)</label><input type="text" id="f_birthday" maxlength="5" placeholder="25.03" value="${bday(emp)}">
      ${isBoss(emp) || isYana(emp) ? `<label>Телефон</label><input type="tel" id="f_phone" placeholder="+7 900 000-00-00" value="${esc(emp.phone || "")}">` : ""}
      <label>Доступ к камерам (бот зовёт по /помогите)</label>${sel(emp.camera_access, "f_camera")}`, async () => {
      const name = $v("f_name").trim();
      const user = $v("f_username").trim().replace(/^@/, "");
      if (!name) { toast("Введите имя"); return false; }
      if (user && !/^[A-Za-z0-9_]{3,32}$/.test(user)) { toast("Username: латиница, цифры и _ (3–32 символа)"); return false; }
      if (user && S.employees.some((e) => e.id !== id && String(e.tg_username || "").toLowerCase() === user.toLowerCase())) { toast("Такой username уже есть у другого сотрудника"); return false; }
      let birth_day = null, birth_month = null;
      const raw = $v("f_birthday").trim();
      if (raw) {
        const m = /^(\d{1,2})[.\/-](\d{1,2})$/.exec(raw);
        const d = m ? +m[1] : 0, mo = m ? +m[2] : 0;
        if (!m || mo < 1 || mo > 12 || d < 1 || d > new Date(2024, mo, 0).getDate()) { toast("День рождения: ДД.ММ, например 25.03"); return false; }
        birth_day = d; birth_month = mo;
      }
      const active = $v("f_active") === "true", admin = $v("f_admin") === "true";
      if (id === A.S.me.id && (!admin || !active)) { toast("Нельзя снять права или доступ у самого себя"); return false; }
      const fields = {
        full_name: name, real_name: $v("f_realname").trim() || null, position: $v("f_position").trim(), trainee_from: $v("f_trainee_from") || null,
        tg_username: user || null, is_active: active, is_admin: admin, birth_day, birth_month, camera_access: $v("f_camera") === "true",
      };
      const ph = document.getElementById("f_phone");
      if (ph) fields.phone = ph.value.trim() || null;
      try { await Api.updateEmployee(id, fields); await reload(); A.render(); toast("✅ Изменения сохранены"); }
      catch (e) { toast("🚫 " + (e.message || e)); return false; }
    });
  }

  function openFire(id) {
    if (id === S.me.id) return toast("Нельзя уволить самого себя");
    const e = byId(id);
    A.modal(`${e?.is_active === false ? "Удалить" : "Уволить"}: ${e?.full_name || ""}`, `
      <p style="font-size:14px;line-height:1.5;margin:0 0 14px">Данные можно удалить через 7 дней (есть время передумать) или сразу и без возврата. Сначала лучше выгрузить историю смен и выплат.</p>
      <div style="display:grid;gap:8px">
        <button class="btn" data-act="emp-history:${id}">Выгрузить данные сотрудника (в Telegram)</button>
        <button class="btn" data-act="emp-softdel:${id}">Уволить (удалить через 7 дней)</button>
        <button class="btn no" data-act="emp-hard:${id}">Удалить сразу, без возврата</button></div>`, null);
  }

  A.section("emp", { view, enter: reload });
  A.act("emp-add", openAdd);
  A.act("emp-edit", openEdit);
  A.act("emp-fire", openFire);
  A.act("emp-grant", async (id) => {
    try { await Api.updateEmployee(id, { is_active: true }); await reload(); A.render(); toast(`✅ Доступ выдан: ${byId(id)?.full_name || ""}`); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("emp-softdel", async (id) => {
    try { await Api.deleteEmployee(id); await reload(); A.closeModal(); A.render(); toast("✅ Уволен. Данные удалятся через 7 дней"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("emp-hard", async (id) => {
    if (!confirm(`Удалить «${byId(id)?.full_name || ""}» ПОЛНОСТЬЮ И НЕМЕДЛЕННО? Отменить будет нельзя.`)) return;
    try { await Api.hardDeleteEmployee(id); await reload(); A.closeModal(); A.render(); toast("✅ Удалён полностью"); }
    catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("emp-history", async (id) => {
    try {
      const name = byId(id)?.full_name || "employee";
      const data = await Api.getEmployeeFullHistory(id);
      const { csvRow, sendCsv, shiftAmount, money } = A.pay;
      let csv = csvRow(["Тип", "Дата/Месяц", "ПВЗ", "Начало", "Конец", "Сумма", "Причина"]);
      data.shifts.forEach((s) => {
        const pvz = s.pvz || S.pvz.find((p) => p.id === s.pvz_id);
        csv += csvRow(["Смена", s.shift_date, pvz?.name || "", s.duration_minutes ? `${s.duration_minutes / 60} ч` : (s.start_time?.slice(0, 5) || ""), s.duration_minutes ? "" : (s.end_time?.slice(0, 5) || ""), money(shiftAmount(s, pvz)), ""]);
      });
      data.bonusesFines.forEach((b) => { csv += csvRow([b.kind === "bonus" ? "Бонус" : "Штраф", b.period_month, "", "", "", b.amount, b.reason || ""]); });
      await sendCsv(csv, `${name.replace(/\s+/g, "_")}_история.csv`);
    } catch (e) { toast("🚫 " + (e.message || e)); }
  });
  A.act("emp-sched", (id) => {
    const e = byId(id);
    const { shiftAmount, rub } = A.pay;
    const list = S.shifts.filter((s) => s.employee_id === id).sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    let total = 0;
    const rows = list.map((s) => {
      const p = S.pvz.find((x) => x.id === s.pvz_id), sum = shiftAmount(s, p);
      total += sum;
      const t = s.duration_minutes ? `${s.duration_minutes / 60} ч` : `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
      return `<div class="dr"><span><i class="dot" style="background:${p?.color || "#999"}"></i>${s.shift_date.slice(8, 10)}.${s.shift_date.slice(5, 7)} · ${esc(p?.name || "ПВЗ")} · ${t}</span><b>${rub(sum)}</b></div>`;
    }).join("");
    A.modal(`${fullName(e)} · ${A.MONTHS[S.month]} ${S.year}`, rows ? `${rows}<div class="dr" style="border-top:2px solid var(--line);margin-top:6px;padding-top:10px"><b>${list.length} смен, итого</b><b>${rub(total)}</b></div>` : '<div class="mut">В этом месяце смен нет</div>', null);
  });
})();
