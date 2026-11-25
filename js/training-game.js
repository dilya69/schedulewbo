/* Обучающая игра «Смена на ПВЗ».
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
    $("#toasts").append(t);
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
    stage.innerHTML = `<div class="art ${opts.artClass || ""}">${artHtml || ""}</div><div class="sheet" id="sheet"></div>`;
    window.scrollTo({ top: 0 });
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

  /* ---------- иллюстрации ---------- */
  const svg = (inner, defs = "") => `<svg viewBox="0 0 800 460" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>${inner}</svg>`;

  function artPoster() {
    return svg(`
      <rect width="800" height="460" fill="url(#pg)"/>
      <circle cx="660" cy="96" r="64" fill="#fff3c4" opacity=".9"/><circle cx="90" cy="380" r="120" fill="#ff8ac9" opacity=".35"/>
      <g transform="translate(120 150)">
        <rect x="0" y="150" width="230" height="86" rx="8" fill="#c99a63"/><rect x="100" y="150" width="30" height="86" fill="#f4dcb8" opacity=".7"/>
        <rect x="14" y="70" width="202" height="82" rx="8" fill="#d6aa72"/><rect x="100" y="70" width="30" height="82" fill="#f4dcb8" opacity=".7"/>
        <rect x="32" y="-6" width="166" height="78" rx="8" fill="#e0b87f"/><rect x="100" y="-6" width="30" height="78" fill="#f4dcb8" opacity=".7"/>
      </g>
      <g transform="translate(470 80) rotate(6)">
        <rect width="190" height="320" rx="30" fill="#101014"/><rect x="10" y="10" width="170" height="300" rx="22" fill="#1d1d24"/>
        <rect x="42" y="64" width="106" height="76" rx="10" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="22 14"/>
        <rect x="30" y="184" width="130" height="56" rx="8" fill="#fff"/><rect x="30" y="184" width="130" height="14" rx="4" fill="#ff2fb0"/>
        <path d="M40 206v26M46 206v26M52 206v26M62 206v26M68 206v26M80 206v26M86 206v26M98 206v26M104 206v26M118 206v26M126 206v26M140 206v26" stroke="#111" stroke-width="3"/>
        <rect x="30" y="262" width="130" height="32" rx="16" fill="#a53bff"/>
        <rect x="52" y="100" width="86" height="3" fill="#ff5cb8"><animate attributeName="y" values="74;130;74" dur="1.6s" repeatCount="indefinite"/></rect>
      </g>`,
      `<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd7ec"/><stop offset=".6" stop-color="#e5d4ff"/><stop offset="1" stop-color="#d4efff"/></linearGradient>`);
  }

  function artBedroom(t) {
    return svg(`
      <rect width="800" height="460" fill="url(#bw)"/><rect y="372" width="800" height="88" fill="#d6b08f"/><rect y="366" width="800" height="10" fill="#c39c7a"/>
      <rect x="468" y="48" width="262" height="236" rx="14" fill="#8a6a5a"/><rect x="480" y="60" width="238" height="212" rx="8" fill="url(#sk)"/>
      <circle cx="640" cy="205" r="34" fill="#fff3c4"><animate attributeName="cy" values="216;192;216" dur="7s" repeatCount="indefinite"/></circle>
      <path d="M480 272V238h26v-30h24v30h20v-52h30v52h26v-24h28v24h24v34z" fill="#6a4b8f" opacity=".75"/>
      <rect x="596" y="60" width="6" height="212" fill="#8a6a5a"/><rect x="480" y="160" width="238" height="6" fill="#8a6a5a"/>
      <path d="M452 40h40q-18 100-6 250h-34z" fill="#ff8ac9"/><path d="M746 40h-40q18 100 6 250h34z" fill="#ff8ac9"/>
      <rect x="30" y="238" width="400" height="140" rx="18" fill="#7b4fb0"/><rect x="30" y="196" width="26" height="182" rx="10" fill="#5f3a8c"/>
      <rect x="56" y="212" width="120" height="52" rx="22" fill="#fff"/><path d="M176 270q120-40 254 0v100h-254z" fill="#c2188f"/><path d="M176 292q120-30 254 0" stroke="#ff7ccc" stroke-width="6" fill="none"/>
      <rect x="436" y="318" width="96" height="62" rx="8" fill="#b88660"/><rect x="452" y="340" width="64" height="6" rx="3" fill="#8e6340"/>
      <rect x="448" y="262" width="76" height="54" rx="14" fill="#23113a"/>
      <text x="486" y="298" font-family="Unbounded,sans-serif" font-size="22" font-weight="700" fill="#c6f24f" text-anchor="middle">${t}</text>
      <path d="M436 270l-14-8M436 286h-16M538 270l14-8M538 286h16" stroke="#ff5cb8" stroke-width="4" stroke-linecap="round"><animate attributeName="opacity" values="1;0;1" dur=".6s" repeatCount="indefinite"/></path>`,
      `<linearGradient id="bw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9e2d8"/><stop offset="1" stop-color="#f1cdbf"/></linearGradient><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9b6ff"/><stop offset=".6" stop-color="#ffb9a0"/><stop offset="1" stop-color="#ffe0a8"/></linearGradient>`);
  }

  function artRoad() {
    return svg(`
      <rect width="800" height="460" fill="url(#rs)"/><circle cx="130" cy="150" r="42" fill="#fff3c4"/>
      <g fill="#7c5ca8" opacity=".5"><rect x="20" y="170" width="70" height="200"/><rect x="100" y="120" width="60" height="250"/><rect x="170" y="200" width="90" height="170"/><rect x="280" y="150" width="70" height="220"/><rect x="360" y="190" width="100" height="170"/></g>
      <rect x="500" y="120" width="300" height="260" fill="url(#bk)"/>
      <g fill="#2b2d42"><rect x="522" y="196" width="108" height="178" rx="4"/><rect x="650" y="196" width="108" height="178" rx="4"/></g>
      <rect x="548" y="140" width="76" height="32" rx="16" fill="#ff2fb0"/><text x="586" y="162" font-family="Unbounded,sans-serif" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">ПВЗ</text>
      <rect y="372" width="800" height="88" fill="#6e6a80"/><rect y="372" width="800" height="9" fill="#a39fb6"/>
      <g stroke="#fff" stroke-width="5" stroke-dasharray="46 40" opacity=".7"><path d="M0 430H800"/></g>
      <g><animateTransform attributeName="transform" type="translate" from="-90 0" to="440 0" dur="5s" fill="freeze"/>
        <circle cx="0" cy="316" r="15" fill="#f2c9a0"/><path d="M-2 301q16-4 18 8l-20 2z" fill="#23113a"/><rect x="-15" y="332" width="30" height="46" rx="13" fill="#c2188f"/>
        <rect x="-12" y="374" width="10" height="28" rx="4" fill="#23113a"><animate attributeName="height" values="28;22;28" dur=".5s" repeatCount="indefinite"/></rect>
        <rect x="3" y="374" width="10" height="22" rx="4" fill="#23113a"><animate attributeName="height" values="22;28;22" dur=".5s" repeatCount="indefinite"/></rect></g>`,
      `<linearGradient id="rs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9a7ff"/><stop offset=".7" stop-color="#ffc6a8"/><stop offset="1" stop-color="#ffe9b8"/></linearGradient><pattern id="bk" width="60" height="30" patternUnits="userSpaceOnUse"><rect width="60" height="30" fill="#f6f6f8"/><path d="M0 0H60M0 15H60M30 0V15M0 15V30M60 15V30" stroke="#dcdde3" stroke-width="2" fill="none"/></pattern>`);
  }

  function artDoor(open) {
    return svg(`
      <rect width="800" height="460" fill="url(#bk2)"/>
      <rect x="30" y="90" width="210" height="290" rx="4" fill="#2c3345"/><rect x="560" y="90" width="210" height="290" rx="4" fill="#2c3345"/>
      <path d="M30 90h210l-80 290H30z" fill="#fff" opacity=".08"/><path d="M560 90h210v290H640z" fill="#fff" opacity=".08"/>
      <rect x="282" y="104" width="236" height="286" rx="6" fill="#1c2233"/>
      <rect x="292" y="114" width="106" height="266" fill="${open ? "url(#warm)" : "url(#glass)"}"/><rect x="402" y="114" width="106" height="266" fill="${open ? "url(#warm)" : "url(#glass)"}"/>
      <rect x="386" y="230" width="8" height="64" rx="4" fill="#cfd3dc"/><rect x="406" y="230" width="8" height="64" rx="4" fill="#cfd3dc"/>
      <rect x="338" y="36" width="124" height="44" rx="22" fill="#ff2fb0"/><text x="400" y="66" font-family="Unbounded,sans-serif" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">ПВЗ</text>
      <circle cx="568" cy="226" r="34" fill="#ff2fb0"/><text x="568" y="222" font-family="Onest,sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">режим</text><text x="568" y="240" font-family="Onest,sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">с 10:00</text>
      <rect y="380" width="800" height="80" fill="url(#tiles)"/>
      <g><rect x="40" y="396" width="190" height="16" rx="3" fill="#a8452f"/><rect x="40" y="416" width="190" height="10" rx="3" fill="#8e3624"/><rect x="62" y="426" width="14" height="22" fill="#c9c9cf"/><rect x="200" y="426" width="14" height="22" fill="#c9c9cf"/></g>
      <g><rect x="570" y="396" width="190" height="16" rx="3" fill="#a8452f"/><rect x="570" y="416" width="190" height="10" rx="3" fill="#8e3624"/><rect x="592" y="426" width="14" height="22" fill="#c9c9cf"/><rect x="730" y="426" width="14" height="22" fill="#c9c9cf"/></g>
      <g fill="#6d4b3a"><rect x="248" y="342" width="26" height="46" rx="4"/><rect x="526" y="342" width="26" height="46" rx="4"/></g>
      ${open ? `<g transform="translate(400 150)"><circle r="30" fill="#2f9e63"/><path d="M-13 1l9 10 18-20" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>` : ""}`,
      `<pattern id="bk2" width="60" height="30" patternUnits="userSpaceOnUse"><rect width="60" height="30" fill="#f6f6f8"/><path d="M0 0H60M0 15H60M30 0V15M0 15V30M60 15V30" stroke="#dcdde3" stroke-width="2" fill="none"/></pattern>
       <pattern id="tiles" width="40" height="20" patternUnits="userSpaceOnUse"><rect width="40" height="20" fill="#8f93a8"/><rect width="20" height="10" fill="#6c7088"/><rect x="20" y="10" width="20" height="10" fill="#6c7088"/></pattern>
       <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fb3c8"/><stop offset=".5" stop-color="#5f8a76"/><stop offset="1" stop-color="#3c5a6e"/></linearGradient>
       <linearGradient id="warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d6"/><stop offset="1" stop-color="#ffd9a8"/></linearGradient>`);
  }

  function artInside() {
    return svg(`
      <rect width="800" height="460" fill="#f7f5fa"/>
      <rect x="250" y="36" width="550" height="300" fill="#fbfafd"/>
      <polygon points="0,0 250,36 250,336 0,430" fill="url(#pk)"/>
      <rect x="260" y="8" width="150" height="14" rx="7" fill="#fff" opacity=".9"/><rect x="540" y="8" width="150" height="14" rx="7" fill="#fff" opacity=".9"/>
      <rect y="336" width="800" height="124" fill="#7d7f8a"/><g stroke="#6c6e79" stroke-width="3"><path d="M0 366H800M0 398H800M0 430H800"/><path d="M120 336V460M300 336V460M480 336V460M660 336V460"/></g>
      <g fill="#d9b784" stroke="#b58b53" stroke-width="2"><rect x="56" y="236" width="150" height="100" rx="3"/></g>
      <g stroke="#b58b53" stroke-width="2"><path d="M86 236V336M116 236V336M146 236V336M176 236V336M56 268H206M56 302H206"/></g>
      <g><rect x="318" y="300" width="400" height="28" rx="4" fill="#fff"/><rect x="330" y="328" width="150" height="76" rx="3" fill="#f0eef5"/><rect x="640" y="328" width="70" height="76" rx="3" fill="#e9e5f1"/><rect x="520" y="276" width="40" height="24" rx="3" fill="#2b2b33"/><rect x="580" y="282" width="38" height="18" rx="3" fill="#ff5cb8"/></g>
      <g><rect x="410" y="96" width="90" height="190" rx="3" fill="#fff" stroke="#e1dcea" stroke-width="3"/><rect x="420" y="106" width="70" height="170" fill="#e9f1f7"/><path d="M420 106q18 80 8 170h-8z" fill="#7a2bd1"/>
      <rect x="520" y="96" width="90" height="190" rx="3" fill="#fff" stroke="#e1dcea" stroke-width="3"/><rect x="530" y="106" width="70" height="170" fill="#e9f1f7"/><path d="M530 106q18 80 8 170h-8z" fill="#7a2bd1"/></g>
      <g><rect x="668" y="226" width="110" height="76" rx="4" fill="#c99a63"/><rect x="660" y="298" width="126" height="40" rx="4" fill="#d6aa72"/><rect x="676" y="156" width="96" height="72" rx="4" fill="#e0b87f"/><rect x="718" y="156" width="12" height="72" fill="#f4dcb8" opacity=".7"/><rect x="718" y="226" width="12" height="76" fill="#f4dcb8" opacity=".7"/><rect x="718" y="298" width="12" height="40" fill="#f4dcb8" opacity=".7"/></g>
      <g><rect x="40" y="380" width="120" height="14" rx="4" fill="#2b2b33"/><rect x="62" y="352" width="76" height="30" rx="14" fill="#2b2b33"/></g>`,
      `<linearGradient id="pk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b3157f"/><stop offset="1" stop-color="#d8269f"/></linearGradient>`);
  }

  /* ---------- сцены ---------- */
  async function sceneTitle() {
    setStep("Старт");
    const sh = scene(artPoster(), { artClass: "title-art" });
    sh.innerHTML = `<span class="tag">Обучение · урок 1</span><h1>Смена на ПВЗ</h1>
      <p>Ты выходишь на смену: просыпаешься, добираешься до работы, открываешь пункт и принимаешь поставку. Принимай решения как на настоящей смене. За ошибки снимаются очки, а правила, которые ты узнаёшь, попадают в заметки.</p>
      <div class="row-end"><button class="btn" id="go" type="button">Начать смену →</button></div>
      <p class="soon">Дальше будут выдача, возвраты и закрытие смены.</p>`;
    await new Promise((r) => { $("#go", sh).onclick = () => r(); });
  }

  async function sceneMorning() {
    setStep("Утро");
    S.clock = 7 * 60; hud();
    const sh = scene(artBedroom("07:00"));
    await narrate(sh, `<b>07:00.</b> Звонит будильник. Сегодня твоя смена на пункте <b>${POINT_OK.title}</b>.<br><br>Работа начинается в <b>9:00</b>, а для клиентов пункт откроется в <b>10:00</b>. Этот час нужен, чтобы принять поставку и всё подготовить, поэтому приехать нужно к девяти.`, "Встаю");
    learn("time");
    const picked = await checklist(sh, "Собираешься на работу. Что нужно сделать до выхода? <small>Отметь всё, что считаешь нужным.</small>", [
      { value: "key", label: "Заранее забрать ключ от пункта у Таси", hint: "Дверь на пункте закрыта, ключ сейчас у неё" },
      { value: "phone", label: "Зарядить телефон", hint: "Приёмка идёт в приложении" },
      { value: "thermos", label: "Взять термос с чаем" },
      { value: "music", label: "Выбрать плейлист в дорогу" },
    ], "Готово");
    S.key = picked.has("key"); S.phone = picked.has("phone");
    const leave = await ask(sh, `Дорога до пункта занимает около <b>${COMMUTE} минут</b>. Во сколько выходишь из дома?`, [
      { value: 7 * 60 + 45, label: "В 7:45", hint: "приеду в 8:25, с запасом" },
      { value: 8 * 60 + 15, label: "В 8:15", hint: "приеду в 8:55, как раз к началу" },
      { value: 8 * 60 + 40, label: "В 8:40", hint: "приеду в 9:20" },
    ]);
    S.clock = leave; hud();
    sh.innerHTML = "";
    S.arrival = leave + COMMUTE;
  }

  async function sceneRoad() {
    setStep("Дорога");
    const sh = scene(artRoad());
    sh.innerHTML = `<div class="say"><b>${fmt(S.clock)}.</b> Ты вышел из дома. Дорога занимает около ${COMMUTE} минут.</div>`;
    await sleep(2600);
    S.clock = S.arrival; hud();
    if (S.arrival > 9 * 60) {
      await narrate(sh, `<b>${fmt(S.clock)}.</b> Ты на месте, но рабочий день уже начался в 9:00. Поставка ждёт, а до открытия для клиентов остаётся всё меньше времени.`);
      await oops(15, "Опоздание", "Смена начинается в 9:00. За час до открытия нужно принять поставку и разложить товары. Если опоздал, то не успеешь, и клиенты будут ждать. Рассчитывай дорогу с запасом.");
    } else {
      await narrate(sh, `<b>${fmt(S.clock)}.</b> Ты на месте. ${S.arrival <= 8 * 60 + 30 ? "Пришёл заранее, и это здорово." : "Пришёл вовремя, но запаса почти нет."}`);
    }
  }

  async function sceneDoor() {
    setStep("Вход");
    let sh = scene(artDoor(false));
    await narrate(sh, `Ты у входа. Нужно открыть дверь.`, "Открыть дверь");
    if (S.key) {
      sh = scene(artDoor(true));
      await narrate(sh, `«Хорошо, что я заранее подготовился и взял ключик у Таси, а то бы сейчас не попал на пункт».`, "Дальше", "thought");
    } else {
      await narrate(sh, `Ты дёргаешь ручку, но дверь заперта. Ключ остался у Таси, и ты не забрал его заранее.`, "Позвонить Тасе");
      tick(35);
      await oops(20, "Ключа нет", "Ты потерял 35 минут: пока Тася привезла ключ, поставка стояла у двери. Заранее продумывай, как будешь открываться, и забирай ключ до смены.");
      sh = scene(artDoor(true));
      await narrate(sh, `Тася приехала с ключом. Дверь открыта.`);
    }
    learn("key");
  }

  async function sceneInside() {
    setStep("Поставка");
    const sh = scene(artInside());
    await narrate(sh, `<b>${fmt(S.clock)}.</b> Ты внутри. Поставка уже приехала и ждёт, когда ты её примешь. Для начала нужно занести коробки на склад.`, "К коробкам");
    await sceneBoxes();
  }

  function sceneBoxes() {
    const total = 9, perStack = 3;
    const html = `<div class="boxes"><div class="boxes-top"><span>У двери осталось:</span><span class="pile" id="pile">${'<i></i>'.repeat(total)}</span></div><div class="pads">${[1, 2, 3].map((n) => `<button class="pad" type="button" data-pad="${n - 1}"><span class="lbl">Стопка ${n}</span></button>`).join("")}</div></div>`;
    const sh = scene(html);
    sh.innerHTML = `<div class="say">Неси коробки на склад и ставь по три друг на друга. Нажимай на свободное место.<small id="bx-count">Перенесено: 0 из ${total}</small></div>`;
    const counts = [0, 0, 0]; let moved = 0, lock = false;
    return new Promise((resolve) => {
      stage.querySelectorAll(".pad").forEach((p) => {
        p.onclick = async () => {
          if (lock) return;
          const i = +p.dataset.pad;
          if (counts[i] >= perStack) {
            p.classList.remove("shake"); void p.offsetWidth; p.classList.add("shake");
            await oops(3, "Слишком высокая стопка", "Больше трёх коробок друг на друга не ставим: стопка может упасть, и неудобно доставать. Поставь в другое место.", false);
            tick(1);
            return;
          }
          counts[i]++; moved++; tick(1);
          p.prepend(el("div", "bx"));
          const gone = $("#pile").querySelectorAll("i:not(.gone)"); if (gone.length) gone[gone.length - 1].classList.add("gone");
          $("#bx-count").textContent = `Перенесено: ${moved} из ${total}`;
          if (moved === total) {
            lock = true; learn("stack");
            await sleep(900);
            resolve();
          }
        };
      });
    });
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
        const tray = P.tray.map((it, i) => {
          let out = `<button class="tcard" data-a="item" data-id="${it.id}" type="button"><span class="em">${emoji(it)}</span>${sticker(it.code)}<span class="nm">${it.name}</span></button>`;
          if (i === P.decoyAt) out = `<button class="tcard big" data-a="decoy" type="button"><span class="bigbox"><i></i></span><span class="nm">Большая коробка, стикер поставки</span></button>` + out;
          return out;
        }).join("");
        h = `<div class="apphead"><button class="back" data-a="back" type="button" aria-label="Назад">‹</button><h3>Принять</h3><span class="torch">🔦</span></div>
          <div class="appbody"><div class="cam"><div class="frame"><i></i><span class="scanline"></span></div><p>Наведите на QR</p></div>
          <div class="tray-title">${P.tray.length ? "На столе лежат товары. Нажми на стикер, чтобы отсканировать." : "На столе больше нет товаров."}</div>
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
    if (P.screen === "accept") return `<div class="say">Телефон в руках. Открой приложение и начни приёмку. Твой пункт сегодня: <b>${POINT_OK.title}</b>.${P.point === "nek" ? "<small>Пункт выбран верно.</small>" : ""}</div>`;
    if (P.screen === "more") return `<div class="say">Раздел «Ещё». Здесь меняют пункт выдачи.</div>`;
    if (P.screen === "point") return `<div class="say">Адрес пункта вверху. Нажми на него, чтобы сменить. В «Поставках» видно, сколько всего ждёт.</div>`;
    if (P.screen === "points") return `<div class="say">Выбери пункт, на котором работаешь сегодня, и нажми «Выбрать».</div>`;
    if (P.screen === "ships") return `<div class="say">Здесь видно, сколько отгрузок, коробок и товаров ждёт. Смотри это перед началом смены, чтобы спланировать время.</div>`;
    if (P.screen === "cam") return left ? `<div class="say">Сканируем розовый стикер ШК на самом товаре. Осталось отсканировать: <b>${left}</b>.</div>` : `<div class="say">Всё отсканировано и разложено.</div><div class="row-end"><button class="btn" data-s="finish" type="button">Закончить приёмку →</button></div>`;
    if (P.screen === "result") {
      if (!P.placed) return `<div class="say">Приложение показало ячейку <b>${P.cur.cell}</b> и озвучило её. Можно осмотреть товар, а потом отнеси его в ячейку.</div><div class="row-end"><button class="btn" data-s="place" type="button">Отнести в ячейку ${P.cur.cell} →</button></div>`;
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

  /* ---------- склад: куда нести ---------- */
  function warehouse(item) {
    return new Promise((resolve) => {
      const veil = $("#veil"); veil.hidden = false;
      const box = el("div", "wh"); veil.replaceChildren(box);
      const finish = () => { veil.hidden = true; veil.replaceChildren(); resolve(); };
      const title = (sub) => `<h2>Куда несёшь? <span class="cellbadge">${item.cell}</span></h2><p class="sub">${sub}</p>`;
      const miss = async (pts, t, x) => { S.cellMiss = true; tick(1); await oops(pts, t, x, false); };

      function stepZone() {
        box.innerHTML = title(`${item.em === "micro" ? "Микроволновка" : item.name}. Выбери место на складе.`) + `<div class="zones">${Object.keys(ZONES).map((k) => `<button class="zone" data-z="${k}" type="button"><span class="e">${ZONES[k].e}</span><b>${ZONES[k].t}</b><small>${ZONES[k].s}</small></button>`).join("")}</div>`;
        box.querySelectorAll(".zone").forEach((b) => b.onclick = () => chooseZone(b.dataset.z));
      }
      async function chooseZone(z) {
        tick(1);
        if (z === item.zone) {
          if (z === "racks" || z === "top") return stepRack();
          if (z === "pockets") return stepGrid("pockets");
          if (z === "hall") return stepGrid("hall");
          return stepTape(z);
        }
        let why = `Ячейка ${item.cell} находится не здесь. 1–300: стеллажи, с 301: верхние полки, 700-е: зал, 800-е: кармашки.`;
        if (item.zone === "container" && z === "pockets") why = "Чайник не поместится в кармашек. Такой товар подписывают скотчем и кладут в контейнер под кармашками.";
        else if (item.zone === "desk") why = "Габаритный товар на полки не поставишь: он останется справа от стола, с подписью скотчем.";
        else if (z === "desk" || z === "container") why = "Это место для товаров, которые не влезают в ячейки, а наш товар обычный.";
        else if (item.zone === "top" && z === "racks") why = "Номера от 301 идут на самые верхние полки, а не на обычные стеллажи.";
        else if (item.zone === "racks" && z === "top") why = `Номер ${item.cell} меньше 301: это обычная полка стеллажа, не верхняя.`;
        await miss(3, "Не то место", why);
      }
      function rackHtml() {
        const rows = [21, 25, 29, 33, 37].map((s) => [0, 1, 2, 3].map((i) => s + i));
        const cell = (n) => `<button class="cellbtn" data-c="${n}" type="button">${n}</button>`;
        return `<div class="rack"><div class="shelf topboard">${[425, 426, 427, 428].map(cell).join("")}</div>${rows.map((r) => `<div class="shelf">${r.map(cell).join("")}</div>`).join("")}</div><p class="rack-note">Номера на полках идут сверху вниз, ряд за рядом. Сверху отдельная доска с номерами от 301.</p>`;
      }
      function stepRack() {
        box.innerHTML = title("Выбери стеллаж, на котором лежит эта ячейка.") + `<div class="chips">${["1–20", "21–40", "41–60"].map((c) => `<button data-r="${c}" type="button">${c}</button>`).join("")}</div><div id="rk"></div><button class="back-link" id="bk" type="button">← к выбору места</button>`;
        $("#bk", box).onclick = stepZone;
        box.querySelectorAll("[data-r]").forEach((b) => b.onclick = async () => {
          tick(1);
          if (b.dataset.r !== "21–40") { $("#rk", box).innerHTML = ""; toast(`В стеллаже ${b.dataset.r} другие номера. Тебе нужна ячейка ${item.cell}.`); return; }
          $("#rk", box).innerHTML = rackHtml();
          box.querySelectorAll(".cellbtn").forEach((c) => c.onclick = async () => {
            tick(1);
            if (+c.dataset.c === item.cell) { toast(`Ячейка ${item.cell}: готово ✓`, "good"); return finish(); }
            c.classList.add("miss");
            await miss(2, "Другая ячейка", `Это ${c.dataset.c}, а нужна ${item.cell}. Проверяй номер на полке.`);
          });
        });
      }
      function stepGrid(kind) {
        const nums = kind === "pockets" ? [801, 802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812] : [701, 702, 703, 704, 705, 706, 707, 708, 709, 710];
        box.innerHTML = title(kind === "pockets" ? "Тканевые кармашки у стеллажа. Выбери нужный номер." : "Картонные ячейки в зале у рабочего стола, с твоей стороны. Выбери нужный номер.") + `<div class="${kind}">${nums.map((n) => `<button class="cellbtn" data-c="${n}" type="button">${n}</button>`).join("")}</div><button class="back-link" id="bk" type="button">← к выбору места</button>`;
        $("#bk", box).onclick = stepZone;
        box.querySelectorAll(".cellbtn").forEach((c) => c.onclick = async () => {
          tick(1);
          if (+c.dataset.c === item.cell) { toast(`Ячейка ${item.cell}: готово ✓`, "good"); return finish(); }
          c.classList.add("miss");
          await miss(2, "Другая ячейка", `Это ${c.dataset.c}, а нужна ${item.cell}.`);
        });
      }
      function stepTape(z) {
        const opts = z === "container"
          ? [[true, `Написать «${item.cell}»`, "номер ячейки, как показало приложение"], [false, "Написать «Чайник»", "название товара"], [false, "Не подписывать", "и так запомню"]]
          : [[true, "Скотч спереди, номер ячейки крупно", "чтобы надпись было видно"], [false, "Скотч сзади, надпись мелко", "чтобы не мешал"], [false, "Не подписывать", "и так запомню"]];
        box.innerHTML = title(z === "container" ? "Отрезаешь кусочек малярного скотча и клеишь на товар. Что пишешь?" : "Отрезаешь кусок малярного скотча. Как подписываешь габаритный товар?") + `<div class="opts">${opts.map((o, i) => `<button class="opt" data-i="${i}" type="button"><b>${o[1]}</b><small>${o[2]}</small></button>`).join("")}</div><button class="back-link" id="bk" type="button">← к выбору места</button>`;
        $("#bk", box).onclick = stepZone;
        box.querySelectorAll(".opt").forEach((b) => b.onclick = async () => {
          tick(1);
          if (opts[+b.dataset.i][0]) { toast(z === "container" ? "Подписал и положил в контейнер под кармашками ✓" : "Поставил справа от стола и подписал ✓", "good"); return finish(); }
          await miss(3, "Так потеряется", z === "container" ? "Найти товар в контейнере можно только по номеру ячейки на скотче. Подпиши номер, который показало приложение." : "Надпись должна быть хорошо видна: иначе товар не найти, когда придёт клиент.");
        });
      }
      stepZone();
    });
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

  async function onSheetAction(s) {
    if (busy) return;
    if (s === "place") {
      const it = P.cur; busy = true;
      if (it.defect && !P.brak) {
        await oops(5, "Брак без отметки", "У товара есть брак, а галочка «Брак» не стоит. Осматривай товар и отмечай брак в карточке, иначе он попадёт к клиенту. Поставь галочку и неси товар.");
        learn("brak"); busy = false; return;
      }
      if (!it.defect && P.brak) {
        await oops(3, "Лишняя отметка", "Товар целый, а отметка «Брак» стоит. Отмечай её только когда брак есть.");
        P.brak = false; busy = false; renderPhone(); return;
      }
      if (it.defect) learn("brak");
      await warehouse(it);
      P.placed = true; P.done.unshift({ item: it, brak: P.brak }); S.placed++;
      tick(2);
      if (it.zone === "pockets") learn("pocket");
      if (it.tape === "container") learn("tape");
      if (it.big) learn("big");
      if (S.placed === 1) learn("cells");
      busy = false; renderPhone();
    } else if (s === "finish") {
      phoneDone && phoneDone();
    }
  }

  let phoneDone = null;
  async function scenePhone() {
    setStep("Приёмка");
    P = Object.assign(P, { screen: "accept" });
    const sh = scene(phoneArt(), { phone: true });
    const root = $("#phone-screen");
    root.addEventListener("click", (e) => { const t = e.target.closest("[data-a]"); if (t) onPhoneAction(t.dataset.a, t.dataset); });
    sh.addEventListener("click", (e) => { const t = e.target.closest("[data-s]"); if (t) onSheetAction(t.dataset.s); });
    renderPhone();
    if (!S.phone) {
      busy = true;
      await card({ tone: "bad", title: "Телефон разряжен", text: "Приёмка идёт в приложении, а телефон сел в самый неподходящий момент. Пришлось ставить на зарядку и ждать 15 минут. Заряжай телефон заранее.", pen: "−10 очков" });
      S.score = Math.max(0, S.score - 10); S.mistakes.push("Телефон разряжен"); tick(15); busy = false;
    }
    await new Promise((r) => { phoneDone = r; });
    phoneDone = null;
  }

  /* ---------- финал ---------- */
  async function sceneFinish() {
    setStep("Финал");
    let sh = scene(artInside());
    await narrate(sh, `<b>${fmt(S.clock)}.</b> Все товары разложены по местам.`, "Дальше");
    const ans = await ask(sh, "Приёмка закончена, но приложение ничего не показало: нет уведомления, что приёмка завершена. Как понять, что всё сделано?", [
      { value: "wait", label: "Подожду, пока приложение напишет, что приёмка завершена" },
      { value: "check", label: "Проверю сам: на столе не осталось неразобранных товаров" },
    ]);
    if (ans === "wait") await oops(5, "Уведомления не будет", "Приложение не сообщает о завершении приёмки. Проверяй сам: на столе не должно остаться товаров, все лежат в своих ячейках.");
    learn("done");
    await results();
  }

  function results() {
    setStep("Итоги");
    if (S.clock > 10 * 60) { S.score = Math.max(0, S.score - 10); S.mistakes.push("Не успел к 10:00"); }
    const sh = scene(artPoster(), { artClass: "res-art" });
    const stars = S.score >= 85 ? 3 : S.score >= 60 ? 2 : 1;
    const ok = S.clock <= 10 * 60;
    const badges = [
      [S.arrival <= 9 * 60, "Приехал к 9:00", "Опоздал: смена начинается в 9:00"],
      [S.key, "Заранее позаботился о ключе", "Не продумал, как попасть на пункт"],
      [!S.blindScan, "Проверил пункт перед приёмкой", "Начал принимать на чужом пункте"],
      [S.shipSeen, "Посмотрел, сколько поставки ждёт", "Не заглянул в «Поставки» перед работой"],
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
    return Promise.resolve();
  }

  /* ---------- запуск ---------- */
  window.startTraining = async function () {
    resetState();
    stage = $("#stage");
    $("#notes-list").innerHTML = ""; $("#notes-empty").hidden = false;
    $("#veil").hidden = true; $("#veil").innerHTML = "";
    hud();
    const nt = $("#notes"), tgl = $("#notes-toggle"), cls = $("#notes-close");
    tgl.onclick = () => nt.classList.toggle("open");
    cls.onclick = () => nt.classList.remove("open");
    try {
      await sceneTitle();
      await sceneMorning();
      await sceneRoad();
      await sceneDoor();
      await sceneInside();
      await scenePhone();
      await sceneFinish();
    } catch (e) {
      console.error(e);
      toast("Что-то пошло не так. Открой обучение ещё раз.", "bad");
    }
  };
})();
