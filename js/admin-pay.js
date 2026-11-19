// ============================================================
// АДМИНКА: раздел «Зарплата».
// Правила расчёта те же, что в мини-приложении (js/app.js: shiftAmount, bfHalf, allowancesFor).
// Если меняются тарифы — менять в обоих местах.
// ============================================================
(() => {
  const A = Admin;
  const { S, esc, fullName, tint, toast, pad2 } = A;

  // ---- тарифы ----
  const RATE_EARLY = 250, RATE_LATE = 200, RATE_LATE_FROM = 17 * 60;
  const TRAINEE_FULL = 2700, TRAINEE_HOURLY = 200;
  const RE_TRAINEE = /стаж[её]р/i;
  const TICKET_HALF_PAY = 5000;
  const isBoss = (e) => ["иван", "светлана"].includes(String(e?.full_name || "").trim().toLowerCase());
  const toM = (t) => { const [h, m] = String(t || "0:0").slice(0, 5).split(":").map(Number); return (h || 0) * 60 + (m || 0); };

  const P = { period: "full", round: false, open: null, bf: [], allow: [], acc: [], key: "", loading: false };
  try { P.round = localStorage.getItem("roundPay") === "1"; } catch (e) { /* */ }

  const money = (n) => (P.round ? Math.round(Number(n)) : Math.round(Number(n) * 100) / 100);
  const fmt = (n) => {
    const v = money(n);
    return Number.isInteger(v) ? v.toLocaleString("ru-RU") : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const rub = (n) => `${fmt(n)} ₽`;
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + rub(Math.abs(n));

  function addMonthsYmd(ymd, n) {
    const [y, m, d] = String(ymd).split("-").map(Number);
    const total = (m - 1) + n;
    const ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
    return `${ny}-${pad2(nm)}-${pad2(Math.min(d, new Date(ny, nm, 0).getDate()))}`;
  }
  function isTraineeOn(empId, dateStr) {
    if (!empId || !dateStr) return false;
    const e = S.employees.find((x) => x.id === empId);
    if (!e || !RE_TRAINEE.test(e.position || "")) return false;
    let from = e.trainee_from;
    if (!from) from = S.shifts.filter((s) => s.employee_id === empId).map((s) => s.shift_date).sort()[0];
    if (!from) return false;
    return dateStr >= from && dateStr < addMonthsYmd(from, 1);
  }
  function shiftAmount(shift, pvz) {
    if (shift.custom_amount !== undefined && shift.custom_amount !== null && shift.custom_amount !== "") return Number(shift.custom_amount);
    if (!pvz) return 0;
    const trainee = isTraineeOn(shift.employee_id, shift.shift_date);
    const s0 = toM(shift.start_time);
    const rate = trainee ? TRAINEE_HOURLY : (s0 < RATE_LATE_FROM ? RATE_EARLY : RATE_LATE);
    if (shift.duration_minutes) return (shift.duration_minutes / 60) * rate;
    const e0 = toM(shift.end_time);
    if (e0 <= s0) return 0;
    const isFull = s0 === toM(pvz.default_start_time || "09:00") && e0 === toM(pvz.default_end_time || "21:00");
    if (isFull) {
      const full = Number(pvz.full_shift_pay || 0);
      return trainee ? Math.min(TRAINEE_FULL, full) : full;
    }
    return ((e0 - s0) / 60) * rate;
  }

  const inPeriod = (dateStr, period) => {
    if (!period || period === "full") return true;
    const day = Number(String(dateStr).slice(8, 10));
    return period === "first" ? day <= 15 : day >= 16;
  };
  // половина месяца для бонуса/штрафа — по дню добавления (московское время)
  function bfHalf(b) {
    const [py, pm] = String(b.period_month).slice(0, 10).split("-").map(Number);
    const created = b.created_at ? new Date(b.created_at) : null;
    if (!created || isNaN(created)) return "first";
    const [cy, cm, cd] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(created).split("-").map(Number);
    if (cy === py && cm === pm) return cd <= 15 ? "first" : "second";
    return cy * 12 + cm > py * 12 + pm ? "second" : "first";
  }
  const bfIn = (b, period) => !period || period === "full" || bfHalf(b) === period;
  const allowFor = (empId, period) => P.allow.filter((a) => a.employee_id === empId).map((a) => {
    const half = a.amount !== null && a.amount !== undefined && a.amount !== "" ? Number(a.amount) : TICKET_HALF_PAY;
    return { ...a, amount: half * (!period || period === "full" ? 2 : 1) };
  });
  const accFor = (empId, period) => (typeof Acceptance === "undefined" ? 0 : Acceptance.sumFor(P.acc, empId, period));

  // ---- загрузка ----
  async function enter() {
    const key = `${S.year}-${S.month}`;
    P.loading = true;
    const [bf, allow, acc] = await Promise.all([
      Api.getBonusesFines(S.year, S.month),
      Api.getAllowances().catch(() => []),
      Api.getAcceptance(S.year, S.month).catch(() => []),
    ]);
    P.bf = bf; P.allow = allow; P.acc = acc; P.key = key; P.loading = false;
  }

  // ---- расчёт ----
  function compute() {
    const emps = S.employees.filter((e) => e.is_active !== false && !isBoss(e))
      .sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
    return emps.map((e) => {
      const shifts = S.shifts.filter((s) => s.employee_id === e.id && inPeriod(s.shift_date, P.period))
        .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time));
      const base = shifts.reduce((sum, s) => sum + shiftAmount(s, S.pvz.find((p) => p.id === s.pvz_id)), 0);
      const bf = P.bf.filter((b) => b.employee_id === e.id && bfIn(b, P.period));
      const bonuses = bf.filter((b) => b.kind === "bonus"), fines = bf.filter((b) => b.kind === "fine");
      const bonus = bonuses.reduce((s, b) => s + Number(b.amount), 0);
      const fine = fines.reduce((s, b) => s + Number(b.amount), 0);
      const al = allowFor(e.id, P.period), tickets = al.reduce((s, a) => s + a.amount, 0);
      const acc = accFor(e.id, P.period);
      const markets = [...new Set(shifts.map((s) => S.pvz.find((p) => p.id === s.pvz_id)?.marketplace).filter(Boolean))];
      return { e, shifts, base, bonuses, fines, bonus, fine, tickets, acc, markets, total: base + bonus + tickets + acc - fine };
    });
  }

  // ---- вид ----
  const seg = (val, label) => `<button class="${P.period === val ? "on" : ""}" data-act="pay-period:${val}">${label}</button>`;

  function detail(r) {
    const pv = (id) => S.pvz.find((p) => p.id === id);
    const shifts = r.shifts.map((s) => {
      const p = pv(s.pvz_id);
      const t = s.duration_minutes ? `${s.duration_minutes / 60} ч` : `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
      return `<div class="dr"><span><i class="dot" style="background:${p?.color || "#999"}"></i>${s.shift_date.slice(8, 10)}.${s.shift_date.slice(5, 7)} · ${esc(p?.name || "ПВЗ")} ${p?.marketplace === "wb" ? "WB" : "Ozon"} · ${t}</span><b>${rub(shiftAmount(s, p))}</b></div>`;
    }).join("");
    const extra = [
      ...r.bonuses.map((b) => `<div class="dr"><span>Бонус${b.reason ? ` · ${esc(b.reason)}` : ""}</span><b class="pos">+${rub(b.amount)}</b></div>`),
      ...r.fines.map((b) => `<div class="dr"><span>Штраф${b.reason ? ` · ${esc(b.reason)}` : ""}</span><b class="neg">−${rub(b.amount)}</b></div>`),
      ...(r.tickets ? [`<div class="dr"><span>Тикеты</span><b class="pos">+${rub(r.tickets)}</b></div>`] : []),
      ...(r.acc ? [`<div class="dr"><span>Приёмка WB</span><b class="${r.acc > 0 ? "pos" : "neg"}">${signed(r.acc)}</b></div>`] : []),
    ].join("");
    return `<tr class="det"><td colspan="9"><div class="dgrid"><div><div class="dh">Смены (${r.shifts.length})</div>${shifts || '<div class="mut">Смен нет</div>'}</div>
      <div><div class="dh">Надбавки, бонусы, штрафы</div>${extra || '<div class="mut">Ничего нет</div>'}</div></div></td></tr>`;
  }

  function view() {
    const rows = compute();
    const fund = rows.reduce((s, r) => s + r.total, 0);
    const shiftsN = rows.reduce((s, r) => s + r.shifts.length, 0);
    const cell = (v, cls = "") => `<td class="num ${cls}">${v ? rub(v) : '<span class="dash">—</span>'}</td>`;
    const body = rows.map((r) => {
      const open = P.open === r.e.id;
      const tags = r.markets.map((m) => `<span class="mtag ${m}">${m === "wb" ? "WB" : "Ozon"}</span>`).join("");
      return `<tr class="er ${open ? "open" : ""}" data-act="pay-open:${r.e.id}"><td><span class="chev2">›</span><b>${esc(fullName(r.e))}</b>${r.e.position && RE_TRAINEE.test(r.e.position) ? ' <span class="mtag tr">стажёр</span>' : ""}</td>
        <td>${tags}</td><td class="num">${r.shifts.length}</td>${cell(r.base)}${cell(r.tickets, "pos")}
        <td class="num ${r.acc > 0 ? "pos" : r.acc < 0 ? "neg" : ""}">${r.acc ? signed(r.acc) : '<span class="dash">—</span>'}</td>${cell(r.bonus, "pos")}
        <td class="num ${r.fine ? "neg" : ""}">${r.fine ? "−" + rub(r.fine) : '<span class="dash">—</span>'}</td><td class="num tot">${rub(r.total)}</td></tr>${open ? detail(r) : ""}`;
    }).join("");

    return `<div class="head"><div class="ttl"><h1>Зарплата · ${A.MONTHS[S.month]} ${S.year}</h1>
        <div class="stp"><button data-m="-1" data-tip="Предыдущий месяц">‹</button><button data-m="1" data-tip="Следующий месяц">›</button></div></div>
        <div class="ag"><button data-act="pay-round" data-tip="${P.round ? "Показать суммы с копейками" : "Округлить все суммы до рубля"}">${P.round ? "Показать копейки" : "Округлить до рубля"}</button>
        <button data-act="pay-export" data-tip="Ведомость придёт файлом в Telegram">Экспорт ведомости</button>
        <button class="p r" data-act="pay-export-shifts" data-tip="Все смены периода файлом в Telegram">Экспорт смен</button></div></div>
      <div class="seg" style="margin-bottom:16px">${seg("full", "Весь месяц")}${seg("first", "1–15")}${seg("second", "16–конец")}</div>
      <div class="stats"><div class="card stat"><div class="mut">Фонд выплат</div><div class="big">${rub(fund)}</div></div>
        <div class="card stat"><div class="mut">Сотрудников</div><div class="big">${rows.length}</div></div>
        <div class="card stat"><div class="mut">Смен</div><div class="big">${shiftsN}</div></div></div>
      <div class="card tcard"><table class="tbl pay"><thead><tr><th>Сотрудник</th><th>Площадка</th><th class="num">Смены</th><th class="num">По тарифам</th><th class="num">Тикеты</th><th class="num">Приёмка</th><th class="num">Бонусы</th><th class="num">Штрафы</th><th class="num">Итого</th></tr></thead>
      <tbody>${body || '<tr><td colspan="9" class="empty">Нет сотрудников</td></tr>'}</tbody>
      <tfoot><tr><td colspan="8"><b>Всего</b></td><td class="num tot">${rub(fund)}</td></tr></tfoot></table></div>
      <div class="mut" style="margin-top:12px">Нажми на строку, чтобы увидеть смены и надбавки. Начальники (Иван, Светлана) в расчёт не входят.</div>`;
  }

  // ---- CSV (приходит в Telegram: прямое скачивание в WebView заблокировано) ----
  const csvField = (v) => { const s = String(v ?? ""); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvRow = (a) => a.map(csvField).join(";") + "\r\n";
  const suffix = () => (P.period === "first" ? "_1-15" : P.period === "second" ? "_16-конец" : "");
  async function sendCsv(csv, name) {
    try {
      toast("⏳ Отправляю файл в Telegram…");
      await Api.sendFileToMe(name, csv);
      toast("✅ Файл отправлен вам в Telegram");
    } catch (e) { toast("🚫 Не удалось отправить файл: " + (e.message || e)); }
  }

  A.pay = { shiftAmount, rub, isBoss, csvRow, sendCsv, money };
  A.section("pay", { view, enter });
  A.act("pay-period", (v) => { P.period = v; P.open = null; A.render(); });
  A.act("pay-open", (id) => { P.open = P.open === id ? null : id; A.render(); });
  A.act("pay-round", () => {
    P.round = !P.round;
    try { localStorage.setItem("roundPay", P.round ? "1" : "0"); } catch (e) { /* */ }
    A.render();
  });
  A.act("pay-export", () => {
    let csv = csvRow(["Сотрудник", "Смены", "Сумма по тарифам", "Бонусы", "Штрафы", "Итого"]);
    compute().forEach((r) => { csv += csvRow([fullName(r.e), r.shifts.length, money(r.base), money(r.bonus + r.tickets + r.acc), r.fine, money(r.total)]); });
    sendCsv(csv, `payroll_${S.year}_${S.month + 1}${suffix()}.csv`);
  });
  A.act("pay-export-shifts", () => {
    let csv = csvRow(["Дата", "ПВЗ", "Сотрудник", "Начало", "Конец", "Статус", "Сумма"]);
    S.shifts.filter((s) => inPeriod(s.shift_date, P.period)).slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date)).forEach((s) => {
      const p = S.pvz.find((x) => x.id === s.pvz_id);
      csv += csvRow([s.shift_date, p?.name || "", fullName(s.employees), s.duration_minutes ? `${s.duration_minutes / 60} ч` : s.start_time?.slice(0, 5), s.duration_minutes ? "" : s.end_time?.slice(0, 5), s.status, s.employee_id ? money(shiftAmount(s, p)) : ""]);
    });
    sendCsv(csv, `смены_${S.year}_${S.month + 1}${suffix()}.csv`);
  });
})();
