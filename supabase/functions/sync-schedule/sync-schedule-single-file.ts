// @ts-nocheck
// ОДНОФАЙЛОВАЯ версия sync-schedule для вставки в Supabase Dashboard
// (Edge Functions -> Deploy a new function -> Via Editor). Внутри уже есть код разбора графика.
// sync-schedule — раз в N минут скачивает график с Яндекс Диска (публичная ссылка),
// разбирает его тем же кодом, что и кнопка «Импорт графика» в приложении, и пишет смены.
// Запускается: cron (заголовок x-sync-secret) или админом из приложения («Обновить сейчас»).
//
// Секреты: BOT_TOKEN (уже есть), SYNC_SECRET (новый, любая длинная строка).
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

// ===================== разбор графика (то же, что js/sheet-import.js) =====================
// ============================================================
// SheetImport — разбор графика из Excel (календарная сетка по ПВЗ)
// и расчёт плана изменений. Чистая логика, без DOM и без Supabase:
// работает и в браузере, и в Node (для проверки на реальном файле).
//
// Правила записи в ячейке дня:
//   «Катя»            — полный день (от открытия до закрытия ПВЗ)
//   «Катя с 17»       — с 17:00 до закрытия (помощник)
//   «Катя до 14»      — от открытия до 14:00
//   «Катя с 11 до 17» — ровно этот промежуток
//   «?» / «? с 17»    — свободная смена (пока никого не нашли)
//   «:)» или «-»      — в этот день смены нет
//   «Катя+»           — плюс = бонус (импорт только напоминает о нём)
//   «Катя обуч»       — обучение: смена по обычному тарифу, в отчёте отдельной строкой
// ============================================================
const SheetImport = (() => {
  const MONTHS = {
    "январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6,
    "июль": 7, "август": 8, "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
  };
  const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const MP_WORDS = new Set(["wb", "ozon", "озон", "вб"]);

  const pad2 = (n) => String(n).padStart(2, "0");
  const clean = (s) => String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const normKey = (s) => clean(s).toLowerCase().replace(/ё/g, "е");
  const hhmm = (t) => String(t || "").slice(0, 5);

  // "17" | "17:30" | "17.30" -> "17:00" | "17:30" | "17:30"
  function parseTime(t) {
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(String(t));
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2] || 0);
    if (h > 23 || mi > 59) return null;
    return `${pad2(h)}:${pad2(mi)}`;
  }

  // ---------- разбор одной ячейки ----------
  function parseCell(rawText) {
    let s = clean(rawText);
    if (!s) return { kind: "empty" };
    if (/^(:\)|:-\)|-|—|–)$/.test(s)) return { kind: "none" };

    let bonus = false, training = false;
    if (/\++$/.test(s)) { bonus = true; s = s.replace(/\++$/, "").trim(); }
    // «Матвей обуч» / «Матвей обуч.» — стажировка: оплата обычная, но админу показываем отдельно
    if (/\s+обуч\.?$/i.test(s)) { training = true; s = s.replace(/\s+обуч\.?$/i, "").trim(); }

    // «с» и «c» (латинская) принимаем одинаково — частая опечатка
    const m = /^(.*?)(?:\s+[сc]\s*(\d{1,2}(?:[:.]\d{2})?))?(?:\s+до\s*(\d{1,2}(?:[:.]\d{2})?))?$/i.exec(s);
    if (!m) return { kind: "error", error: "не понял запись" };
    const name = clean(m[1]);
    const from = m[2] ? parseTime(m[2]) : null;
    const to = m[3] ? parseTime(m[3]) : null;
    if ((m[2] && !from) || (m[3] && !to)) return { kind: "error", error: "не понял время" };
    if (!name) return { kind: "error", error: "нет имени" };
    if (name === "?") return { kind: "free", from, to };
    return { kind: "person", name, key: normKey(name), from, to, bonus, training };
  }

  // ---------- разбор книги Excel ----------
  // XLSX — библиотека SheetJS; data — ArrayBuffer файла; year — год, в котором проверяем дни недели
  function parseWorkbook(XLSX, data, year) {
    const wb = XLSX.read(data, { type: "array" });
    const sheetName = wb.SheetNames.includes("График") ? "График" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const out = { sheetName, monthName: null, month: null, blocks: [], strays: [], comments: [], errors: [] };
    if (!ws || !ws["!ref"]) { out.errors.push("Лист пустой"); return out; }

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const enc = (r, c) => XLSX.utils.encode_cell({ r, c });
    const rawVal = (r, c) => { const x = ws[enc(r, c)]; return x ? x.v : undefined; };
    const text = (r, c) => { const v = rawVal(r, c); return v === undefined || v === null ? "" : clean(String(v)); };

    // месяц — в первых строках («Октябрь»)
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 3) && !out.month; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, 30); c++) {
        const t = text(r, c);
        if (MONTHS[normKey(t)]) { out.monthName = t; out.month = MONTHS[normKey(t)]; break; }
      }
    }
    if (!out.month) { out.errors.push("Не нашла название месяца в первых строках файла (например, «Октябрь»)"); return out; }
    const daysInMonth = new Date(year, out.month, 0).getDate();

    // заголовки блоков (оканчиваются на WB / OZON) и строки «Комментарии»
    const titles = [], commentRows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (normKey(text(r, 0)).startsWith("комментар")) commentRows.push(r);
      for (let c = 0; c <= 3; c++) {
        const t = text(r, c);
        if (t && /(^|\s)(wb|ozon)\s*$/i.test(t) && !normKey(t).startsWith("комментар")) { titles.push({ r, c, title: t }); break; }
      }
    }
    if (!titles.length) { out.errors.push("Не нашла ни одного блока ПВЗ (заголовок должен оканчиваться на WB или OZON)"); return out; }

    titles.forEach((tt, i) => {
      const nextTitle = i + 1 < titles.length ? titles[i + 1].r : range.e.r + 1;
      const cr = commentRows.find((r) => r > tt.r && r < nextTitle);
      const end = cr !== undefined ? cr : nextTitle; // строки блока: [tt.r, end)
      const blk = {
        title: tt.title,
        mp: /ozon\s*$/i.test(tt.title) ? "ozon" : "wb",
        row: tt.r + 1,
        days: {},
        errors: [],
        warnings: [],
      };

      // комментарии под блоком (только показываем, не импортируем)
      if (cr !== undefined) {
        for (let r = cr; r < nextTitle; r++) for (let c = range.s.c; c <= range.e.c; c++) {
          const t = text(r, c);
          if (t && !normKey(t).startsWith("комментар")) out.comments.push({ block: tt.title, cell: enc(r, c), text: t });
        }
      }

      // строка с днями недели
      let hr = -1, cols = [];
      for (let r = tt.r + 1; r <= Math.min(tt.r + 6, end - 1); r++) {
        const found = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const i2 = WD.indexOf(normKey(text(r, c)));
          if (i2 >= 0) found[i2] = c;
        }
        if (found.filter((x) => x !== undefined).length >= 5) { hr = r; cols = found; break; }
      }
      if (hr < 0) { blk.errors.push("не нашла строку с днями недели (Пн…Вс)"); out.blocks.push(blk); return; }

      const known = new Set([enc(tt.r, tt.c)]);
      for (let w = 0; w < 7; w++) if (cols[w] !== undefined) known.add(enc(hr, cols[w]));

      for (let wd = 0; wd < 7; wd++) {
        const hc = cols[wd];
        if (hc === undefined) continue;
        const nameCol = hc + 1, dateCol = hc + 2; // имя — в средней колонке дня, число — в правой
        const dateRows = [];
        for (let r = hr + 1; r < end; r++) {
          const v = rawVal(r, dateCol);
          const n = typeof v === "number" ? v : (typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN);
          if (Number.isInteger(n) && n >= 1 && n <= 31) dateRows.push({ r, day: n });
        }
        dateRows.forEach((d, idx) => {
          known.add(enc(d.r, dateCol));
          const stop = idx + 1 < dateRows.length ? dateRows[idx + 1].r : end;
          if (d.day > daysInMonth) { blk.errors.push(`число ${d.day} не бывает в этом месяце`); return; }
          if (blk.days[d.day]) { blk.errors.push(`число ${d.day} встречается дважды`); return; }
          const jsWd = (new Date(year, out.month - 1, d.day).getDay() + 6) % 7;
          if (jsWd !== wd) blk.errors.push(`число ${d.day} стоит в колонке «${WD[wd]}», а по календарю это «${WD[jsWd]}»`);
          const entries = [];
          for (let r = d.r + 1; r < stop; r++) {
            const t = text(r, nameCol);
            if (!t) continue;
            known.add(enc(r, nameCol));
            entries.push({ cell: enc(r, nameCol), raw: t, ...parseCell(t) });
          }
          blk.days[d.day] = { day: d.day, entries };
        });
      }

      const missing = [];
      for (let d = 1; d <= daysInMonth; d++) if (!blk.days[d]) missing.push(d);
      if (missing.length) blk.warnings.push(`не нашла числа: ${missing.join(", ")}`);

      // любой текст в блоке, который не вписался в сетку
      for (let r = tt.r; r < end; r++) for (let c = range.s.c; c <= range.e.c; c++) {
        const t = text(r, c);
        if (t && !known.has(enc(r, c))) out.strays.push({ block: tt.title, cell: enc(r, c), text: t });
      }
      out.blocks.push(blk);
    });
    return out;
  }

  // ---------- сопоставление ПВЗ ----------
  // «Ярославский к1 OZON» и «Ярославский 1 Ozon» -> один и тот же ключ «ярославский 1»
  function pvzKey(name) {
    return normKey(name).replace(/[^a-zа-я0-9 ]/g, " ").split(" ")
      .filter((t) => t && !MP_WORDS.has(t))
      .map((t) => t.replace(/^к(\d+)$/, "$1"))
      .join(" ");
  }

  function matchPvz(blk, pvzList, mappings) {
    const tk = normKey(blk.title);
    const manual = mappings?.pvz?.[tk];
    if (manual) return pvzList.find((p) => p.id === manual) || null;
    const byTitle = pvzList.find((p) => p.sheet_title && normKey(p.sheet_title) === tk);
    if (byTitle) return byTitle;
    const k = pvzKey(blk.title);
    const cands = pvzList.filter((p) => p.marketplace === blk.mp && pvzKey(p.name) === k);
    return cands.length === 1 ? cands[0] : null;
  }

  // ---------- план изменений ----------
  // Принцип: смены, которые принёс импорт, помечаются source='sheet'.
  // Только их импорт может удалить, когда запись пропала из таблицы.
  // Смены, созданные вручную в боте, импорт не удаляет — только показывает в отчёте.
  function buildPlan({ parsed, year, month, pvzList, employees, shifts, mappings }) {
    mappings = mappings || { pvz: {}, emp: {} };
    const plan = {
      inserts: [], updates: [], deletes: [],
      stats: { keep: 0, adopt: 0, claimed: 0, inserted: 0, deleted: 0, freeKept: 0 },
      unmatchedPvz: [], unmatchedNames: [], cellErrors: [], blockErrors: [], bonuses: [], trainings: [],
      manualExtra: [], pendingKept: [], conflicts: [], duplicatePeople: [], unsafeDays: [],
      skippedEntries: 0, matchedBlocks: 0, peopleEntries: 0, freeEntries: 0,
      comments: parsed.comments || [], strays: parsed.strays || [], pvzUsed: {},
    };

    // сотрудники: полное имя + псевдонимы из employees.sheet_alias (через «;»)
    const empByKey = new Map();
    const addAlias = (k, e) => {
      if (!k) return;
      const arr = empByKey.get(k) || [];
      if (!arr.includes(e)) arr.push(e);
      empByKey.set(k, arr);
    };
    for (const e of employees) {
      if (e.is_active === false) continue;
      addAlias(normKey(e.full_name), e);
      String(e.sheet_alias || "").split(/[;\n]/).forEach((a) => addAlias(normKey(a), e));
    }
    const resolveEmp = (k) => {
      const m = mappings.emp?.[k];
      if (m === "__skip__") return "skip";
      if (m) { const e = employees.find((x) => x.id === m && x.is_active !== false); if (e) return e; }
      const arr = empByKey.get(k);
      if (!arr || !arr.length) return null;
      return arr.length === 1 ? arr[0] : { ambiguous: true };
    };

    const existingBy = new Map();
    for (const s of shifts) {
      const k = `${s.pvz_id}|${s.shift_date}`;
      if (!existingBy.has(k)) existingBy.set(k, []);
      existingBy.get(k).push(s);
    }

    const unmatched = new Map();
    const touched = new Set();
    const rowFrom = (s, patch) => ({
      id: s.id, pvz_id: s.pvz_id, shift_date: s.shift_date,
      start_time: hhmm(s.start_time), end_time: hhmm(s.end_time),
      employee_id: s.employee_id || null, status: s.status,
      custom_amount: s.custom_amount ?? null, source: s.source ?? null, ...patch,
    });
    const isFreeSlot = (s) => s.status === "free" && !s.employee_id;

    for (const blk of parsed.blocks) {
      if (blk.errors.length) { plan.blockErrors.push({ title: blk.title, errors: blk.errors }); continue; }
      const pvz = matchPvz(blk, pvzList, mappings);
      if (!pvz) { plan.unmatchedPvz.push({ title: blk.title, key: normKey(blk.title), mp: blk.mp }); continue; }
      plan.matchedBlocks++;
      plan.pvzUsed[pvz.id] = pvz.name;
      const open = hhmm(pvz.default_start_time) || "09:00";
      const close = hhmm(pvz.default_end_time) || "21:00";

      for (const day of Object.values(blk.days)) {
        const date = `${year}-${pad2(month)}-${pad2(day.day)}`;
        const desired = [];
        let noneDay = false, unsafe = false;

        for (const en of day.entries) {
          if (en.kind === "none") { noneDay = true; continue; }
          if (en.kind === "error") {
            plan.cellErrors.push({ block: blk.title, cell: en.cell, raw: en.raw, error: en.error });
            unsafe = true; continue;
          }
          const start = en.from || open, end = en.to || close;
          if (start >= end) {
            plan.cellErrors.push({ block: blk.title, cell: en.cell, raw: en.raw, error: `время ${start}–${end}: начало не раньше конца` });
            unsafe = true; continue;
          }
          if (en.kind === "free") { plan.freeEntries++; desired.push({ free: true, start, end, cell: en.cell }); continue; }

          plan.peopleEntries++;
          const r = resolveEmp(en.key);
          if (r === "skip") { plan.skippedEntries++; unsafe = true; continue; }
          if (!r || r.ambiguous) {
            const u = unmatched.get(en.key) || { key: en.key, name: en.name, count: 0, ambiguous: !!(r && r.ambiguous), examples: [] };
            u.count++;
            if (u.examples.length < 3) u.examples.push(`${blk.title}, ${day.day}`);
            unmatched.set(en.key, u);
            plan.skippedEntries++; unsafe = true; continue;
          }
          if (desired.some((d) => d.empId === r.id)) plan.duplicatePeople.push({ block: blk.title, date, name: en.name, cell: en.cell });
          desired.push({ empId: r.id, start, end, cell: en.cell });
          if (en.bonus) plan.bonuses.push({ pvz: pvz.name, date, name: en.name });
          if (en.training) plan.trainings.push({ pvz: pvz.name, date, name: en.name });
        }
        if (unsafe) plan.unsafeDays.push({ block: blk.title, date });

        // ---- сверка с тем, что уже есть в приложении ----
        const existing = existingBy.get(`${pvz.id}|${date}`) || [];
        const used = new Set();
        const sameTime = (s, d) => hhmm(s.start_time) === d.start && hhmm(s.end_time) === d.end;

        // 1) точные совпадения
        const rest = [];
        for (const d of desired) {
          const hit = existing.find((s) => !used.has(s.id) && (d.free ? isFreeSlot(s) : s.employee_id === d.empId && s.status === "confirmed") && sameTime(s, d));
          if (hit) {
            used.add(hit.id);
            if (hit.source !== "sheet") { plan.updates.push(rowFrom(hit, { source: "sheet" })); touched.add(hit.id); plan.stats.adopt++; }
            else plan.stats.keep++;
          } else rest.push(d);
        }
        // 2) остальное — занимаем свободные слоты (сначала подходящие по времени), иначе создаём
        rest.sort((a, b) => (a.free ? 1 : 0) - (b.free ? 1 : 0));
        for (const d of rest) {
          const slots = existing.filter((s) => !used.has(s.id) && isFreeSlot(s));
          const slot = slots.find((s) => sameTime(s, d)) || slots[0];
          const patch = d.free
            ? { start_time: d.start, end_time: d.end, employee_id: null, status: "free", source: "sheet" }
            : { start_time: d.start, end_time: d.end, employee_id: d.empId, status: "confirmed", source: "sheet" };
          if (slot) {
            used.add(slot.id);
            plan.updates.push(rowFrom(slot, patch)); touched.add(slot.id);
            plan.stats.claimed++;
          } else {
            plan.inserts.push({
              pvz_id: pvz.id, shift_date: date, start_time: d.start, end_time: d.end,
              employee_id: d.free ? null : d.empId, status: d.free ? "free" : "confirmed",
              custom_amount: null, source: "sheet",
            });
            plan.stats.inserted++;
          }
        }
        // 3) то, что осталось в приложении, а в таблице нет
        for (const s of existing) {
          if (used.has(s.id)) continue;
          if (s.status === "pending") { plan.pendingKept.push({ block: blk.title, date }); continue; }
          if (s.source === "sheet") {
            if (unsafe) { plan.stats.freeKept++; continue; } // в этот день есть непонятные записи — ничего не удаляем
            plan.deletes.push(s.id); plan.stats.deleted++; continue;
          }
          if (s.employee_id) {
            plan.manualExtra.push({ pvzId: pvz.id, block: blk.title, date, empId: s.employee_id, start: hhmm(s.start_time), end: hhmm(s.end_time) });
            continue;
          }
          // свободный слот без пометки: на нерабочем дне («:)») убираем, иначе оставляем для откликов
          if (noneDay && desired.length === 0 && !unsafe) { plan.deletes.push(s.id); plan.stats.deleted++; }
          else plan.stats.freeKept++;
        }
      }
    }
    plan.unmatchedNames = [...unmatched.values()].sort((a, b) => b.count - a.count);

    // ---- пересечения: один человек в двух местах одновременно ----
    const delSet = new Set(plan.deletes);
    const updMap = new Map(plan.updates.map((u) => [u.id, u]));
    const finalRows = [];
    for (const s of shifts) {
      if (delSet.has(s.id)) continue;
      const u = updMap.get(s.id);
      const r = u || s;
      if (r.employee_id) finalRows.push({ empId: r.employee_id, date: r.shift_date, start: hhmm(r.start_time), end: hhmm(r.end_time), pvzId: r.pvz_id, touched: !!u });
    }
    for (const i of plan.inserts) if (i.employee_id) finalRows.push({ empId: i.employee_id, date: i.shift_date, start: i.start_time, end: i.end_time, pvzId: i.pvz_id, touched: true });
    const byEmpDate = new Map();
    for (const f of finalRows) {
      const k = `${f.empId}|${f.date}`;
      if (!byEmpDate.has(k)) byEmpDate.set(k, []);
      byEmpDate.get(k).push(f);
    }
    for (const list of byEmpDate.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if ((a.touched || b.touched) && a.start < b.end && b.start < a.end) plan.conflicts.push({ empId: a.empId, date: a.date, a, b });
      }
    }
    plan.changeCount = plan.inserts.length + plan.updates.length + plan.deletes.length;
    return plan;
  }

  return { parseCell, parseWorkbook, buildPlan, pvzKey, normKey, MONTHS };
})();

