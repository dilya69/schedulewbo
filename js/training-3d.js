/* Обучающая 3D-игра «Смена на ПВЗ».
   Подгружается из training.html только после проверки доступа.
   Урок 1: утро → дорога → дверь → поставка → приёмка в приложении. */
(function () {
  "use strict";

  /* ---------- мелочи ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmt = (m) => { m = Math.round(m); return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); };
  const TG = () => (window.Telegram && window.Telegram.WebApp) || null;
  const buzz = (kind) => { try { const h = TG() && TG().HapticFeedback; if (h) kind === "bad" ? h.notificationOccurred("error") : h.impactOccurred("light"); } catch (_) {} };

  /* ---------- данные урока ---------- */
  const POINTS = [
    { id: "yar", title: "Пушкино, Ярославское ш., 149к1" },
    { id: "nek", title: "Пушкино, 1-й Некрасовский пр., 6" },
    { id: "tur", title: "Пушкино, ул. Тургенева, 15" },
  ];
  const POINT_OK = POINTS[1];
  const COMMUTE = 40;

  const ITEMS = [
    { id: "dress", em: "👗", name: "Платье летнее миди, хлопок", brand: "Lume", art: "6120457", tag: "3104", code: "2000412380417", cell: 27, zone: "racks" },
    { id: "tee", em: "👕", name: "Футболка базовая оверсайз", brand: "Norda", art: "5198832", tag: "2215", code: "2000377120065", cell: 34, zone: "racks" },
    { id: "pillow", em: "🛏️", name: "Подушка анатомическая 50×70", brand: "Sonnet", art: "7741056", tag: "9087", code: "2000551980213", cell: 426, zone: "top" },
    { id: "buds", em: "🎧", name: "Наушники беспроводные", brand: "Tonic", art: "4402719", tag: "6620", code: "2000298450771", cell: 807, zone: "pockets" },
    { id: "pencil", em: "✏️", name: "Карандаши чернографитные, 12 шт", brand: "Grafo", art: "3365120", tag: "1040", code: "2000610320148", cell: 801, zone: "pockets" },
    { id: "kettle", em: "🫖", name: "Чайник электрический 1,7 л", brand: "Kuhne", art: "8820643", tag: "7712", code: "2000610320155", cell: 801, zone: "container", tape: "container", note: "Из того же заказа, что и карандаши. Габариты не позволяют положить его в кармашек." },
    { id: "org", em: "🧺", name: "Органайзер для хранения, 3 шт", brand: "Domus", art: "5530981", tag: "4418", code: "2000463310982", cell: 703, zone: "hall" },
    { id: "sweat", em: "🧶", name: "Свитшот оверсайз, графит", brand: "Norda", art: "6014477", tag: "3350", code: "2000702260334", cell: 31, zone: "racks", defect: true, note: "На рукаве видна затяжка и пятно. Это брак." },
    { id: "micro", em: "micro", name: "Микроволновая печь 20 л", brand: "Kuhne", art: "9012235", tag: "5071", code: "2000840110906", cell: 150, zone: "desk", tape: "desk", big: true, note: "Габаритный товар в большой коробке." },
  ];

  const ZONES = {
    racks: { e: "🗄️", t: "Стеллажи 1–300", s: "у стен и в центре, по 5 полок" },
    top: { e: "⬆️", t: "Верхние полки 301+", s: "самая верхняя доска стеллажа" },
    pockets: { e: "🧺", t: "Кармашки 800-е", s: "тканевые, у стеллажа" },
    hall: { e: "🪑", t: "Зал: ячейки 700-е", s: "у рабочего стола, с твоей стороны" },
    container: { e: "📥", t: "Контейнер под кармашками", s: "для того, что не влезает в кармашек" },
    desk: { e: "📍", t: "Справа от стола", s: "место для габаритных товаров" },
  };

  const NOTES = {
    time: ["Время", "Работа начинается в 9:00, а для клиентов пункт открывается в 10:00. Приезжай к 9: за этот час нужно сделать все дела. Всегда рассчитывай своё время и не опаздывай."],
    key: ["Как попасть на пункт", "Заранее продумай, как будешь открываться: ключ, замок, кто может помочь. Сделай это до смены, а не у закрытой двери."],
    ship: ["Сколько поставки ждёт", "Перед началом смены можно посмотреть, сколько поставок тебя ждёт: «Ещё» → «Пункт выдачи» → «Поставки» → «Отгрузки»."],
    stack: ["Коробки на складе", "Коробки переносим на склад и кладём по три штуки друг на друга."],
    point: ["Проверь пункт в приложении", "Перед приёмкой посмотри адрес пункта вверху экрана. Если вошёл не на тот, перезайди: «Ещё» → «Пункт выдачи» → нужный пункт → «Выбрать»."],
    sticker: ["Что сканируем", "Сканируем только розовый стикер с ШК на самом товаре: он уникальный у каждого товара. Стикер на большой коробке не сканируем."],
    cells: ["Нумерация ячеек", "1–300: стеллажи у стен и в центре, внутри стеллажа номера идут сверху вниз. С 301: самые верхние полки. 700-е: в зале у рабочего стола, с твоей стороны. 800-е: тканевые кармашки."],
    pocket: ["Кармашки 800-е", "Маленькие товары кладём в кармашки, чтобы они не потерялись."],
    tape: ["Большой товар из заказа с мелочью", "Если часть заказа не влезает в кармашек, подпиши товар малярным скотчем с номером ячейки (например, 801) и положи в контейнер под кармашками."],
    big: ["Габаритные товары", "Габарит, например микроволновку, сканируем по ШК и принимаем, потом ставим справа от стола и подписываем малярным скотчем так, чтобы надпись было видно."],
    brak: ["Брак", "Осматривай товар. Если есть брак, отметь его галочкой «Брак» в карточке товара."],
    done: ["Конец приёмки", "Приложение не пришлёт уведомление, что приёмка завершена. Проверяй сам: на столе не должно остаться неразобранных товаров."],
  };

  /* ---------- состояние ---------- */
  let S, P, busy;
  function resetState() {
    S = { score: 100, clock: 7 * 60, notes: [], mistakes: [], key: false, phone: false, arrival: 0, shipSeen: false, blindScan: false, cellMiss: false, placed: 0 };
    P = { screen: "accept", point: "yar", sel: null, tray: ITEMS.slice(), done: [], cur: null, brak: false, placed: true, menu: false, counts: {}, voice: true, decoyAt: 2 };
    busy = false;
  }

  /* ---------- интерфейс игры ---------- */
  let stage;
  function hud() {
    $("#clock").textContent = fmt(S.clock);
    const c = $("#chip-clock");
    c.classList.toggle("warn", S.clock >= 9 * 60 + 45 && S.clock < 10 * 60);
    c.classList.toggle("late", S.clock >= 10 * 60);
    $("#score").textContent = S.score;
    $("#notes-count").textContent = S.notes.length;
  }
  const tick = (m) => { S.clock += m; hud(); };
  const setStep = (t) => { $("#chip-step").textContent = t; };

  function toast(msg, tone) {
    const t = el("div", "toast " + (tone || ""), msg);
    const box = $("#toasts");
    while (box.children.length >= 2) box.firstElementChild.remove();
    box.append(t);
    setTimeout(() => t.remove(), 4200);
  }
  function floatText(txt) {
    const r = $("#score").getBoundingClientRect();
    const f = el("div", "float", txt);
    f.style.left = r.left + "px"; f.style.top = r.bottom + 4 + "px";
    document.body.append(f);
    setTimeout(() => f.remove(), 1100);
  }
  function card({ tone = "info", title, text, pen, btn = "Понятно" }) {
    return new Promise((res) => {
      const v = $("#veil");
      v.hidden = false;
      v.innerHTML = `<div class="card ${tone}" role="dialog"><h2>${title}</h2><p>${text}</p>${pen ? `<span class="pen">${pen}</span>` : ""}<div class="row-end"><button class="btn" id="card-ok" type="button">${btn}</button></div></div>`;
      $("#card-ok", v).onclick = () => { v.hidden = true; v.innerHTML = ""; res(); };
    });
  }
  async function oops(points, title, text, blocking = true) {
    S.score = Math.max(0, S.score - points);
    S.mistakes.push(title);
    hud(); floatText("−" + points); buzz("bad");
    const chip = $("#score").closest(".chip"); chip.classList.add("pop"); setTimeout(() => chip.classList.remove("pop"), 250);
    if (blocking) await card({ tone: "bad", title, text, pen: "−" + points + " очков" });
    else toast(`<b>${title}.</b> ${text}`, "bad");
  }
  function learn(id) {
    if (S.notes.includes(id)) return;
    S.notes.push(id);
    const [t, x] = NOTES[id];
    $("#notes-list").append(el("li", "fresh", `<b>${t}</b>${x}`));
    $("#notes-empty").hidden = true;
    hud();
    toast("📒 Новая заметка: " + t);
  }
  function scene(artHtml, opts = {}) {
    stage.className = "stage" + (opts.phone ? " phone-mode" : "");
    stage.innerHTML = (artHtml ? `<div class="art ${opts.artClass || ""}">${artHtml}</div>` : "") + `<div class="sheet" id="sheet"></div>`;
    return $("#sheet");
  }
  function narrate(sh, html, label = "Дальше", cls = "") {
    sh.innerHTML = `<div class="say ${cls}">${html}</div><div class="row-end"><button class="btn" id="nx" type="button">${label} →</button></div>`;
    return new Promise((r) => { $("#nx", sh).onclick = () => r(); });
  }
  function ask(sh, html, opts, cls = "") {
    sh.innerHTML = `<div class="say ${cls}">${html}</div><div class="opts"></div>`;
    const box = $(".opts", sh);
    return new Promise((res) => {
      opts.forEach((o) => {
        const b = el("button", "opt", `<b>${o.label}</b>${o.hint ? `<small>${o.hint}</small>` : ""}`);
        b.type = "button";
        b.onclick = () => res(o.value);
        box.append(b);
      });
    });
  }
  function checklist(sh, html, opts, label) {
    sh.innerHTML = `<div class="say">${html}</div><div class="opts"></div><div class="row-end"><button class="btn" id="cl-ok" type="button">${label}</button></div>`;
    const box = $(".opts", sh), on = new Set();
    opts.forEach((o) => {
      const b = el("button", "opt", `<span class="tick">✓</span><b>${o.label}</b>${o.hint ? `<small>${o.hint}</small>` : ""}`);
      b.type = "button";
      b.onclick = () => { on.has(o.value) ? on.delete(o.value) : on.add(o.value); b.classList.toggle("on", on.has(o.value)); };
      box.append(b);
    });
    return new Promise((res) => { $("#cl-ok", sh).onclick = () => res(on); });
  }

  /* ---------- звук и голос ---------- */
  let ac;
  function beep() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 1180; g.gain.value = 0.05; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.09); } catch (_) {}
  }
  const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const HUND = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  function words(n) {
    const h = Math.floor(n / 100), r = n % 100, p = [HUND[h]];
    if (r < 20) p.push(ONES[r]); else { p.push(TENS[Math.floor(r / 10)]); p.push(ONES[r % 10]); }
    return p.filter(Boolean).join(" ") || "ноль";
  }
  function speak(n) {
    if (!P.voice) return;
    try {
      const ss = window.speechSynthesis; if (!ss) return;
      ss.cancel();
      const u = new SpeechSynthesisUtterance("Ячейка " + words(n));
      u.lang = "ru-RU"; u.rate = 0.95;
      ss.speak(u);
    } catch (_) {}
  }


  /* ---------- телефон ---------- */
  const IC = {
    box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
    ppl: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.5-3.4 2.8-5 5.5-5s5 1.6 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.4 0 3.9 1.3 4.3 3.8"/></svg>',
    ret: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9.5h16M14 13.5H10m0 0l2-2m-2 2l2 2"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>',
  };
  const microSvg = '<svg viewBox="0 0 60 44" width="46" height="34"><rect x="2" y="4" width="56" height="36" rx="5" fill="#d9dbe3"/><rect x="8" y="10" width="32" height="24" rx="3" fill="#2b2d42"/><circle cx="49" cy="14" r="3" fill="#8f93a8"/><circle cx="49" cy="25" r="3" fill="#8f93a8"/></svg>';
  const emoji = (it) => (it.em === "micro" ? microSvg : it.em);
  const sticker = (code) => `<div class="sticker"><div class="top">ШК</div><div class="bars"></div><div class="dig">${code}</div></div>`;
  const pointTitle = () => POINTS.find((p) => p.id === P.point).title;

  function screenHtml() {
    const wrong = P.point !== "nek";
    const head = (title, sub, back) => `<div class="apphead">${back ? `<button class="back" data-a="back" type="button" aria-label="Назад">‹</button>` : ""}<h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    const bar = (label, dim) => `<div class="appbar"><button class="btnd" data-a="menu" type="button" aria-label="Меню">⋮</button><button class="btnp ${dim ? "dim" : ""}" data-a="${label === "Сканировать" ? "scan" : label === "Выбрать" ? "choose" : "refresh"}" type="button">${label === "Сканировать" ? "▥ " : ""}${label}</button></div>`;
    const nav = (on) => `<nav class="nav">${[["box", "Принять", 0], ["ppl", "Выдать", 1], ["ret", "Вернуть", 2], ["dots", "Ещё", 3]].map(([i, t, n]) => `<button class="${on === n ? "on" : ""}" data-a="nav${n}" type="button">${IC[i]}<span>${t}</span></button>`).join("")}</nav>`;
    let h = "";
    switch (P.screen) {
      case "accept":
        h = head("Принять", pointTitle()) + `<div class="appbody"><div class="empty-scan"><div class="qr">▥</div><h4>Отсканируйте товар<br>или QR курьера</h4><p>Если у товара отсутствует код, нажмите на 3 точки и далее на «Проблемы с QR»</p></div></div>` + bar("Сканировать") + nav(0);
        break;
      case "cam": {
        const tray = (S.unpacked ? P.tray : []).map((it, i) => {
          let out = `<button class="tcard" data-a="item" data-id="${it.id}" type="button"><span class="em">${emoji(it)}</span>${sticker(it.code)}<span class="nm">${it.name}</span></button>`;
          if (i === P.decoyAt) out = `<button class="tcard big" data-a="decoy" type="button"><span class="bigbox"><i></i></span><span class="nm">Большая коробка, стикер поставки</span></button>` + out;
          return out;
        }).join("");
        h = `<div class="apphead"><button class="back" data-a="back" type="button" aria-label="Назад">‹</button><h3>Принять</h3><span class="torch">🔦</span></div>
          <div class="appbody"><div class="cam"><div class="frame"><i></i><span class="scanline"></span></div><p>Наведите на QR</p></div>
          <div class="tray-title">${!S.unpacked ? "Товары пока в коробках. Занеси коробки на склад, и они окажутся на столе приёмки." : P.tray.length ? "На столе лежат товары. Нажми на стикер, чтобы отсканировать." : "На столе больше нет товаров."}</div>
          <div class="tray">${tray}</div></div>` + nav(0);
        break;
      }
      case "result": {
        const it = P.cur, n = P.counts[it.cell] || 1;
        const rows = P.done.map((d) => `<div class="drow"><div class="th">${emoji(d.item)}</div><div><div class="a">${d.item.art}<b>${d.item.tag}</b></div><div class="n">${d.item.name}${d.brak ? " · брак" : ""}</div></div><div class="c">▣ ${d.item.cell}<u>✎</u></div></div>`).join("");
        h = head("Принять", pointTitle()) + `<div class="appbody">
          <div class="cellno">${it.cell}</div>
          <div class="pills"><span class="pill pk"><button data-a="edit" type="button" aria-label="Изменить">✎</button><button data-a="voice" type="button" aria-label="Озвучка">${P.voice ? "🔊" : "🔇"}</button></span><span class="pill">ⓘ Поставки</span></div>
          <div class="okline">✓ Принят <span>• ${n} шт в ячейке</span></div>
          <div class="prod"><div class="thumb">${emoji(it)}</div><div><div class="art-no">${it.art}<b>${it.tag}</b></div><div class="nm">${it.name}</div><div class="br">${it.brand}</div>
            <button class="brak ${P.brak ? "on" : ""}" data-a="brak" type="button"><i>✓</i>Брак</button><div><button class="insp" data-a="inspect" type="button">🔍 Осмотреть товар</button></div></div></div>
          ${P.done.length ? `<div class="done-t">Уже приняли</div>${rows}` : ""}</div>` + bar("Сканировать", !P.placed) + nav(0);
        break;
      }
      case "more":
        h = head("Ещё") + `<div class="appbody"><div class="prof"><div class="av">👤</div><div><b>${(window.__TRAINING_USER__ || "Сотрудник").split(" ")[0]}</b><small>Сотрудник пункта</small></div></div><div class="mlist">
          <button class="mrow" data-a="point" type="button"><span class="ic">🏬</span><span class="t">Пункт выдачи<small>${pointTitle()}</small></span><span class="chev">›</span></button>
          ${[["✍️", "Написать в поддержку", "Проблема с программой"], ["📖", "Обучение", "Поможем разобраться в приложении"], ["💬", "Помощник", "Виртуальный ассистент и оператор"], ["▦", "Дополнительные функции", "Смена ячейки, поиск по ШК"], ["🧻", "Регистрация рулонов с наклейками", ""]].map(([i, t, s]) => `<button class="mrow" data-a="later" type="button"><span class="ic">${i}</span><span class="t">${t}${s ? `<small>${s}</small>` : ""}</span></button>`).join("")}
          </div></div>` + nav(3);
        break;
      case "point":
        h = head("Пункт выдачи", "", true) + `<div class="appbody"><div class="mlist">
          <button class="mrow sel" data-a="points" type="button"><span class="ic">🏬</span><span class="t">${pointTitle()}</span><span class="chev">›</span></button>
          <button class="mrow" data-a="later" type="button"><span class="ic">🏅</span><span class="t">Рейтинг ПВЗ</span><span class="chev">›</span></button>
          <button class="mrow" data-a="later" type="button"><span class="ic">🔓</span><span class="t">Электронный замок</span><span class="chev">›</span></button>
          <button class="mrow" data-a="later" type="button"><span class="ic">📊</span><span class="t">Статистика ПВЗ</span><span class="chev">›</span></button>
          <button class="mrow" data-a="ships" type="button"><span class="ic">🗃️</span><span class="t">Поставки</span><span class="chev">›</span></button>
          <button class="mrow" data-a="later" type="button"><span class="ic">🛒</span><span class="t">Склад</span><span class="chev">›</span></button></div></div>` + nav(3);
        break;
      case "points":
        h = head("Выбор пункта", "", true) + `<div class="appbody"><div class="mlist">${POINTS.map((p) => `<button class="mrow ${P.sel === p.id ? "sel" : ""}" data-a="pick" data-id="${p.id}" type="button"><span class="ic">🏬</span><span class="t">${p.title}${p.id === P.point ? "<small>Сейчас выбран</small>" : ""}</span></button>`).join("")}</div></div>` + bar("Выбрать", !P.sel) + nav(3);
        break;
      case "ships":
        h = head("Отгрузки", pointTitle(), true) + `<div class="appbody">
          ${[["Сегодня", "2 / 2", "23 / 23", "≈310 / ≈310"], ["Вчера", "3 / 3", "22 / 22", "≈390 / ≈390"], ["Позавчера", "3 / 3", "21 / 21", "≈340 / ≈340"]].map(([d, a, b, c]) => `<div class="ship"><h4>${d}</h4>
            <div class="l"><i>🚚</i><span>Отгрузки</span><em>${a.replace(/^(\d+)/, "<b>$1</b>")}</em></div><div class="l"><i>📦</i><span>Коробки</span><em>${b.replace(/^(\d+)/, "<b>$1</b>")}</em></div><div class="l"><i>🛍️</i><span>Товары</span><em>${c.replace(/^(≈\d+)/, "<b>$1</b>")}</em></div></div>`).join("")}
          <p style="color:#8c8c98;font-size:12.5px;text-align:center">Формат: доставлено / всего. Данные для урока условные.</p></div>` + bar("Обновить") + nav(3);
        break;
    }
    if (P.menu) {
      h += `<div class="scrim" data-a="menu-close"></div><div class="menu-sheet"><div class="grab"></div>${[["Принять снова", "Нет товаров"], ["Проблемы с QR", ""], ["DBS поставки", ""], ["FBW", ""], ["Печать наклеек для ячеек", ""], ["Быстрая приёмка", ""]].map(([t, s]) => `<button data-a="later" type="button"><span>${t}</span><small>${s}</small></button>`).join("")}</div>`;
    }
    return h;
  }

  function sheetText() {
    const left = P.tray.length;
    if (S.unpacked && !P.tray.length && P.placed && ["accept", "cam", "result"].includes(P.screen)) return `<div class="say">Последний товар лежит на месте. На столе больше ничего нет.</div><div class="row-end"><button class="btn" data-s="finish" type="button">Закончить приёмку →</button></div>`;
    if (P.screen === "accept") return `<div class="say">Приложение открыто. Проверь адрес пункта и начни приёмку. Твой пункт сегодня: <b>${POINT_OK.title}</b>.${P.point === "nek" ? "<small>Пункт выбран верно.</small>" : ""}</div>`;
    if (P.screen === "more") return `<div class="say">Раздел «Ещё». Здесь меняют пункт выдачи.</div>`;
    if (P.screen === "point") return `<div class="say">Адрес пункта вверху. Нажми на него, чтобы сменить. В «Поставках» видно, сколько всего ждёт.</div>`;
    if (P.screen === "points") return `<div class="say">Выбери пункт, на котором работаешь сегодня, и нажми «Выбрать».</div>`;
    if (P.screen === "ships") return `<div class="say">Здесь видно, сколько отгрузок, коробок и товаров ждёт. Смотри это перед началом смены, чтобы спланировать время.</div>`;
    if (P.screen === "cam" && !S.unpacked) return `<div class="say">Сканировать пока нечего: коробки ещё у входа. Сначала занеси их на склад.</div>`;
    if (P.screen === "cam") return left ? `<div class="say">Сканируем розовый стикер ШК на самом товаре. Осталось отсканировать: <b>${left}</b>.</div>` : `<div class="say">Всё отсканировано и разложено.</div><div class="row-end"><button class="btn" data-s="finish" type="button">Закончить приёмку →</button></div>`;
    if (P.screen === "result") {
      if (!P.placed) return `<div class="say">Приложение показало ячейку <b>${P.cur.cell}</b> и озвучило её. Можно осмотреть товар, а потом отнеси его в ячейку.</div><div class="row-end"><button class="btn" data-s="place" type="button">Взять товар и отнести в ячейку ${P.cur.cell} →</button></div>`;
      return left ? `<div class="say">Товар в ячейке. Сканируй следующий. Осталось: <b>${left}</b>.</div>` : `<div class="say">Последний товар лежит на месте. На столе больше ничего нет.</div><div class="row-end"><button class="btn" data-s="finish" type="button">Закончить приёмку →</button></div>`;
    }
    return "";
  }

  function renderPhone() {
    const root = $("#phone-screen"); if (!root) return;
    root.innerHTML = screenHtml();
    const body = $(".appbody", root); if (body) body.scrollTop = 0;
    const sh = $("#sheet"); if (sh) sh.innerHTML = sheetText();
  }

  function phoneArt() {
    return `<div class="phoneWrap"><div class="phone"><div class="screen"><span class="notch"></span><div id="phone-screen" style="display:flex;flex-direction:column;height:100%;position:relative"></div></div></div></div>`;
  }
  /* ---------- действия в телефоне ---------- */
  async function onPhoneAction(a, ds) {
    if (busy) return;
    switch (a) {
      case "back": P.screen = ({ points: "point", point: "more", ships: "point", cam: P.cur ? "result" : "accept" })[P.screen] || "accept"; break;
      case "nav0": P.screen = P.cur ? "result" : "accept"; break;
      case "nav3": P.screen = "more"; break;
      case "nav1": case "nav2": toast("Этот раздел будет в следующих уроках."); return;
      case "later": toast("В этом уроке это не нужно."); return;
      case "menu": P.menu = true; break;
      case "menu-close": P.menu = false; break;
      case "point": P.screen = "point"; break;
      case "points": P.screen = "points"; P.sel = null; break;
      case "pick": P.sel = ds.id; break;
      case "choose":
        if (!P.sel) return;
        P.point = P.sel; P.screen = "accept";
        if (P.point === "nek") { toast("Пункт выбран: " + pointTitle(), "good"); learn("point"); }
        else toast("Выбран другой пункт. Сверь адрес с тем, где ты работаешь сегодня.", "bad");
        break;
      case "ships": P.screen = "ships"; if (!S.shipSeen) { S.shipSeen = true; learn("ship"); } break;
      case "refresh": toast("Данные обновлены."); return;
      case "scan": if (P.cur && !P.placed) { toast("Сначала отнеси товар в ячейку."); return; } P.screen = "cam"; break;
      case "decoy":
        busy = true; tick(1);
        await oops(3, "Не тот стикер", "Стикер на большой коробке не сканируем. Сканируем только розовый стикер с ШК на самом товаре: он уникальный у каждого товара.");
        learn("sticker"); busy = false; return;
      case "item": {
        const it = P.tray.find((x) => x.id === ds.id); if (!it) return;
        busy = true; beep(); tick(1);
        if (P.point !== "nek") {
          if (!S.blindScan) {
            S.blindScan = true;
            await oops(15, "Стоп, это не твой пункт", `Ты начал принимать на пункте «${pointTitle()}», а работаешь на «${POINT_OK.title}». Товары принялись бы на чужой пункт, и всё пришлось бы переделывать. Перед приёмкой смотри адрес вверху экрана.`);
          } else toast("Пункт всё ещё не тот. Смени его в «Ещё» → «Пункт выдачи».", "bad");
          P.screen = "accept"; busy = false; renderPhone(); return;
        }
        P.tray = P.tray.filter((x) => x.id !== it.id);
        P.cur = it; P.brak = false; P.placed = false; P.screen = "result";
        P.counts[it.cell] = (P.counts[it.cell] || 0) + 1;
        learn("sticker");
        busy = false; renderPhone(); speak(it.cell); return;
      }
      case "voice": P.voice = !P.voice; if (P.voice) speak(P.cur.cell); break;
      case "edit": toast("Менять ячейку вручную в этом уроке не нужно."); return;
      case "brak": if (!P.placed) P.brak = !P.brak; break;
      case "inspect": {
        const it = P.cur; busy = true;
        await card({ tone: "info", title: `🔍 ${it.name}`, text: `<span style="font-size:52px;display:block;text-align:center;margin:6px 0">${emoji(it)}</span>${it.note || "Осмотр: упаковка целая, повреждений нет."}` });
        busy = false; return;
      }
    }
    renderPhone();
  }

  /* ================= 3D-МИР ================= */
  const R = { active: false, doorOpen: 0, doorTarget: 0, stage: "title", frozen: false, cut: false, hold: null, carried: [], pads: [0, 0, 0], moved: 0, placed: [], keyPlan: false, tasya: null, t: 0, keyShow: false };
  let E, cv, T = [], COLL = [], LB = {}, STK = {}, TAPE = {}, built = false, raf = 0, last = 0;
  const PAD = [[0.8, -9.6], [2.2, -9.6], [3.6, -9.6]];
  const BOXES = [0, 1, 2, 3, 4, 5].map((i) => [-5.6 + (i % 3) * 1.05, -1.4 - Math.floor(i / 3) * 1.0]);
  const TABLE = { x: -4.2, z: -9.6, y: 0.83 };
  const ICOL = { dress: [1, 0.5, 0.65], tee: [0.3, 0.75, 0.75], pillow: [0.85, 0.9, 1], buds: [0.25, 0.25, 0.3], pencil: [1, 0.85, 0.3], kettle: [0.7, 0.78, 0.9], org: [0.85, 0.7, 0.5], sweat: [0.35, 0.36, 0.42], micro: [0.82, 0.84, 0.88] };
  const isize = (it) => (it.big ? [0.52, 0.34, 0.42] : [0.3, 0.22, 0.26]);
  const band = (n) => (n <= 300 ? "racks" : n < 700 ? "top" : n < 800 ? "hall" : "pockets");
  const C = { w: [0.97, 0.96, 0.99], pink: [1, 0.36, 0.72], mag: [0.76, 0.09, 0.56], plum: [0.3, 0.12, 0.5], pur: [0.52, 0.28, 0.82], grey: [0.62, 0.64, 0.7], dg: [0.33, 0.35, 0.42], kr: [0.82, 0.62, 0.38], gl: [0.14, 0.17, 0.26], wood: [0.7, 0.5, 0.32], gr: [0.4, 0.72, 0.38], blue: [0.28, 0.38, 0.65], sky: [0.7, 0.85, 1] };
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function lab(txt, w, h, o) { const k = txt + "|" + w + "|" + h + (o && o.k || ""); return LB[k] || (LB[k] = E.label(txt, w, h, o || { bg: "#f7f4ea", fg: "#2a1740", border: "#bdb6a4" })); }

  function buildWorld() {
    E = new window.GL3D.Engine(cv);
    const L = E.light; L.fog = [0.72, 0.86, 1]; L.fogN = 40; L.fogF = 120; L.amb = 0.8; L.sunI = 0.4; L.sun = [0.4, 0.9, 0.5];
    E.repeatTex("floor", 128, (c, s) => { c.fillStyle = "#ebe8f1"; c.fillRect(0, 0, s, s); c.strokeStyle = "#cdc8d9"; c.lineWidth = 4; c.strokeRect(0, 0, s, s); c.fillStyle = "rgba(255,255,255,.4)"; c.fillRect(8, 8, 50, 50); });
    E.repeatTex("tile", 128, (c, s) => { c.fillStyle = "#d8cdb8"; c.fillRect(0, 0, s, s); c.strokeStyle = "#b9ad95"; c.lineWidth = 3; for (let i = 0; i < 2; i++) { c.strokeRect(0, i * 64, 128, 64); c.beginPath(); c.moveTo(i ? 32 : 96, i * 64); c.lineTo(i ? 32 : 96, i * 64 + 64); c.stroke(); } });
    E.repeatTex("brick", 128, (c, s) => { c.fillStyle = "#f0ece6"; c.fillRect(0, 0, s, s); c.strokeStyle = "#cfc7bb"; c.lineWidth = 3; for (let r = 0; r < 4; r++) { c.strokeRect(0, r * 32, 128, 32); for (let k = 0; k < 2; k++) { const x = (r % 2 ? 32 : 0) + k * 64; c.beginPath(); c.moveTo(x, r * 32); c.lineTo(x, r * 32 + 32); c.stroke(); } } });
    E.repeatTex("grass", 128, (c, s) => { c.fillStyle = "#79c26a"; c.fillRect(0, 0, s, s); for (let i = 0; i < 260; i++) { c.fillStyle = Math.random() < 0.5 ? "#6bb35c" : "#88cf78"; c.fillRect(Math.random() * s, Math.random() * s, 4, 4); } });
    const F = E.batch("flat"), FL = E.batch("floor"), TL = E.batch("tile"), BR = E.batch("brick"), GR = E.batch("grass"), AT = E.batch("atlas");
    const add = (b, x0, y0, z0, x1, y1, z1, col, o, collide) => { b.box(x0, y0, z0, x1, y1, z1, col, o); if (collide) COLL.push({ x0, z0, x1, z1 }); };

    /* земля */
    add(GR, -60, -0.3, -45, 60, 0, 70, C.w, { uv: 3, ao: 1, top: 1 });
    add(TL, -2.4, -0.3, -0.1, 2.4, 0.03, 54, C.w, { uv: 1.5, ao: 1, top: 1 });
    add(TL, -9, -0.3, 0, 9, 0.03, 4.5, C.w, { uv: 1.5, ao: 1, top: 1 });
    /* здание ПВЗ */
    add(FL, -7, -0.3, -20, 7, 0.02, -0.3, C.w, { uv: 1.2, ao: 1, top: 1 });
    add(BR, -7.3, 0, -0.3, -1.3, 3.6, 0, C.w, { uv: 2, ao: 1 }, true);
    add(BR, 1.3, 0, -0.3, 7.3, 3.6, 0, C.w, { uv: 2, ao: 1 }, true);
    add(BR, -1.3, 2.5, -0.3, 1.3, 3.6, 0, C.w, { uv: 2, ao: 1 });
    add(F, -7.3, 0, -0.36, -1.3, 3.6, -0.3, [1, 0.62, 0.84]); add(F, 1.3, 0, -0.36, 7.3, 3.6, -0.36 + 0.06, [1, 0.62, 0.84]); add(F, -1.3, 2.5, -0.36, 1.3, 3.6, -0.3, [1, 0.62, 0.84]);
    add(F, -7.3, 0, -20.3, -7, 3.6, 0, [0.95, 0.94, 0.98], {}, true); add(F, 7, 0, -20.3, 7.3, 3.6, 0, [0.95, 0.94, 0.98], {}, true);
    add(F, -7, 0, -20.3, 7, 3.6, -20, [0.93, 0.93, 0.97], {}, true);
    add(F, -7, 0, -8.3, 4, 3.6, -8, [1, 0.7, 0.88], {}, true); add(F, 6.5, 0, -8.3, 7, 3.6, -8, [1, 0.7, 0.88], {}, true); add(F, 4, 2.6, -8.3, 6.5, 3.6, -8, [1, 0.7, 0.88]);
    add(F, -7.3, 3.6, -20.3, 7.3, 3.9, 0, [0.4, 0.42, 0.5]);
    add(F, -7, 3.58, -20, 7, 3.62, -0.3, [0.99, 0.99, 1], { ao: 1 });
    COLL.push({ x0: -1.3, z0: -0.4, x1: 1.3, z1: 0.05, on: () => R.doorOpen < 0.5 });
    /* вывеска и часы у входа */
    add(F, -2.6, 3.0, 0, 2.6, 3.75, 0.18, C.mag);
    AT.label(0, 3.38, 0.19, 4.6, 0.62, "+z", lab("ПВЗ · пункт выдачи", 512, 70, { k: "sg", bg: "#e0309f", fg: "#fff" }));
    add(F, 2.2, 1.35, 0, 3.4, 2.55, 0.1, [1, 0.45, 0.78]);
    AT.label(2.8, 1.95, 0.11, 1.0, 1.0, "+z", lab("Часы работы\n10:00–21:00", 160, 160, { k: "hrs", bg: "#ff5cb8", fg: "#fff", fs: 21 }));
    /* дверь (рама) */
    add(F, -1.3, 0, 0, -1.2, 2.5, 0.12, C.dg); add(F, 1.2, 0, 0, 1.3, 2.5, 0.12, C.dg);
    /* стойка, ноутбук */
    add(F, -3, 0, -4.1, 3, 1.05, -3.4, C.w, { top: 1 }, true); add(F, -3.05, 1.05, -4.15, 3.05, 1.1, -3.35, C.plum);
    add(F, -1.4, 1.1, -3.95, -0.4, 1.12, -3.6, C.dg); add(F, -1.4, 1.12, -3.95, -0.4, 1.7, -3.9, C.dg); add(F, 0.6, 1.1, -3.85, 0.75, 1.3, -3.7, C.dg);
    add(F, -1.5, 0.45, -5.1, -0.9, 0.5, -4.5, C.plum); add(F, -1.5, 0.5, -5.1, -0.9, 1.0, -5.05, C.plum); add(F, 0.5, 0.45, -5.1, 1.1, 0.5, -4.5, C.plum); add(F, 0.5, 0.5, -5.1, 1.1, 1.0, -5.05, C.plum);
    /* примерочные */
    for (let i = 0; i < 3; i++) { const z0 = -1.2 - i * 1.7; add(F, -7, 0, z0 - 1.5, -5.7, 2.4, z0, [1, 0.62, 0.84], {}, true); add(F, -5.7, 0, z0 - 1.5, -5.6, 2.3, z0, C.pur); add(F, -6.95, 0.6, z0 - 1.2, -6.9, 1.9, z0 - 0.3, [0.85, 0.93, 1]); }
    /* ячейки 700-е: картонные соты на стене за стойкой */
    add(F, -6.6, 0.4, -8, -1.4, 2.4, -7.55, C.kr, { top: 1 }, true);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
      const n = 701 + r * 5 + c, x0 = -6.5 + c * 1.02, y0 = 0.5 + (1 - r) * 0.95; add(F, x0 + 0.06, y0, -7.58, x0 + 0.96, y0 + 0.8, -7.55, [0.45, 0.33, 0.2]);
      AT.label(x0 + 0.51, y0 + 0.88, -7.54, 0.5, 0.15, "+z", lab(String(n), 96, 30)); T.push({ kind: "cell", n, pos: [x0 + 0.51, y0 + 0.4, -7.6], r: 3.6 });
    }
    AT.label(-3.9, 2.75, -7.54, 2.2, 0.36, "+z", lab("700-е · зал", 256, 44, { k: "hall", bg: "#7a3fc6", fg: "#fff" }));
    AT.label(0, 2.9, -7.99, 4.6, 0.6, "+z", lab("Добро пожаловать!", 512, 68, { k: "wel", bg: "#ff5cb8", fg: "#fff" }));
    /* штора на входе на склад */
    add(F, 4, 0, -8.15, 4.6, 2.6, -8.05, C.pur); add(F, 5.9, 0, -8.15, 6.5, 2.6, -8.05, C.pur);
    /* зона габаритов справа от стола */
    add(F, 3.5, 0.0, -6.2, 5.0, 0.02, -4.9, [1, 0.88, 0.3], { ao: 1 }); T.push({ kind: "desk", pos: [4.25, 0.3, -5.55], r: 3.4 });
    AT.label(4.25, 0.9, -4.95, 1.4, 0.3, "+z", lab("Габариты", 192, 40, { k: "gab", bg: "#ffe45c", fg: "#3a2a00" }));
    add(F, 4.2, 0, -4.97, 4.3, 0.9, -4.9, C.dg);
    /* склад: стол приёмки */
    add(F, TABLE.x - 1.1, 0.78, TABLE.z - 0.45, TABLE.x + 1.1, 0.83, TABLE.z + 0.45, C.wood, {}, false);
    [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]].forEach(([a, b]) => add(F, TABLE.x + a - 0.04 * Math.sign(a) - 0.04, 0, TABLE.z + b - 0.04, TABLE.x + a + 0.04 - 0.04 * Math.sign(a), 0.78, TABLE.z + b + 0.04, C.dg));
    COLL.push({ x0: TABLE.x - 1.1, z0: TABLE.z - 0.45, x1: TABLE.x + 1.1, z1: TABLE.z + 0.45 });
    AT.label(TABLE.x, 1.9, TABLE.z - 0.5, 1.6, 0.3, "+z", lab("Стол приёмки", 224, 40, { k: "tbl", bg: "#4b1d7a", fg: "#fff" }));
    add(F, TABLE.x - 0.02, 1.2, TABLE.z - 0.55, TABLE.x + 0.02, 1.75, TABLE.z - 0.5, C.dg);
    /* площадки под стопки коробок */
    PAD.forEach(([x, z], i) => { add(F, x - 0.6, 0, z - 0.45, x + 0.6, 0.02, z + 0.45, [0.98, 0.8, 0.3], { ao: 1 }); AT.label(x, 0.03, z + 0.62, 0.5, 0.3, "+y", lab("Стопка " + (i + 1), 128, 40, { k: "pad", bg: "#ffe45c", fg: "#3a2a00" })); T.push({ kind: "pad", i, pos: [x, 0.6, z], r: 3.4, tol: 2 }); });

    /* стеллажи */
    const reserved = new Set([27, 34, 31, 426]);
    function rack(cx, cz, face, start, top, sign) {
      const A = { "+z": { ax: [1, 0], n: [0, 1] }, "-z": { ax: [-1, 0], n: [0, -1] }, "+x": { ax: [0, -1], n: [1, 0] }, "-x": { ax: [0, 1], n: [-1, 0] } }[face];
      const W = (u, v) => [cx + A.ax[0] * u + A.n[0] * v, cz + A.ax[1] * u + A.n[1] * v];
      const ab = (u0, u1, y0, y1, v0, v1, col) => { const p = W(u0, v0), q = W(u1, v1); F.box(Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), col); };
      const H = top ? 3.2 : 2.7, boards = top ? 7 : 6;
      [-1.6, 1.6].forEach((u) => { ab(u - 0.04, u + 0.04, 0, H, 0, 0.6, C.blue); });
      for (let k = 0; k < boards; k++) { const y0 = 0.15 + 0.5 * k; ab(-1.6, 1.6, y0, y0 + 0.04, 0, 0.6, C.grey); ab(-1.6, 1.6, y0 - 0.04, y0 + 0.1, 0.56, 0.6, [0.78, 0.8, 0.86]); }
      const p0 = W(-1.75, -0.05), p1 = W(1.75, 0.65); COLL.push({ x0: Math.min(p0[0], p1[0]), z0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), z1: Math.max(p0[1], p1[1]) });
      const cell = (n, i, k) => {
        const u = -1.2 + 0.8 * i, y0 = 0.15 + 0.5 * k, w = W(u, 0.606), c = W(u, 0.3);
        AT.label(w[0], y0 + 0.03, w[1], 0.5, 0.12, face, lab(String(n), 96, 26));
        T.push({ kind: "cell", n, pos: [c[0], y0 + 0.33, c[1]], r: 4 });
        if (!reserved.has(n) && rnd() < 0.5) { const h = 0.2 + rnd() * 0.22, cc = [[0.82, 0.62, 0.38], [0.95, 0.95, 0.98], [1, 0.55, 0.78], [0.55, 0.75, 1], [0.9, 0.85, 0.5]][Math.floor(rnd() * 5)]; ab(u - 0.3, u + 0.3, y0 + 0.04, y0 + 0.04 + h, 0.1, 0.5, cc); }
      };
      for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) cell(start + r * 4 + i, i, 4 - r);
      if (top) for (let i = 0; i < 4; i++) cell(top + i, i, 5);
      const sg = W(0, 0.62); AT.label(sg[0], top ? 3.4 : 2.95, sg[1], 1.3, 0.28, face, lab(sign, 192, 40, { k: "rs", bg: "#4b1d7a", fg: "#fff" }));
    }
    rack(-4.5, -19.95, "+z", 1, 421, "Стеллаж 1–20");
    rack(0, -19.95, "+z", 21, 425, "Стеллаж 21–40");
    rack(4.5, -19.95, "+z", 41, 429, "Стеллаж 41–60");
    rack(0, -13.75, "+z", 61, 0, "61–80"); rack(0, -13.65, "-z", 81, 0, "81–100");
    rack(-6.95, -10.2, "+x", 101, 0, "101–120"); rack(-6.95, -13.7, "+x", 121, 0, "121–140"); rack(-6.95, -17.2, "+x", 141, 0, "141–160");
    /* кармашки 800-е на торце стеллажа (тканевый органайзер) */
    {
      const cx = 6.95, cz = -13;
      F.box(cx - 0.05, 0.75, cz - 0.95, cx, 2.55, cz + 0.95, [0.5, 0.56, 0.7]); COLL.push({ x0: cx - 0.6, z0: cz - 1, x1: cx, z1: cz + 1 });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        const n = 801 + r * 3 + c, z = cz - 0.6 + c * 0.6, y = 2.3 - r * 0.42;
        F.box(cx - 0.2, y - 0.17, z - 0.24, cx - 0.04, y + 0.17, z + 0.24, [0.38, 0.45, 0.62]);
        AT.label(cx - 0.205, y + 0.02, z, 0.36, 0.12, "-x", lab(String(n), 96, 26));
        T.push({ kind: "cell", n, pos: [cx - 0.3, y, z], r: 3.8, tol: 0.8 });
      }
      AT.label(cx - 0.06, 2.75, cz, 1.7, 0.3, "-x", lab("800-е · кармашки", 256, 44, { k: "pk", bg: "#4b1d7a", fg: "#fff" }));
      F.box(cx - 0.95, 0.04, cz - 0.7, cx - 0.1, 0.5, cz + 0.7, [0.55, 0.58, 0.68]); F.box(cx - 0.9, 0.5, cz - 0.65, cx - 0.15, 0.52, cz + 0.65, [0.3, 0.32, 0.4]);
      COLL.push({ x0: cx - 0.95, z0: cz - 0.7, x1: cx - 0.1, z1: cz + 0.7 });
      AT.label(cx - 0.96, 0.28, cz, 1.0, 0.2, "-x", lab("Контейнер", 160, 32, { k: "ct", bg: "#d9dbe6", fg: "#2a1740" }));
      T.push({ kind: "container", pos: [cx - 0.5, 0.55, cz], r: 3.6, tol: 1.4 });
    }
    /* уличные детали */
    for (let i = 0; i < 7; i++) { const z = 8 + i * 6, s = i % 2 ? 1 : -1; tree(s * 4.6, z); tree(-s * 9.5, z + 3); }
    [[-6, 14, 11, 8, 5], [-6, 24, 11, 9, 6], [-6, 36, 11, 7, 7], [6, 12, 10, 9, 5], [6, 24, 9, 8, 6], [6, 38, 10, 10, 7]].forEach(([s, z, w, h, d], i) => { const x0 = s < 0 ? -9 - w : 9, col = [[1, 0.88, 0.8], [0.85, 0.92, 1], [0.95, 0.85, 1], [1, 0.95, 0.7]][i % 4]; add(F, x0, 0, z, x0 + w, h, z + d * 1.4, col, {}, true); for (let k = 0; k < 3; k++) add(F, s < 0 ? x0 + w : x0 - 0.05, 2 + (k % 2) * 3, z + 0.8 + k * 1.4, s < 0 ? x0 + w + 0.05 : x0, 3.2 + (k % 2) * 3, z + 1.8 + k * 1.4, C.gl); });
    add(F, -9 - 14, 0, -20, -7.3, 7, 0, [0.96, 0.86, 0.8], {}, true); add(F, 7.3, 0, -20, 22, 8, 0, [0.84, 0.9, 1], {}, true); add(F, -40, 0, -20, -23, 9, 0, [0.9, 0.85, 1], {}, true); add(F, 22, 0, -20, 40, 6, 0, [1, 0.95, 0.8], {}, true);
    /* дом героя и скамейки */
    add(F, -16, 0, 40, -7, 8, 54, [1, 0.8, 0.78], {}, true); add(F, -7.05, 0, 45, -6.95, 2.3, 47.4, C.wood);
    [[-3.2, 6], [3.2, 6], [-3.2, 18], [3.2, 28]].forEach(([x, z]) => { add(F, x - 0.9, 0.42, z - 0.25, x + 0.9, 0.5, z + 0.25, C.wood); add(F, x - 0.9, 0.5, z + 0.22, x + 0.9, 0.95, z + 0.28, C.wood); add(F, x - 0.8, 0, z - 0.2, x - 0.7, 0.42, z + 0.2, C.dg); add(F, x + 0.7, 0, z - 0.2, x + 0.8, 0.42, z + 0.2, C.dg); });
    [[-2.9, 3], [2.9, 3], [2.9, 22]].forEach(([x, z]) => add(F, x - 0.25, 0, z - 0.25, x + 0.25, 0.8, z + 0.25, C.dg, {}, true));
    [[-3, 10], [3, 10], [-3, 30], [3, 36]].forEach(([x, z]) => { add(F, x - 0.06, 0, z - 0.06, x + 0.06, 3.6, z + 0.06, C.dg); add(F, x - 0.25, 3.5, z - 0.25, x + 0.25, 3.7, z + 0.25, [1, 0.95, 0.7], { top: 1 }); });
    function tree(x, z) { add(F, x - 0.15, 0, z - 0.15, x + 0.15, 1.7, z + 0.15, [0.5, 0.35, 0.22], {}, true); add(F, x - 0.85, 1.5, z - 0.85, x + 0.85, 2.9, z + 0.85, C.gr); add(F, x - 0.55, 2.8, z - 0.55, x + 0.55, 3.8, z + 0.55, [0.34, 0.65, 0.34]); }
    /* внешние границы */
    COLL.push({ x0: -30, z0: 54, x1: 30, z1: 56 }, { x0: -30, z0: -30, x1: -29, z1: 56 }, { x0: 29, z0: -30, x1: 30, z1: 56 });

    /* двери (динамика) и подписи предметов */
    ITEMS.forEach((it) => { STK[it.id] = E.label("ШК\n" + it.tag, 80, 56, { bg: "#ff5cb8", fg: "#fff", fs: 20 }); if (it.tape) TAPE[it.id] = E.label(String(it.cell), 96, 48, { bg: "#f2ead2", fg: "#222", border: "#c9bf9a" }); });
    E.finalize(); built = true;

    /* цели, не зависящие от стройки */
    T.push({ kind: "door", pos: [0, 1.2, 0.15], r: 2.8, tol: 3, prompt: () => (!R.doorOpen && !R.doorTarget && R.stage !== "title" ? "Открыть дверь" : null), act: doorAct });
    T.push({ kind: "tasya", get pos() { return [R.tasya ? R.tasya.x : 0, 1.3, R.tasya ? R.tasya.z : 0]; }, r: 3.2, tol: 2.4, prompt: () => (R.tasya && R.tasya.talk && !S.key ? "Поговорить с Тасей" : null), act: tasyaAct });
    BOXES.forEach((b, i) => T.push({ kind: "box", i, pos: [b[0], 0.35, b[1]], r: 3, tol: 1.6, prompt: () => (!R.hold && !R.carried[i] && R.stage === "hall" ? "Взять коробку" : null), act: () => { R.hold = { box: true, i }; R.carried[i] = true; setGoal("Неси коробку на склад и поставь на площадку: максимум три друг на друга"); } }));
    T.forEach((t) => {
      if (t.prompt) return;
      if (t.kind === "pad") { t.prompt = () => (R.hold && R.hold.box ? "Поставить коробку" : null); t.act = () => padAct(t.i); }
      else if (t.kind === "cell") { t.prompt = () => (R.hold && R.hold.item ? "Положить в ячейку " + t.n : null); t.act = () => placeItem(t); }
      else { t.prompt = () => (R.hold && R.hold.item ? (t.kind === "desk" ? "Поставить справа от стола" : "Положить в контейнер") : null); t.act = () => placeItem(t); }
    });
  }

  /* ---------- состояние мира ---------- */
  const PL = { x: -1.2, z: 46, yaw: 0, pitch: 0, bob: 0 };
  function setGoal(t) { const g = $("#goal"); if (!t) { g.hidden = true; return; } g.hidden = false; g.innerHTML = "🎯 " + t; }
  const isFrozen = () => !$("#ov").hidden || !$("#dlg").hidden || R.cut || !!$("#veil").innerHTML;

  function say(html, o = {}) {
    return new Promise((res) => {
      const d = $("#dlg"); d.hidden = false;
      d.innerHTML = `${o.who ? `<span class="who ${o.who === "Тася" ? "tasya" : ""}">${o.who}</span>` : ""}<div class="say ${o.who === "Я" ? "thought" : ""}">${html}</div><div class="row-end"><button class="btn" type="button">${o.label || "Дальше"} →</button></div>`;
      d.querySelector("button").onclick = () => { d.hidden = true; d.innerHTML = ""; res(); };
    });
  }

  /* ---------- цели и действия ---------- */
  async function tasyaAct() {
    R.cut = true; const ta = R.tasya;
    await say("Привет! Ты как раз вовремя. Держи ключ от пункта, а то дверь закрыта.", { who: "Тася" });
    R.keyShow = true;
    await say("Не потеряй его! Хорошей смены, увидимся!", { who: "Тася", label: "Взять ключ" });
    R.keyShow = false; S.key = true; ta.talk = false; ta.wave = 3;
    toast("🔑 Ключ от пункта у тебя", "good");
    R.cut = false;
    await say("Спасибо, Тась! Теперь можно идти на пункт.", { who: "Я", label: "Идти" });
    setGoal("Иди к пункту: розовая вывеска впереди");
  }

  async function doorAct() {
    R.cut = false;
    if (S.key) {
      await say("«Хорошо, что я заранее подготовился и взял ключик у Таси, а то бы сейчас не попал на пункт».", { who: "Я" });
      R.doorTarget = 1; learn("key");
    } else {
      await say("Ты дёргаешь ручку, но дверь заперта. Ключ остался у Таси, а ты не договорился с ней заранее.", { who: "Я", label: "Позвонить Тасе" });
      S.keyLate = true; tick(35);
      await oops(20, "Ключа нет", "Ты потерял 35 минут: пока Тася привезла ключ, поставка стояла у двери. Заранее продумывай, как будешь открываться, и забирай ключ до смены.");
      R.cut = true;
      R.tasya = { x: 7, z: 12, yaw: 0, talk: false, wave: 0 };
      while (R.tasya.z > 2.2) { R.tasya.z -= 0.09; R.tasya.x += (1.1 - R.tasya.x) * 0.04; await sleep(16); }
      R.cut = false;
      await say("Прости, что задержалась! Вот ключ, пользуйся.", { who: "Тася", label: "Взять ключ" });
      S.key = true; toast("🔑 Ключ у тебя", "good");
      R.doorTarget = 1; learn("key");
    }
    setGoal("Заходи внутрь");
  }

  function padAct(i) {
    if (!R.hold || !R.hold.box) return;
    if (R.pads[i] >= 3) { oops(3, "Слишком высокая стопка", "Больше трёх коробок друг на друга не ставим: стопка может упасть, и неудобно доставать. Поставь в другое место.", false); tick(1); return; }
    R.pads[i]++; R.moved++; R.hold = null; tick(1);
    if (R.moved < 6) { setGoal(`Принеси остальные коробки: ${R.moved} из 6 на складе`); return; }
    learn("stack"); S.unpacked = true; S.stage = "accept"; R.stage = "accept";
    setGoal("Открой приложение (кнопка 📱 или клавиша P) и сканируй товары на столе приёмки");
    say("Все коробки на складе. Ты вскрыл их, и товары лежат на столе приёмки. Теперь достань телефон и открой приложение.", { who: "Я", label: "Достать телефон" }).then(() => openPhone());
  }

  /* ---------- размещение товара ---------- */
  async function placeItem(t) {
    if (!R.hold || !R.hold.item || busy) return;
    const it = R.hold.item; busy = true; tick(1);
    let ok = false, why = "", pts = 3, title = "Не то место";
    if (t.kind === "cell") {
      if (t.n === it.cell && band(t.n) === it.zone) ok = true;
      else if (it.zone === "container") why = t.n >= 801 && t.n <= 812 ? "Чайник не поместится в кармашек. Такой товар подписывают скотчем и кладут в контейнер под кармашками." : "Этот товар из заказа с мелочью и на полку не ложится: подпиши его скотчем и положи в контейнер под кармашками.";
      else if (it.zone === "desk") why = "Габаритный товар на полки не поставишь: он останется справа от стола, с подписью скотчем.";
      else if (band(t.n) !== it.zone) why = it.zone === "top" && band(t.n) === "racks" ? "Номера от 301 идут на самые верхние полки, а не на обычные." : it.zone === "racks" && band(t.n) === "top" ? `Номер ${it.cell} меньше 301: это обычная полка стеллажа, не верхняя.` : `Ячейка ${it.cell} находится не здесь. 1–300: стеллажи, с 301: верхние полки, 700-е: зал, 800-е: кармашки.`;
      else { pts = 2; title = "Другая ячейка"; why = `Это ${t.n}, а нужна ${it.cell}. Проверяй номер на полке.`; }
    } else if (it.tape === t.kind) ok = true;
    else why = it.zone === "desk" || it.zone === "container" ? "Тут не то место для этого товара. Контейнер под кармашками: для того, что не влезает в кармашек. Справа от стола: для габаритов." : "Это место для товаров, которые не влезают в ячейки, а наш товар обычный.";
    if (!ok) { S.cellMiss = true; await oops(pts, title, why, false); busy = false; return; }
    if (t.kind === "container" || t.kind === "desk") { const good = await tapeChoice(t.kind, it); if (!good) { busy = false; return; } }
    const tp = t.kind === "container" ? [t.pos[0], 0.58, t.pos[2]] : t.kind === "desk" ? [4.25, 0.17, -5.55] : [t.pos[0], t.pos[1] - 0.1, t.pos[2]];
    R.placed.push({ it, pos: tp });
    R.hold = null; P.placed = true; P.done.unshift({ item: it, brak: P.brak }); S.placed++; tick(2);
    if (it.zone === "pockets") learn("pocket");
    if (it.tape === "container") learn("tape");
    if (it.big) learn("big");
    if (S.placed === 1) learn("cells");
    toast(`Ячейка ${it.cell}: готово ✓`, "good"); buzz();
    setGoal(P.tray.length ? `Достань телефон и сканируй следующий товар. Осталось: ${P.tray.length}` : "Все товары разложены. Открой телефон и закончи приёмку");
    busy = false;
  }

  function tapeChoice(z, item) {
    return new Promise((resolve) => {
      const veil = $("#veil"); veil.hidden = false;
      const box = el("div", "wh"); veil.replaceChildren(box);
      const opts = z === "container"
        ? [[true, `Написать «${item.cell}»`, "номер ячейки, как показало приложение"], [false, "Написать «Чайник»", "название товара"], [false, "Не подписывать", "и так запомню"]]
        : [[true, "Скотч спереди, номер ячейки крупно", "чтобы надпись было видно"], [false, "Скотч сзади, надпись мелко", "чтобы не мешал"], [false, "Не подписывать", "и так запомню"]];
      box.innerHTML = `<h2>Подпись <span class="cellbadge">${item.cell}</span></h2><p class="sub">${z === "container" ? "Отрезаешь кусочек малярного скотча и клеишь на товар. Что пишешь?" : "Отрезаешь кусок малярного скотча. Как подписываешь габаритный товар?"}</p><div class="opts">${opts.map((o, i) => `<button class="opt" data-i="${i}" type="button"><b>${o[1]}</b><small>${o[2]}</small></button>`).join("")}</div>`;
      box.querySelectorAll(".opt").forEach((b) => b.onclick = async () => {
        tick(1);
        if (opts[+b.dataset.i][0]) { veil.hidden = true; veil.replaceChildren(); toast(z === "container" ? "Подписал и положил в контейнер под кармашками ✓" : "Поставил справа от стола и подписал ✓", "good"); return resolve(true); }
        S.cellMiss = true;
        await oops(3, "Так потеряется", z === "container" ? "Найти товар в контейнере можно только по номеру ячейки на скотче. Подпиши номер, который показало приложение." : "Надпись должна быть хорошо видна: иначе товар не найти, когда придёт клиент.", false);
      });
    });
  }

  /* ---------- телефон ---------- */
  function openPhone() {
    if (!R.active || !$("#ov").hidden || !$("#dlg").hidden) return;
    if (!S.doorSeen) { toast("Телефон пригодится на пункте."); return; }
    stage = $("#ov-stage");
    P.screen = P.cur && !P.placed ? "result" : "accept";
    const sh = scene(phoneArt(), { phone: true });
    showOv("phone"); renderPhone();
    if (!S.phone && !S.dead) {
      S.dead = true; busy = true;
      card({ tone: "bad", title: "Телефон разряжен", text: "Приёмка идёт в приложении, а телефон сел в самый неподходящий момент. Пришлось ставить на зарядку и ждать 15 минут. Заряжай телефон заранее.", pen: "−10 очков" }).then(() => { S.score = Math.max(0, S.score - 10); S.mistakes.push("Телефон разряжен"); tick(15); busy = false; });
    }
    return sh;
  }
  function closePhone() { $("#ov").hidden = true; $("#ov-x").hidden = true; stage = $("#ov-stage"); stage.innerHTML = ""; }
  function showOv(mode) { const o = $("#ov"); o.hidden = false; o.dataset.mode = mode; o.scrollTop = 0; $("#ov-x").hidden = mode !== "phone"; }

  async function onSheetAction(s) {
    if (busy) return;
    if (s === "place") {
      const it = P.cur; busy = true;
      if (it.defect && !P.brak) { await oops(5, "Брак без отметки", "У товара есть брак, а галочка «Брак» не стоит. Осматривай товар и отмечай брак в карточке, иначе он попадёт к клиенту. Поставь галочку и неси товар.");
        learn("brak"); busy = false; return; }
      if (!it.defect && P.brak) { await oops(3, "Лишняя отметка", "Товар целый, а отметка «Брак» стоит. Отмечай её только когда брак есть."); P.brak = false; busy = false; renderPhone(); return; }
      if (it.defect) learn("brak");
      busy = false; R.hold = { item: it }; closePhone();
      setGoal(`Отнеси товар в ячейку ${it.cell}. Номера написаны на наклейках на полках`);
    } else if (s === "finish") { closePhone(); endShift(); }
  }

  async function endShift() {
    R.cut = true; setGoal("");
    stage = $("#ov-stage"); let sh = scene(null); showOv("end");
    await narrate(sh, `<b>${fmt(S.clock)}.</b> Все товары разложены по местам.`, "Дальше");
    const ans = await ask(sh, "Приёмка закончена, но приложение ничего не показало: нет уведомления, что приёмка завершена. Как понять, что всё сделано?", [
      { value: "wait", label: "Подожду, пока приложение напишет, что приёмка завершена" },
      { value: "check", label: "Проверю сам: на столе не осталось неразобранных товаров" },
    ]);
    if (ans === "wait") await oops(5, "Уведомления не будет", "Приложение не сообщает о завершении приёмки. Проверяй сам: на столе не должно остаться товаров, все лежат в своих ячейках.");
    learn("done"); results();
  }

  function results() {
    setStep("Итоги");
    if (S.clock > 10 * 60) { S.score = Math.max(0, S.score - 10); S.mistakes.push("Не успел к 10:00"); }
    const sh = scene(null);
    const stars = S.score >= 85 ? 3 : S.score >= 60 ? 2 : 1, ok = S.clock <= 10 * 60;
    const badges = [
      [S.arrival <= 9 * 60, "Приехал к 9:00", "Опоздал: смена начинается в 9:00"],
      [S.key && !S.keyLate, "Заранее позаботился о ключе", "Не продумал, как попасть на пункт"],
      [!S.blindScan, "Проверил пункт перед приёмкой", "Начал принимать на чужом пункте"],
      [!S.cellMiss, "Ни одной ошибки с ячейками", "Были промахи с ячейками"],
      [ok, `Успел к открытию: ${fmt(S.clock)}`, `Закончил в ${fmt(S.clock)}, позже 10:00`],
    ];
    try { const best = +localStorage.getItem("pvz_training_best") || 0; if (S.score > best) localStorage.setItem("pvz_training_best", String(S.score)); } catch (_) {}
    sh.innerHTML = `<span class="tag">Итоги урока 1</span><h1>${ok ? "Пункт готов к открытию" : "Не успел к открытию"}</h1>
      <div class="res-stars">${"★".repeat(stars)}<span class="off">${"★".repeat(3 - stars)}</span></div>
      <p><b>${S.score}</b> очков из 100. Игровое время: ${fmt(S.clock)}.</p>
      <div class="badges">${badges.map(([g, y, n]) => `<div class="badge ${g ? "" : "no"}"><span>${g ? "✅" : "⚠️"}</span><span>${g ? y : n}</span></div>`).join("")}</div>
      ${S.mistakes.length ? `<p><b>Где были ошибки:</b></p><ul class="mist">${S.mistakes.map((m) => `<li>${m}</li>`).join("")}</ul>` : "<p>Без единой ошибки. Отличная смена!</p>"}
      <p class="hint">Все правила смены собраны в заметках.</p>
      <div class="row-end"><button class="btn ghost" id="again" type="button">Пройти ещё раз</button><button class="btn" id="close" type="button">Закрыть</button></div>`;
    $("#again", sh).onclick = () => window.startTraining();
    $("#close", sh).onclick = () => { try { TG() && TG().close(); } catch (_) {} };
  }

  /* ---------- управление ---------- */
  const K = {}; let joy = null, look = null;
  const touch = matchMedia("(pointer: coarse)").matches;
  function bindInput() {
    addEventListener("keydown", (e) => {
      if (!R.active) return;
      K[e.code] = true;
      const dlg = $("#dlg");
      if (["KeyE", "Space", "Enter"].includes(e.code)) {
        if (!dlg.hidden) dlg.querySelector("button").click();
        else if ($("#ov").hidden && !$("#veil").innerHTML) doAct();
        if (e.target === document.body || e.target === cv) e.preventDefault();
      }
      if (e.code === "KeyP") { if ($("#ov").dataset.mode === "phone" && !$("#ov").hidden) closePhone(); else openPhone(); }
      if (e.code === "Escape" && !$("#ov").hidden && $("#ov").dataset.mode === "phone") closePhone();
    });
    addEventListener("keyup", (e) => { K[e.code] = false; });
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      if (e.pointerType === "touch" && e.clientX - r.left < r.width * 0.45) { joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 }; const j = $("#joy"); j.hidden = false; j.style.left = e.clientX - r.left - 55 + "px"; j.style.top = e.clientY - r.top - 55 + "px"; $("#joy i").style.transform = ""; }
      else look = { id: e.pointerId, x: e.clientX, y: e.clientY, k: e.pointerType === "touch" ? 0.0058 : 0.0042 };
    });
    cv.addEventListener("pointermove", (e) => {
      if (joy && e.pointerId === joy.id) { joy.x = Math.max(-1, Math.min(1, (e.clientX - joy.x0) / 50)); joy.y = Math.max(-1, Math.min(1, (e.clientY - joy.y0) / 50)); $("#joy i").style.transform = `translate(${joy.x * 34}px,${joy.y * 34}px)`; }
      else if (look && e.pointerId === look.id) { PL.yaw += (e.clientX - look.x) * look.k; PL.pitch = Math.max(-1.2, Math.min(1.2, PL.pitch - (e.clientY - look.y) * look.k)); look.x = e.clientX; look.y = e.clientY; }
    });
    const up = (e) => { if (joy && e.pointerId === joy.id) { joy = null; $("#joy").hidden = true; } if (look && e.pointerId === look.id) look = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    $("#ctx").addEventListener("click", () => doAct());
    $("#phone-btn").addEventListener("click", () => ($("#ov").dataset.mode === "phone" && !$("#ov").hidden ? closePhone() : openPhone()));
    $("#ov-x").addEventListener("click", closePhone);
    $("#ov-stage").addEventListener("click", (e) => {
      const m = $("#ov").dataset.mode; if (m !== "phone") return;
      const a = e.target.closest("[data-a]"); if (a) return onPhoneAction(a.dataset.a, a.dataset);
      const s = e.target.closest("[data-s]"); if (s) onSheetAction(s.dataset.s);
    });
  }

  let focus = null;
  function pickFocus() {
    const c = E.cam, e = c.pos, cp = Math.cos(c.pitch), f = [Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp];
    let best = null, ba = 9;
    for (const t of T) {
      const pr = t.prompt(); if (!pr) continue;
      const p = t.pos, dx = p[0] - e[0], dy = p[1] - e[1], dz = p[2] - e[2], d = Math.hypot(dx, dy, dz);
      if (d > (t.r || 3.4)) continue;
      const a = Math.acos(Math.min(1, (dx * f[0] + dy * f[1] + dz * f[2]) / d)), tol = Math.max(0.16, Math.atan(0.42 / Math.max(d, 0.5))) * (t.tol || 1);
      if (a < tol && a < ba) { ba = a; best = { t, pr }; }
    }
    return best;
  }
  function doAct() { if (isFrozen() || !focus) return; const a = focus.t.act; if (a) a(); }

  function blocked(x, z) {
    for (const c of COLL) { if (c.on && !c.on()) continue; if (x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3) return true; }
    return false;
  }

  function update(dt) {
    R.t += dt;
    const fr = isFrozen();
    if (!fr) {
      let ix = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0), iz = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
      if (K.ArrowLeft || K.ArrowRight) { PL.yaw += ((K.ArrowRight ? 1 : 0) - (K.ArrowLeft ? 1 : 0)) * 1.8 * dt; ix = 0; }
      if (joy) { ix += joy.x; iz -= joy.y; }
      const m = Math.hypot(ix, iz); if (m > 1) { ix /= m; iz /= m; }
      const sp = (K.ShiftLeft ? 5.2 : 3.4) * dt, s = Math.sin(PL.yaw), c = Math.cos(PL.yaw);
      const dx = (s * iz + c * ix) * sp, dz = (-c * iz + s * ix) * sp;
      if (!blocked(PL.x + dx, PL.z)) PL.x += dx;
      if (!blocked(PL.x, PL.z + dz)) PL.z += dz;
      if (m > 0.05) PL.bob += dt * 8;
    }
    /* время идёт по мере хода к пункту */
    if (R.stage === "street" && !fr) {
      const p = Math.max(0, Math.min(1, (46 - PL.z) / 43));
      S.clock = Math.max(S.clock, S.leave + COMMUTE * p); hud();
      if (PL.z < 4.2) arrive();
    }
    if (R.stage === "door" && PL.z < -0.8) enterHall();
    R.doorOpen += (R.doorTarget - R.doorOpen) * Math.min(1, dt * 4);
    if (R.doorTarget && !S.doorSeen) S.doorSeen = true;
    const t = R.tasya; if (t) { const dx = PL.x - t.x, dz = PL.z - t.z; t.yaw = Math.atan2(dx, dz); if (t.wave > 0) t.wave -= dt; }
    focus = pickFocus();
    const cx = $("#ctx");
    if (focus && !fr) { if (cx.hidden || cx.dataset.t !== focus.pr) { cx.hidden = false; cx.dataset.t = focus.pr; cx.innerHTML = `<span class="k">${touch ? "👆" : "E"}</span>${focus.pr}`; } } else if (!cx.hidden) { cx.hidden = true; cx.dataset.t = ""; }
  }

  async function arrive() {
    R.stage = "door"; S.arrival = S.clock; R.cut = true; setStep("Вход");
    if (S.arrival > 9 * 60) {
      await say(`<b>${fmt(S.clock)}.</b> Ты на месте, но рабочий день уже начался в 9:00. Поставка ждёт, а до открытия для клиентов остаётся всё меньше времени.`);
      await oops(15, "Опоздание", "Смена начинается в 9:00. За час до открытия нужно принять поставку и разложить товары. Если опоздал, то не успеешь, и клиенты будут ждать. Рассчитывай дорогу с запасом.");
    } else await say(`<b>${fmt(S.clock)}.</b> Ты на месте. ${S.arrival <= 8 * 60 + 30 ? "Пришёл заранее, и это здорово." : "Пришёл вовремя, но запаса почти нет."}`);
    R.cut = false; setGoal("Открой дверь пункта: подойди и нажми на неё");
  }
  async function enterHall() {
    R.stage = "hall"; setStep("Поставка"); R.cut = true;
    await say(`<b>${fmt(S.clock)}.</b> Ты внутри. Поставка уже приехала и ждёт, когда ты её примешь. Для начала нужно занести коробки на склад: он за фиолетовой шторой справа.`, { label: "К коробкам" });
    R.cut = false; setGoal("Возьми коробку у входа и неси на склад. Всего 6 коробок");
  }

  /* ---------- отрисовка ---------- */
  function drawGirl(x, z, yaw, o) {
    const c = Math.cos(yaw), s = Math.sin(yaw), P3 = (lx, y, lz) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    const sk = [1, 0.84, 0.72], hr = [0.22, 0.6, 1], tp = [1, 0.78, 0.9], jn = [0.3, 0.33, 0.58], sw = Math.sin(R.t * 2) * 0.01;
    E.drawBox(P3(-0.09, 0.4, 0), [0.14, 0.8, 0.16], yaw, jn); E.drawBox(P3(0.09, 0.4, 0), [0.14, 0.8, 0.16], yaw, jn);
    E.drawBox(P3(-0.09, 0.04, 0.04), [0.15, 0.08, 0.26], yaw, [0.97, 0.97, 1]); E.drawBox(P3(0.09, 0.04, 0.04), [0.15, 0.08, 0.26], yaw, [0.97, 0.97, 1]);
    E.drawBox(P3(0, 1.1 + sw, 0), [0.38, 0.5, 0.22], yaw, tp);
    E.drawBox(P3(-0.25, 1.08, 0), [0.1, 0.46, 0.12], yaw, tp);
    const wv = o.wave > 0 ? Math.sin(R.t * 10) * 0.2 : 0;
    E.drawBox(P3(0.25, 1.12 + (o.give ? 0.1 : 0) + Math.abs(wv), 0.05 + (o.give ? 0.12 : 0)), [0.1, 0.46, 0.12], yaw, tp);
    E.drawBox(P3(-0.25, 0.8, 0), [0.09, 0.09, 0.09], yaw, sk);
    E.drawBox(P3(0, 1.52 + sw, 0), [0.3, 0.3, 0.3], yaw, sk);
    E.drawBox(P3(0, 1.62 + sw, -0.02), [0.35, 0.2, 0.34], yaw, hr);
    E.drawBox(P3(0, 1.38 + sw, -0.14), [0.36, 0.5, 0.1], yaw, hr);
    E.drawBox(P3(-0.17, 1.46 + sw, -0.02), [0.06, 0.34, 0.3], yaw, hr); E.drawBox(P3(0.17, 1.46 + sw, -0.02), [0.06, 0.34, 0.3], yaw, hr);
    E.drawBox(P3(0, 1.67 + sw, 0.15), [0.3, 0.07, 0.04], yaw, hr);
    E.drawBox(P3(-0.07, 1.52 + sw, 0.155), [0.04, 0.05, 0.02], yaw, [0.15, 0.1, 0.25]); E.drawBox(P3(0.07, 1.52 + sw, 0.155), [0.04, 0.05, 0.02], yaw, [0.15, 0.1, 0.25]);
    E.drawBox(P3(0, 1.44 + sw, 0.155), [0.06, 0.02, 0.02], yaw, [0.9, 0.4, 0.5]);
    if (o.key) E.drawBox(P3(0.25, 1.15, 0.3), [0.06, 0.03, 0.14], yaw, [1, 0.85, 0.2], { unlit: true });
  }

  function render() {
    const cam = E.cam, bob = Math.sin(PL.bob) * 0.03;
    cam.pos = [PL.x, 1.6 + bob, PL.z]; cam.yaw = PL.yaw; cam.pitch = PL.pitch;
    E.begin(R.stage === "title" ? [0.72, 0.86, 1] : [0.72, 0.86, 1]);
    E.drawStatic();
    const a = R.doorOpen * 1.75, dc = Math.cos(a), ds = Math.sin(a);
    E.drawBox([1.2 - 0.55 * dc, 1.15, -0.1 + 0.55 * ds], [1.1, 2.3, 0.06], a, C.gl, { alpha: 0.82 });
    E.drawBox([-1.2 + 0.55 * dc, 1.15, -0.1 + 0.55 * ds], [1.1, 2.3, 0.06], -a, C.gl, { alpha: 0.82 });
    BOXES.forEach((b, i) => { if (R.carried[i]) return; E.drawBox([b[0], 0.28, b[1]], [0.9, 0.56, 0.6], 0, C.kr); E.drawBox([b[0], 0.565, b[1]], [0.14, 0.01, 0.62], 0, [0.95, 0.9, 0.75]); });
    PAD.forEach(([x, z], i) => { for (let k = 0; k < R.pads[i]; k++) { E.drawBox([x, 0.26 + 0.5 * k, z], [0.9, 0.48, 0.6], 0, C.kr); E.drawBox([x, 0.505 + 0.5 * k, z], [0.14, 0.01, 0.62], 0, [0.95, 0.9, 0.75]); } });
    if (S.unpacked) ITEMS.forEach((it, i) => {
      if (!P.tray.includes(it)) return;
      const sz = isize(it), x = TABLE.x - 0.6 + (i % 3) * 0.6, z = TABLE.z - 0.28 + Math.floor(i / 3) * 0.28;
      E.drawBox([x, TABLE.y + sz[1] / 2, z], sz, 0, ICOL[it.id]); E.drawLabel([x, TABLE.y + sz[1] * 0.6, z + sz[2] / 2 + 0.004], [0.13, 0.09], 0, STK[it.id]);
    });
    R.placed.forEach(({ it, pos }) => { const sz = isize(it); E.drawBox(pos, sz, 0, ICOL[it.id]); if (TAPE[it.id]) E.drawLabel([pos[0], pos[1] + sz[1] * 0.1, pos[2] + sz[2] / 2 + 0.004], [0.2, 0.1], 0, TAPE[it.id]); });
    const t = R.tasya; if (t) drawGirl(t.x, t.z, t.yaw, { key: R.keyShow, wave: t.wave, give: R.keyShow });
    /* предмет в руках */
    E.beginHeld();
    const h = R.hold, sw = Math.sin(PL.bob) * 0.012;
    if (h && h.box) { E.drawBox([0.25, -0.42 + sw, -1.2], [0.6, 0.36, 0.42], 0.3, C.kr); E.drawBox([0.25, -0.238 + sw, -1.2], [0.1, 0.01, 0.44], 0.3, [0.95, 0.9, 0.75]); }
    else if (h && h.item) { const sz = isize(h.item), k = h.item.big ? 0.75 : 0.95; E.drawBox([0.2, -0.3 + sw, -0.95], [sz[0] * k, sz[1] * k, sz[2] * k], 0.35, ICOL[h.item.id]); E.drawLabel([0.2 - 0.04, -0.28 + sw, -0.95 + sz[2] * k * 0.5 + 0.002], [0.16, 0.11], 0.35, STK[h.item.id]); }
    if (TG() && false) return;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!R.active) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
    update(dt); render();
  }

  async function initEngine() {
    if (built) return true;
    try { await Promise.race([document.fonts.load('700 24px Onest'), sleep(1200)]); } catch (_) {}
    cv = $("#cv");
    try { buildWorld(); } catch (e) { console.error(e); return false; }
    bindInput();
    raf = requestAnimationFrame(frame);
    return true;
  }

  /* ---------- сценарий ---------- */
  async function intro() {
    stage = $("#ov-stage"); setStep("Старт"); setGoal("");
    let sh = scene(null); showOv("intro");
    sh.innerHTML = `<span class="tag">Обучение · урок 1</span><h1>Смена на ПВЗ</h1>
      <p>Ты ходишь по настоящему пункту выдачи: идёшь на работу, открываешь дверь, заносишь коробки на склад и принимаешь товары. Решай, как на настоящей смене. За ошибки снимаются очки, а правила, которые ты узнаёшь, попадают в заметки.</p>
      <p class="hint">${touch ? "Левый палец по экрану: идти. Правый: смотреть. Кнопка внизу: действие." : "WASD: идти. Зажми мышь и двигай: смотреть. E: действие. P: телефон."}</p>
      <div class="row-end"><button class="btn" id="go" type="button">Начать смену →</button></div>`;
    await new Promise((r) => { $("#go", sh).onclick = () => r(); });
    S.clock = 7 * 60; hud(); setStep("Утро");
    await narrate(sh, `<b>07:00.</b> Звонит будильник. Сегодня твоя смена на пункте <b>${POINT_OK.title}</b>.<br><br>Работа начинается в <b>9:00</b>, а для клиентов пункт откроется в <b>10:00</b>. Этот час нужен, чтобы принять поставку и всё подготовить, поэтому приехать нужно к девяти.`, "Встаю");
    learn("time");
    const picked = await checklist(sh, "Собираешься на работу. Что нужно сделать до выхода? <small>Отметь всё, что считаешь нужным.</small>", [
      { value: "key", label: "Договориться с Тасей и забрать у неё ключ от пункта", hint: "Дверь на пункте закрыта, ключ у Таси" },
      { value: "phone", label: "Зарядить телефон", hint: "Приёмка идёт в приложении" },
      { value: "thermos", label: "Взять термос с чаем" },
      { value: "music", label: "Выбрать плейлист в дорогу" },
    ], "Готово");
    S.keyPlan = picked.has("key"); S.phone = picked.has("phone");
    const leave = await ask(sh, `Дорога до пункта занимает около <b>${COMMUTE} минут</b>. Во сколько выходишь из дома?`, [
      { value: 7 * 60 + 45, label: "В 7:45", hint: "приеду в 8:25, с запасом" },
      { value: 8 * 60 + 15, label: "В 8:15", hint: "приеду в 8:55, как раз к началу" },
      { value: 8 * 60 + 40, label: "В 8:40", hint: "приеду в 9:20" },
    ]);
    S.leave = leave; S.clock = leave; hud();
    hideOv();
  }

  function hideOv() { $("#ov").hidden = true; $("#ov-x").hidden = true; }

  window.startTraining = async function () {
    resetState(); S.leave = 7 * 60; S.unpacked = false; S.doorSeen = false; S.dead = false; S.keyPlan = false;
    Object.assign(R, { active: false, doorOpen: 0, doorTarget: 0, stage: "title", cut: false, hold: null, carried: [], pads: [0, 0, 0], moved: 0, placed: [], tasya: null, keyShow: false });
    Object.assign(PL, { x: -1.2, z: 46, yaw: 0, pitch: 0, bob: 0 });
    $("#notes-list").innerHTML = ""; $("#notes-empty").hidden = false;
    $("#veil").hidden = true; $("#veil").innerHTML = ""; $("#dlg").hidden = true;
    hud();
    const nt = $("#notes"), tgl = $("#notes-toggle"), cls = $("#notes-close");
    tgl.onclick = () => nt.classList.toggle("open"); cls.onclick = () => nt.classList.remove("open");
    const ok = await initEngine();
    if (!ok) { toast("Не удалось запустить 3D. Открой обучение в другом браузере.", "bad"); return; }
    P.tray = ITEMS.slice();
    R.active = true; last = performance.now();
    $("#phone-btn").hidden = false;
    try {
      await intro();
      S.arrival = 0; R.stage = "street";
      if (S.keyPlan) R.tasya = { x: 2.7, z: 24, yaw: 0, talk: true, wave: 2 };
      setStep("Дорога");
      setGoal(S.keyPlan ? "Иди по дорожке к пункту. По пути тебя ждёт Тася" : "Иди по дорожке к пункту");
      $("#help").hidden = false; setTimeout(() => { $("#help").hidden = true; }, 9000);
    } catch (e) { console.error(e); toast("Что-то пошло не так. Открой обучение ещё раз.", "bad"); }
  };
  window.__T = { R, PL, get S() { return S; }, get P() { return P; }, T, get focus() { return focus; }, act: () => doAct(), openPhone, closePhone, onPhoneAction: (a, d) => onPhoneAction(a, d || {}), onSheetAction };
})();
