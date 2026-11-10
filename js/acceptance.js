// ============================================================
// Acceptance — «Приёмка» WB: мотивация за скорость приёмки утренней поставки.
// Чистая логика без DOM и Supabase (работает и в браузере, и в Node для проверки).
//
// Файл с сайта WB: колонки «ID ПВЗ», «Регион», «Адрес», «Дата» (ДД.ММ.ГГГГ), «Мотивация за скорость приемки».
// Сумма может быть отрицательной (просрочка поставки).
// Сумма за день делится поровну между теми, кто в этот день на этом ПВЗ работал с 9 утра.
// ============================================================
const Acceptance = (() => {
  const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const norm = (s) => clean(s).toLowerCase().replace(/ё/g, "е");
  const pad2 = (n) => String(n).padStart(2, "0");
  const toMin = (t) => { const [h, m] = String(t || "0:0").slice(0, 5).split(":").map(Number); return (h || 0) * 60 + (m || 0); };

  // «С утра» = смена началась в 9:00 или раньше. Короткие смены «на N часов» (без точного времени) не считаются.
  const MORNING_START = "09:00";

  // дата из ячейки: «01.08.2026», «2026-08-01», число-серийник Excel или Date
  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    if (typeof v === "number" && v > 30000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
    const s = clean(v);
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function parseAmount(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    const s = clean(v).replace(/\s/g, "").replace(",", ".").replace(/[−–—]/g, "-").replace(/[^\d.\-+]/g, "");
    if (!s || s === "-" || s === "+") return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  // один файл → { rows:[{wbId,address,date,amount}], errors:[] }
  function parseWorkbook(XLSX, data, fileName) {
    const out = { rows: [], errors: [] };
    const wb = XLSX.read(data, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) { out.errors.push(`${fileName}: пустой файл`); return out; }
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

    // ищем строку заголовков (обычно первая)
    let hi = -1, col = {};
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
      const c = {};
      grid[i].forEach((cell, j) => {
        const t = norm(cell);
        if (!t) return;
        if (c.id === undefined && /^id( |$)|id пвз|^пвз$|номер пвз/.test(t)) c.id = j;
        else if (c.addr === undefined && t.includes("адрес")) c.addr = j;
        else if (c.date === undefined && t === "дата") c.date = j;
        else if (c.sum === undefined && (t.includes("мотивац") || t.includes("прием") || t.includes("приём"))) c.sum = j;
      });
      if (c.id !== undefined && c.date !== undefined && c.sum !== undefined) { hi = i; col = c; break; }
    }
    if (hi < 0) {
      out.errors.push(`${fileName}: не нашёл колонки «ID ПВЗ», «Дата» и «Мотивация за скорость приемки»`);
      return out;
    }
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i];
      const wbId = clean(r[col.id]).replace(/\.0$/, "");
      if (!wbId && !clean(r[col.date]) && clean(r[col.sum]) === "") continue; // пустая строка
      const date = parseDate(r[col.date]);
      const amount = parseAmount(r[col.sum]);
      if (!wbId || !date || amount === null) {
        out.errors.push(`${fileName}, строка ${i + 1}: не разобрал (ID «${wbId}», дата «${clean(r[col.date])}», сумма «${clean(r[col.sum])}»)`);
        continue;
      }
      out.rows.push({ wbId, address: col.addr !== undefined ? clean(r[col.addr]) : "", date, amount });
    }
    return out;
  }

  // несколько файлов подряд; повтор (тот же ПВЗ и дата) — побеждает последний
  function mergeRows(list) {
    const map = new Map();
    for (const r of list) map.set(`${r.wbId}|${r.date}`, r);
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.wbId.localeCompare(b.wbId));
  }

  // кто в этот день на этом ПВЗ работал с утра
  function morningEmployees(shifts, pvzId, date) {
    const ids = new Set();
    for (const s of shifts) {
      if (s.pvz_id !== pvzId || String(s.shift_date).slice(0, 10) !== date || !s.employee_id) continue;
      if (s.duration_minutes) continue;
      if (toMin(s.start_time) <= toMin(MORNING_START)) ids.add(s.employee_id);
    }
    return [...ids];
  }

  // доли поровну, в копейках; остаток от деления достаётся первым, чтобы сумма сошлась
  function splitShares(amount, employeeIds) {
    const n = employeeIds.length;
    if (!n) return [];
    const cents = Math.round(amount * 100);
    const base = Math.trunc(cents / n);
    let rest = cents - base * n;
    const step = rest > 0 ? 1 : -1;
    return employeeIds.map((id) => {
      let c = base;
      if (rest !== 0) { c += step; rest -= step; }
      return { employee_id: id, amount: c / 100 };
    });
  }

  // строки файла + ПВЗ + смены → записи для таблицы acceptance_bonuses
  function buildRecords(rows, pvzList, shifts) {
    const byWb = new Map(pvzList.filter((p) => p.wb_id).map((p) => [String(p.wb_id).trim(), p]));
    return rows.map((r) => {
      const pvz = byWb.get(r.wbId) || null;
      const emps = pvz ? morningEmployees(shifts, pvz.id, r.date) : [];
      return {
        wb_pvz_id: r.wbId, pvz_id: pvz ? pvz.id : null, address: r.address || null,
        bonus_date: r.date, amount: r.amount, shares: splitShares(r.amount, emps),
      };
    });
  }

  // сколько засчитанной приёмки у сотрудника за период (first | second | full)
  function sumFor(records, employeeId, period) {
    let sum = 0;
    for (const a of records) {
      if (a.status !== "counted") continue;
      if (period === "first" && Number(String(a.bonus_date).slice(8, 10)) > 15) continue;
      if (period === "second" && Number(String(a.bonus_date).slice(8, 10)) <= 15) continue;
      for (const s of a.shares || []) if (s.employee_id === employeeId) sum += Number(s.amount);
    }
    return Math.round(sum * 100) / 100;
  }

  return { parseWorkbook, mergeRows, buildRecords, morningEmployees, splitShares, sumFor, parseDate, parseAmount };
})();

if (typeof module !== "undefined") module.exports = Acceptance;