if (typeof module !== "undefined") module.exports = SheetImport;
// для серверной функции (Deno): она подключает этот файл как обычный модуль
if (typeof module === "undefined" && typeof globalThis !== "undefined") globalThis.SheetImport = SheetImport;

// ===================== сама функция =====================
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const MAX_DELETES = 40; // больше за один запуск автоматически не удаляем — только вручную из приложения
const CHUNK = 150;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Кто вызвал: cron (секрет) или админ из приложения (его JWT).
// JWT проверяет сам PostgREST: спрашиваем у него auth_is_admin() с токеном вызывающего.
async function isAdminCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!auth || !apikey) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/auth_is_admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth, apikey },
      body: "{}",
    });
    return r.ok && (await r.json()) === true;
  } catch (_) {
    return false;
  }
}

// «сегодня» по Москве: год и месяц нужны, чтобы не трогать прошлые месяцы
function moscowNow() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function fetchAll(table: string, build: (q: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db.from(table).select("*")).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function downloadOnce(publicUrl: string): Promise<ArrayBuffer> {
  const api = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(publicUrl);
  const r1 = await fetch(api);
  if (!r1.ok) throw new Error(`Яндекс Диск не отдал ссылку на файл (HTTP ${r1.status}). Проверьте, что доступ по ссылке включён.`);
  const { href } = await r1.json();
  if (!href) throw new Error("Яндекс Диск не вернул адрес скачивания");
  const r2 = await fetch(href);
  if (!r2.ok) throw new Error(`Не удалось скачать файл (HTTP ${r2.status})`);
  return await r2.arrayBuffer();
}

// Яндекс Диск иногда отвечает 5xx на пару секунд: пробуем до 3 раз, и только потом сдаёмся
async function downloadXlsx(publicUrl: string): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try { return await downloadOnce(publicUrl); }
    catch (e) {
      lastErr = e;
      if (!/HTTP 5\d\d/.test(String((e as any)?.message ?? e))) throw e; // не временный сбой — повторять нет смысла
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function notifyAdmins(text: string) {
  const token = Deno.env.get("BOT_TOKEN");
  if (!token) return;
  const { data: admins } = await db.from("employees").select("tg_id").eq("is_admin", true).eq("is_active", true).gt("tg_id", 0);
  for (const a of admins || []) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: a.tg_id, text }),
      });
    } catch (_) { /* уведомление не критично */ }
  }
}

async function finish(status: string, message: string, alert: string | null, prevAlert: string | null) {
  await db.from("schedule_sync").update({
    last_run_at: new Date().toISOString(), last_status: status, last_message: message,
    last_alert: alert, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  // шлём админам только когда проблема новая или изменилась, а не каждые 10 минут
  if (alert && alert !== prevAlert) await notifyAdmins("📋 График из таблицы\n" + message);
  return json({ status, message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const secret = Deno.env.get("SYNC_SECRET");
  const byCron = !!secret && req.headers.get("x-sync-secret") === secret;
  // ручной запуск («Обновить сейчас»): только админ, работает даже при выключенном автоимпорте
  const manual = !byCron && (await isAdminCaller(req));
  if (!byCron && !manual) return json({ error: "forbidden" }, 403);

  const { data: cfg, error: cfgErr } = await db.from("schedule_sync").select("*").eq("id", 1).maybeSingle();
  if (cfgErr || !cfg) return json({ error: "нет строки настроек schedule_sync" }, 500);
  if (!cfg.url) return json({ status: "skipped", message: "ссылка на график не задана" });
  if (!manual && !cfg.enabled) return json({ status: "skipped", message: "автоимпорт выключен" });
  const prev: string | null = cfg.last_alert;

  try {
    const data = await downloadXlsx(cfg.url);

    // года в файле нет — берём тот, при котором числа совпадают с днями недели
    const now = moscowNow();
    let best: any = null;
    for (const y of [now.year, now.year + 1, now.year - 1]) {
      const parsed = SheetImport.parseWorkbook(XLSX, data, y);
      const errs = parsed.errors.length + parsed.blocks.reduce((n: number, b: any) => n + b.errors.length, 0);
      if (!best || errs < best.errs) best = { parsed, year: y, errs };
      if (errs === 0) break;
    }
    const { parsed, year } = best;
    if (parsed.errors.length) return await finish("error", "Не получилось прочитать файл: " + parsed.errors.join("; "), "parse:" + parsed.errors.join("|"), prev);

    // прошлые месяцы не трогаем; в файле должен быть текущий или следующий месяц
    const fileIdx = year * 12 + parsed.month, nowIdx = now.year * 12 + now.month;
    if (fileIdx < nowIdx || fileIdx > nowIdx + 1) {
      return await finish("skipped", `В файле ${parsed.monthName} ${year}: это не текущий и не следующий месяц, ничего не меняю.`, null, prev);
    }

    const mm = String(parsed.month).padStart(2, "0");
    const last = new Date(year, parsed.month, 0).getDate();
    const [pvzList, employees, shifts] = await Promise.all([
      fetchAll("pvz", (q) => q.eq("is_active", true)),
      fetchAll("employees", (q) => q),
      fetchAll("shifts", (q) => q.gte("shift_date", `${year}-${mm}-01`).lte("shift_date", `${year}-${mm}-${String(last).padStart(2, "0")}`)),
    ]);
    const plan = SheetImport.buildPlan({ parsed, year, month: parsed.month, pvzList, employees, shifts, mappings: { pvz: {}, emp: {} } });

    // 1) защита от «слишком много удалений за раз»
    if (plan.deletes.length > MAX_DELETES) {
      return await finish("attention", `Импорт остановлен: он удалил бы ${plan.deletes.length} смен за раз. Проверьте файл и примените вручную: Управление → Импорт графика.`, "del:" + plan.deletes.length, prev);
    }
    // 2) ошибки разметки блоков: сами блоки уже пропущены, остальное применяем

    // применяем
    for (let i = 0; i < plan.updates.length; i += CHUNK) {
      const { error } = await db.from("shifts").upsert(plan.updates.slice(i, i + CHUNK), { onConflict: "id" });
      if (error) throw error;
    }
    for (let i = 0; i < plan.inserts.length; i += CHUNK) {
      const { error } = await db.from("shifts").insert(plan.inserts.slice(i, i + CHUNK));
      if (error) throw error;
    }
    for (let i = 0; i < plan.deletes.length; i += CHUNK) {
      const { error } = await db.from("shifts").delete().in("id", plan.deletes.slice(i, i + CHUNK));
      if (error) throw error;
    }

    // что требует внимания человека
    const issues: string[] = [];
    if (plan.unmatchedPvz.length) issues.push("Не знаю, какой это ПВЗ: " + plan.unmatchedPvz.map((u: any) => u.title).join(", "));
    if (plan.unmatchedNames.length) issues.push("Не знаю, кто это: " + plan.unmatchedNames.map((u: any) => `${u.name} (${u.count})`).join(", "));
    if (plan.blockErrors.length) issues.push("Блоки с ошибками: " + plan.blockErrors.map((b: any) => b.title).join(", "));
    if (plan.cellErrors.length) issues.push("Непонятные ячейки: " + plan.cellErrors.slice(0, 5).map((c: any) => `${c.block} ${c.cell} «${c.raw}»`).join("; ") + (plan.cellErrors.length > 5 ? "…" : ""));
    if (plan.conflicts.length) issues.push(`Один человек в двух местах сразу: ${plan.conflicts.length}`);
    const summary = `${parsed.monthName} ${year}: создано ${plan.inserts.length}, обновлено ${plan.updates.length}, удалено ${plan.deletes.length}.`;

    if (issues.length) {
      const text = summary + "\n" + issues.join("\n") + "\nСопоставьте имена и ПВЗ в приложении: Управление → Импорт графика.";
      return await finish("attention", text, "iss:" + issues.join("|"), prev);
    }
    return await finish("ok", summary, null, prev);
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    // временный сбой Яндекса (5xx): админам пишем, только если прошлый запуск тоже закончился ошибкой
    const transient = /HTTP 5\d\d/.test(msg);
    const alert = transient && cfg.last_status !== "error" ? null : "err:" + msg;
    return await finish("error", "Ошибка автоимпорта: " + msg, alert, prev);
  }
});
