// Карта похода: общий код для страницы игроков (map.html) и мастера (master-map.html)
import * as T from './terrain.js';
import { S, M, INK, PANEL, PAPER, esc } from './terrain.js';
import { createStore, uid, isMissingTable } from './store.js';
import { INKS, MARKER_TYPES, markerSvg, markerIcon, toolIcon, DRAW_MODES, EYE_ON, EYE_OFF } from './icons.js';
import { STYLES, GLYPH_SETS, SPREADS, renderStyled, legendTile } from './styles.js';

const TOOLS = {
    inspect: { label: 'Осмотр', title: 'Осмотр', key: 'KeyV', hint: 'Нажмите на клетку, чтобы узнать местность и пометки. Перетаскивайте карту, чтобы двигать её; метки можно перетаскивать.' },
    marker: { label: 'Метка', title: 'Метка', key: 'KeyM', hint: 'Выберите тип и нажмите на клетку. К метке можно написать заметку.' },
    zone: { label: 'Зона', title: 'Зона', key: 'KeyZ', hint: 'Проведите по клеткам, чтобы закрасить зону. Повторный проход по закрашенному стирает.' },
    draw: { label: 'Черчение', title: 'Черчение', key: 'KeyD', hint: '' },
    label: { label: 'Подпись', title: 'Подпись', key: 'KeyT', hint: 'Нажмите на клетку и впишите текст.' },
    eraser: { label: 'Ластик', title: 'Ластик', key: 'KeyE', hint: 'Проведите по карте, чтобы стереть метки, подписи, линии и закраску зон.', gmHint: ' Селения и дороги ластик не трогает — их убирают в их инструментах.' },
    terrain: { label: 'Рельеф', title: 'Рельеф', key: 'KeyR', gm: true, hint: 'Выберите местность и рисуйте по клеткам. Ступень «Сама» — к середине массива лес сам переходит в чащу, горы в хребет; или задайте ступень вручную.' },
    place: { label: 'Селение', title: 'Поселения и места', key: 'KeyP', gm: true, hint: 'Нажмите на клетку, чтобы поставить. Нажмите на поставленное — выбрать; перетащите — передвинуть.' },
    road: { label: 'Дорога', title: 'Тропы, дороги, реки', key: 'KeyW', gm: true, hint: 'Проведите по клеткам. Короткое нажатие на дорогу выбирает её.' },
    fog: { label: 'Туман', title: 'Туман', key: 'KeyF', gm: true, hint: 'Закрашивайте, что знают игроки. Под туманом игроки не видят ни местности, ни селений.' }
};
const PLAYER_TOOL_IDS = ['inspect', 'marker', 'zone', 'draw', 'label', 'eraser'];
const GM_TOOL_IDS = ['terrain', 'place', 'road', 'fog'];
const FOG_LEVELS = [
    { v: 3, label: 'Разведано' }, { v: 2, label: 'Приблизительно' }, { v: 1, label: 'По слухам' }, { v: 0, label: 'Скрыто' }
];
const ROAD_KINDS = { trail: 'Тропа', road: 'Дорога', river: 'Река' };
const LABEL_SIZES = { s: 'Мелко', m: 'Обычно', l: 'Крупно' };
// Готовые карты в папке maps/ — их можно выбрать основой новой карты
const PRESETS = { nyctonauts: 'Модуль «Никтонавты» — по наброску' };
const UNITS = ['км', 'вёрст', 'миль', 'лиг', 'дней пути', 'часов ходу', 'шагов', 'футов', 'м'];
const FOG_SET_TEXT = ['Скрыто от игроков', 'По слухам', 'Известно приблизительно', 'Разведано'];

const fmtNum = n => String(Math.round(n * 10) / 10).replace('.', ',');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const inkHex = id => (INKS[id] || INKS.red).hex;

export function startMap({ role = 'player' } = {}) {
    const gm = role === 'gm';
    const params = new URLSearchParams(location.search);
    const demo = params.has('demo');
    const charId = params.get('id');
    const store = createStore({ demo });

    // ---------------- Состояние ----------------
    const st = {
        maps: [], mapId: null, mapRow: null, def: null,
        marks: new Map(),
        tool: 'inspect', panelTab: 'tool', preview: false,
        sub: { mtype: 'camp', drawMode: 'line', ink: 'red', zone: null, terrain: 'forest', tier: 0, brush: 1, fog: 3, place: 'village', road: 'trail', labelSize: 'm', snap: true },
        hideNew: { marks: true, map: false },
        sel: null, focusId: null, hover: null, hoverPt: null,
        view: { k: 1, x: 0, y: 0 }, fitted: false,
        drawing: null, pings: [],
        author: gm ? 'Мастер' : null,
        conn: { realtime: false, polling: false, ok: null },
        setupNeeded: false, loading: true,
        viewSeen: 0, newMapForm: false, panelCollapsed: false,
        online: [],
        form: {}  // черновики полей на вкладке «Карта» — переживают перерисовку панели
    };
    const FORM_IDS = new Set(['nm-title', 'nm-cols', 'nm-rows', 'nm-base', 'sz-cols', 'sz-rows', 'img-url', 'gen-seed']);
    const fv = (id, def) => st.form[id] != null ? st.form[id] : def;
    const locks = new Map();      // id → время последней локальной правки (чужие обновления не перетирают)
    const saveTimers = new Map(); // id → таймер отложенного сохранения или повтора
    const pend = new Map();       // id → какие поля ждут сохранения: insert | data | hidden | deleted
    const inflightIds = new Set();// пометки, чей запрос сейчас в пути (на пометку — один запрос за раз)
    const tomb = new Map();       // удалённые здесь пометки — пока удаление не дошло до базы
    const retries = new Map();
    let inflight = 0, mapSaveTimer = null, mapSaving = 0, mapRetries = 0, defEdits = 0, ownRevs = new Set();
    let undoStack = [], batch = null;

    // ---------------- Разметка ----------------
    const root = document.getElementById('map-root');
    root.className = 'gm-root';
    root.dataset.role = role;
    root.innerHTML = `
        <svg class="gm-svg" id="gm-svg" role="application" aria-label="Карта похода">
            <defs id="gm-defs"></defs>
            <g id="vp">
                <rect id="L-paper" fill="${PAPER}" opacity="0"/>
                <g id="L-image" style="pointer-events:none" clip-path="url(#grid-clip)"></g>
                <g id="L-tones" style="pointer-events:none"></g>
                <path id="L-grid" fill="none" stroke="${INK}" stroke-width="0.6" style="pointer-events:none"/>
                <g id="L-edges" style="pointer-events:none"></g>
                <g id="L-glyphs" style="pointer-events:none" clip-path="url(#grid-clip)"></g>
                <g id="L-roads" style="pointer-events:none" clip-path="url(#grid-clip)"></g>
                <g id="L-fogshade" style="pointer-events:none"></g>
                <g id="L-fogedge" style="pointer-events:none"></g>
                <g id="L-zones" style="pointer-events:none"></g>
                <g id="L-places" style="pointer-events:none"></g>
                <g id="L-tterrain" style="pointer-events:none"></g>
                <g id="L-shapes"></g>
                <g id="L-under" style="pointer-events:none"></g>
                <g id="L-marks"></g>
                <g id="L-tmarks" style="pointer-events:none"></g>
                <g id="L-ui" style="pointer-events:none"></g>
            </g>
        </svg>
        <div class="gm-grain" aria-hidden="true"></div>
        <div class="gm-empty" id="gm-empty" hidden></div>
        <header class="gm-head" id="gm-head"><div class="gm-title" id="gm-title">Карта похода</div><div class="gm-sub" id="gm-sub"></div><div class="gm-gmbar" id="gm-gmbar"></div></header>
        <nav class="gm-rail" id="gm-rail" aria-label="Инструменты"></nav>
        <div class="gm-zoom" id="gm-zoom">
            <button type="button" data-z="in" title="Приблизить (+)" aria-label="Приблизить">+</button><i></i>
            <button type="button" data-z="out" title="Отдалить (−)" aria-label="Отдалить">−</button><i></i>
            <button type="button" data-z="fit" title="Вся карта (0)" aria-label="Показать всю карту"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="3 2"/></svg></button>
        </div>
        <div class="gm-ornament" id="gm-orn" aria-hidden="true"></div>
        <div class="gm-compass" id="gm-compass" aria-hidden="true"></div>
        <aside class="gm-panel" id="gm-panel" aria-label="Панель карты"></aside>
        <div class="gm-tip" id="gm-tip" role="tooltip"></div>
        <div class="gm-toast" id="gm-toast" role="status"></div>
        <div id="gm-modal"></div>`;
    const $ = id => document.getElementById(id);
    const svg = $('gm-svg'), vp = $('vp'), panel = $('gm-panel'), rail = $('gm-rail');

    $('gm-defs').innerHTML =
        Object.entries(INKS).map(([id, v]) => `<pattern id="ink-${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${hexA(v.hex, 0.1)}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${v.hex}" stroke-width="1.4"/></pattern>`).join('') +
        `<pattern id="fog-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" fill="${PAPER}" fill-opacity="0.62"/><line x1="0" y1="0" x2="0" y2="7" stroke="#6B6155" stroke-width="1.1" stroke-opacity="0.55"/></pattern>` +
        `<clipPath id="grid-clip"><rect id="grid-clip-rect" x="${M}" y="${M}" width="700" height="700"/></clipPath>` +
        `<filter id="aged" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.727 0.346 0.085 0 0  0.157 0.859 0.076 0 0  0.122 0.24 0.609 0 0  0 0 0 1 0"/><feComponentTransfer><feFuncR type="linear" slope="0.9" intercept="0.09"/><feFuncG type="linear" slope="0.88" intercept="0.08"/><feFuncB type="linear" slope="0.84" intercept="0.07"/></feComponentTransfer></filter>`;

    // ---------------- Мелочи интерфейса ----------------
    let toastTimer = null;
    function toast(text, err = false) {
        const el = $('gm-toast');
        el.textContent = text;
        el.className = 'gm-toast' + (err ? ' err' : '');
        el.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.style.display = 'none'; }, err ? 6000 : 3000);
    }
    const compact = () => root.clientWidth < 700;
    const playerView = () => !gm || st.preview;
    const canEdit = row => gm || !(row.data && row.data.gm);
    const visibleRow = row => !row.deleted && (!playerView() || !row.hidden);

    // ---------------- Отрисовка: пакетная, раз в кадр ----------------
    const dirty = new Set();
    let raf = 0;
    function invalidate(...what) {
        what.forEach(w => dirty.add(w));
        if (!raf) raf = requestAnimationFrame(render);
    }
    function render() {
        raf = 0;
        const d = new Set(dirty); dirty.clear();
        root.classList.toggle('compact', compact());
        root.classList.toggle('has-sel', !!st.sel);
        if (d.has('rail')) renderRail();
        if (d.has('head')) renderHead();
        if (d.has('terrain')) renderTerrainLayers();
        else if (d.has('names')) renderTerrainTexts();
        if (d.has('marks')) renderMarks();
        if (d.has('panel')) renderPanel();
        if (d.has('view')) applyView();
        if (d.has('ui') || d.has('marks') || d.has('view')) renderUI();
        if (d.has('view') || d.has('terrain')) renderOrnament();
    }

    // ---------------- Вид: сдвиг и масштаб ----------------
    function applyView() {
        const { k, x, y } = st.view;
        vp.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})`);
        saveViewSoon();
    }
    function freeRect() {
        const w = root.clientWidth, h = root.clientHeight;
        const head = $('gm-head').getBoundingClientRect(), rr = rail.getBoundingClientRect(), pr = panel.getBoundingClientRect(), rt = root.getBoundingClientRect();
        if (compact()) {
            const top = head.bottom - rt.top + 8;
            const bottom = Math.min(rr.top, panel.offsetParent ? pr.top : h) - rt.top - 8;
            return { l: 8, t: top, r: w - 8, b: Math.max(top + 120, bottom) };
        }
        return { l: rr.right - rt.left + 14, t: Math.min(head.bottom - rt.top + 6, 110), r: (panel.offsetParent ? pr.left - rt.left : w) - 14, b: h - 14 };
    }
    function mapDims() { return st.def ? T.mapSize(st.def) : [780, 780]; }
    function fitK() {
        const f = freeRect(), [W, H] = mapDims();
        return Math.max(0.05, Math.min((f.r - f.l) / W, (f.b - f.t) / H));
    }
    function fitView(rect) {
        const f = freeRect(), [W, H] = mapDims();
        const r = rect || { x: 0, y: 0, w: W, h: H };
        const k = clamp(Math.min((f.r - f.l) / r.w, (f.b - f.t) / r.h), kMin(), kMax());
        return { k, x: f.l + ((f.r - f.l) - r.w * k) / 2 - r.x * k, y: f.t + ((f.b - f.t) - r.h * k) / 2 - r.y * k };
    }
    // Игрокам сначала показываем известные земли, а не всю сетку с туманом
    function knownRect() {
        const def = st.def;
        if (!def || !playerView() || !def.fog.includes('0')) return null;
        let c0 = Infinity, r0 = Infinity, c1 = -1, r1 = -1;
        for (let r = 0; r < def.rows; r++) for (let c = 0; c < def.cols; c++) {
            if (def.fog[r * def.cols + c] === '0') continue;
            c0 = Math.min(c0, c); r0 = Math.min(r0, r); c1 = Math.max(c1, c); r1 = Math.max(r1, r);
        }
        if (c1 < 0) return null;
        return { x: M + (c0 - 0.6) * S, y: M + (r0 - 0.6) * S, w: (c1 - c0 + 2.2) * S, h: (r1 - r0 + 2.2) * S };
    }
    const homeView = () => fitView(knownRect());
    const kMin = () => fitK() * 0.5;
    const kMax = () => Math.max(fitK() * 12, 6);
    function setView(v) { st.view = v; invalidate('view'); }
    let animRaf = 0;
    function animateTo(target, ms = 380) {
        cancelAnimationFrame(animRaf);
        const from = { ...st.view }, t0 = performance.now();
        const step = (now) => {
            const t = clamp((now - t0) / ms, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            setView({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
            if (t < 1) animRaf = requestAnimationFrame(step);
        };
        animRaf = requestAnimationFrame(step);
    }
    function zoomAt(px, py, f) {
        const { k, x, y } = st.view, nk = clamp(k * f, kMin(), kMax());
        const mx = (px - x) / k, my = (py - y) / k;
        setView({ k: nk, x: px - mx * nk, y: py - my * nk });
    }
    function zoomCenter(f) { const fr = freeRect(); zoomAt((fr.l + fr.r) / 2, (fr.t + fr.b) / 2, f); }
    function svgPoint(e) { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function toMap(e) { const [px, py] = svgPoint(e), { k, x, y } = st.view; return [(px - x) / k, (py - y) / k]; }
    function cellOf([mx, my]) {
        if (!st.def) return null;
        const c = Math.floor((mx - M) / S), r = Math.floor((my - M) / S);
        return c >= 0 && r >= 0 && c < st.def.cols && r < st.def.rows ? [c, r] : null;
    }
    const keyAt = p => { const cr = cellOf(p); return cr ? T.keyOf(cr[0], cr[1]) : null; };
    const snap = v => M + Math.round((v - M) / 14) * 14;
    const snapPt = p => [snap(p[0]), snap(p[1])];
    function visibleMapRect() {
        const f = freeRect(), { k, x, y } = st.view;
        return { x: (f.l - x) / k, y: (f.t - y) / k, w: (f.r - f.l) / k, h: (f.b - f.t) / k };
    }
    let viewSaveTimer = null;
    function saveViewSoon() {
        if (!st.mapId) return;
        clearTimeout(viewSaveTimer);
        viewSaveTimer = setTimeout(() => {
            try {
                const f = freeRect(), { k, x, y } = st.view;
                localStorage.setItem('gempire-map-view:' + st.mapId, JSON.stringify({ k: k / fitK(), cx: ((f.l + f.r) / 2 - x) / k, cy: ((f.t + f.b) / 2 - y) / k }));
            } catch {}
        }, 400);
    }
    function restoreView() {
        try {
            const v = JSON.parse(localStorage.getItem('gempire-map-view:' + st.mapId) || 'null');
            if (v && v.k > 0) {
                const f = freeRect(), k = clamp(v.k * fitK(), kMin(), kMax());
                return { k, x: (f.l + f.r) / 2 - v.cx * k, y: (f.t + f.b) / 2 - v.cy * k };
            }
        } catch {}
        return homeView();
    }

    // ---------------- Слой местности ----------------
    let imageKey = '';
    function renderTerrainLayers() {
        const def = st.def;
        const layers = ['L-image', 'L-tones', 'L-edges', 'L-glyphs', 'L-roads', 'L-fogshade', 'L-fogedge', 'L-places', 'L-tterrain'];
        if (!def) { layers.forEach(id => { $(id).innerHTML = ''; }); $('L-grid').setAttribute('d', ''); imageKey = ''; return; }
        const pv = playerView();
        const src = gm && st.preview ? T.playerProjection(def) : def;
        // Пока мастер ведёт кистью — облегчённая отрисовка (без светотени и переходов), в конце мазка — полная
        const out = renderStyled(src, { player: pv, style: mapStyle(), draft: !!(gest && gest.mode === 'brush') });
        const [W, H] = T.mapSize(def);
        const paper = $('L-paper');
        paper.setAttribute('x', M); paper.setAttribute('y', M); paper.setAttribute('width', W - 2 * M); paper.setAttribute('height', H - 2 * M);
        const clip = $('grid-clip-rect');
        clip.setAttribute('width', W - 2 * M); clip.setAttribute('height', H - 2 * M);
        // Подложка-картинка
        const img = def.image;
        const masked = !!(img && pv && /[012]/.test(def.fog));
        const key = img ? JSON.stringify(img) + (masked ? def.fog : '') : '';
        if (key !== imageKey) {
            imageKey = key;
            $('L-image').innerHTML = img && img.url
                ? (masked ? T.fogMask(def, 'img-fog') : '') +
                  `<image href="${esc(img.url)}" x="${img.x}" y="${img.y}" width="${img.w}" height="${img.h}" preserveAspectRatio="none" opacity="${img.opacity ?? 1}"${img.aged !== false ? ' filter="url(#aged)"' : ''}${masked ? ' mask="url(#img-fog)"' : ''} style="mix-blend-mode:multiply"/>`
                : '';
        }
        $('L-tones').innerHTML = out.tones;
        $('L-edges').innerHTML = out.edges;
        $('L-glyphs').innerHTML = out.glyphs;
        $('L-roads').innerHTML = out.roads;
        $('L-fogshade').innerHTML = pv ? '' : out.fogShade;
        $('L-fogedge').innerHTML = out.fogEdge;
        $('L-places').innerHTML = out.places;
        // Сетка
        let g = '';
        for (let i = 0; i <= def.cols; i++) g += `M${M + i * S} ${M}V${M + def.rows * S}`;
        for (let i = 0; i <= def.rows; i++) g += `M${M} ${M + i * S}H${M + def.cols * S}`;
        const grid = $('L-grid');
        grid.setAttribute('d', g);
        grid.setAttribute('stroke-opacity', def.look?.grid ?? 0.14);
        renderTerrainTexts(out.placeNames);
        levelsCache = null;
    }
    // Подписи: буквы и цифры по краю, названия селений
    function renderTerrainTexts(placeNames) {
        const def = st.def;
        if (!def) return;
        if (placeNames == null) placeNames = T.renderPlaceNames(gm && st.preview ? T.playerProjection(def) : def, { player: playerView() });
        let txt = '';
        if (def.look?.coords !== false) {
            for (let c = 0; c < def.cols; c++) txt += `<text class="coord" x="${M + c * S + 14}" y="${M - 12}" text-anchor="middle">${T.colName(c)}</text>`;
            for (let r = 0; r < def.rows; r++) txt += `<text class="coord" x="${M - 10}" y="${M + r * S + 18}" text-anchor="end">${r + 1}</text>`;
        }
        // Двойная рамка вокруг листа, как на гравированных картах
        const w = def.cols * S, h = def.rows * S;
        const frame = `<rect x="${M - 5}" y="${M - 5}" width="${w + 10}" height="${h + 10}" fill="none" stroke="${INK}" stroke-width="0.7" stroke-opacity="0.55"/><rect x="${M}" y="${M}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.6"/>`;
        $('L-tterrain').innerHTML = frame + txt + placeNames;
    }

    let levelsCache = null;
    function cellLevel(c, r) {
        if (!levelsCache) levelsCache = T.terrainLevels(st.def, mapStyle() !== 'sketch');
        return levelsCache[r * st.def.cols + c];
    }

    // ---------------- Пометки ----------------
    function marksOf(kind) {
        const out = [];
        for (const row of st.marks.values()) if (row.kind === kind && visibleRow(row)) out.push(row);
        return out.sort((a, b) => (a.data.t || 0) - (b.data.t || 0));
    }
    function shapePathD(s) {
        const p = s.pts || [];
        if (s.shape === 'circle') {
            const r = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
            return `M${p[0][0] - r} ${p[0][1]}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
        }
        if (s.shape === 'free' && p.length > 2) {
            let d = `M${p[0][0]} ${p[0][1]}`;
            for (let i = 1; i < p.length - 1; i++) d += `Q${p[i][0]} ${p[i][1]} ${((p[i][0] + p[i + 1][0]) / 2).toFixed(1)} ${((p[i][1] + p[i + 1][1]) / 2).toFixed(1)}`;
            return d + `L${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
        }
        return p.map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1]).join('') + (s.shape === 'poly' ? 'Z' : '');
    }
    function shapeLength(s) {
        const p = s.pts || [];
        if (s.shape === 'circle') return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
        let L = 0;
        for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        if (s.shape === 'poly' && p.length > 2) L += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
        return L;
    }
    function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a / 2); }
    function fmtLen(units) {
        const cells = units / S;
        let s = fmtNum(cells) + ' кл.';
        const sc = st.def && st.def.scale;
        if (sc && sc.unit) s += ' · ' + fmtNum(cells * (Number(sc.n) || 1)) + ' ' + sc.unit;
        return s;
    }
    function shapeMeasure(s) {
        if (s.shape === 'circle') return 'радиус ' + fmtLen(shapeLength(s));
        if (s.shape === 'poly') {
            const a = polyArea(s.pts) / (S * S);
            const sc = st.def && st.def.scale, unit = sc && sc.unit && !/дн|час/.test(sc.unit) ? ` · ${fmtNum(a * (Number(sc.n) || 1) ** 2)} кв. ${sc.unit}` : '';
            return `площадь ≈ ${fmtNum(a)} кл.${unit}`;
        }
        return fmtLen(shapeLength(s));
    }
    function shapeAnchor(s) {
        const p = s.pts;
        if (s.shape === 'circle') { const r = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); return [p[0][0], p[0][1] - r - 7]; }
        if (s.shape === 'poly') { const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cy = p.reduce((a, q) => a + q[1], 0) / p.length; return [cx, cy + 4]; }
        if (p.length === 2) return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2 - 7];
        const q = p[Math.floor(p.length / 2)]; return [q[0], q[1] - 7];
    }
    function distToShape(s, [x, y]) {
        const p = s.pts;
        if (s.shape === 'circle') { const r = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), d = Math.hypot(x - p[0][0], y - p[0][1]); return Math.min(Math.abs(d - r), d); }
        const seg = (a, b) => {
            const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1);
            return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
        };
        let best = Infinity;
        for (let i = 1; i < p.length; i++) best = Math.min(best, seg(p[i - 1], p[i]));
        if (s.shape === 'poly' && p.length > 2) best = Math.min(best, seg(p[p.length - 1], p[0]));
        return best;
    }
    // Позиции меток: несколько меток в одной точке раскладываем веером
    // pos — где рисовать значок, names — где подпись (у группы подписи идут столбиком под ней)
    function markerPositions(list) {
        const groups = new Map(), pos = new Map(), names = new Map();
        list.forEach(m => { const k = Math.round(m.data.x) + ':' + Math.round(m.data.y); (groups.get(k) || groups.set(k, []).get(k)).push(m); });
        for (const g of groups.values()) {
            const { x, y } = g[0].data;
            let line = 0;
            g.forEach((m, i) => {
                if (g.length === 1) pos.set(m.id, [x, y]);
                else if (g.length === 2) pos.set(m.id, [x + (i ? 8 : -8), y]);
                else { const a = -Math.PI / 2 + i * 2 * Math.PI / g.length; pos.set(m.id, [x + Math.cos(a) * 10, y + Math.sin(a) * 10]); }
                if (m.data.name) names.set(m.id, [x, y + (g.length > 2 ? 30 : 22) + 11.5 * line++]);
            });
        }
        return { pos, names };
    }
    function zoneOutline(cells) {
        const set = new Set(cells); let d = '';
        for (const key of cells) {
            const [c, r] = T.parseKey(key), x = M + c * S, y = M + r * S;
            if (!set.has(c + ',' + (r - 1))) d += `M${x} ${y}h${S}`;
            if (!set.has(c + ',' + (r + 1))) d += `M${x} ${y + S}h${S}`;
            if (!set.has((c - 1) + ',' + r)) d += `M${x} ${y}v${S}`;
            if (!set.has((c + 1) + ',' + r)) d += `M${x + S} ${y}v${S}`;
        }
        return d;
    }

    // Поваленные деревья в клетках зоны: стволы лежат с востока на запад (комлем с вывороченными корнями на восток),
    // хвоя порыжелая. Раскладка зависит только от клетки
    function fallenTrees(cells) {
        let trunks = '', roots = '', needles = '';
        const f = v => v.toFixed(1);
        for (const k of cells) {
            const [c, r] = T.parseKey(k);
            for (let i = 0; i < 4; i++) {
                const h = j => T.rnd(Math.imul(c + 7, 73856093) ^ Math.imul(r + 3, 19349663) ^ Math.imul(i + 1, 83492791) ^ Math.imul(j + 1, 2654435761));
                const cx = M + c * S + 4 + ((i % 2) + h(1) * 0.9) * (S - 8) / 2, cy = M + r * S + 4 + (Math.floor(i / 2) + h(2) * 0.9) * (S - 8) / 2;
                const a = Math.PI + (h(3) - 0.5) * 0.7, L = 11 + h(4) * 6, ux = Math.cos(a), uy = Math.sin(a);
                const x0 = cx - ux * L / 2, y0 = cy - uy * L / 2, x1 = cx + ux * L / 2, y1 = cy + uy * L / 2;
                trunks += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
                // корневой выворотень у комля
                roots += `M${f(x0 - uy * 3.2)} ${f(y0 + ux * 3.2)}Q${f(x0 - ux * 2.4)} ${f(y0 - uy * 2.4)} ${f(x0 + uy * 3.2)} ${f(y0 - ux * 3.2)}`;
                // ветки с рыжей хвоей ближе к вершине
                for (const t of [0.55, 0.75, 0.92]) {
                    const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t, s = t > 0.9 ? 1.6 : 2.6;
                    needles += `M${f(bx)} ${f(by)}L${f(bx + (ux - uy) * s)} ${f(by + (uy + ux) * s)}M${f(bx)} ${f(by)}L${f(bx + (ux + uy) * s)} ${f(by + (uy - ux) * s)}`;
                }
            }
        }
        return `<path d="${needles}" fill="none" stroke="#B4602A" stroke-width="1.1" stroke-linecap="round"/><path d="${trunks}" fill="none" stroke="#5E3A22" stroke-width="1.7" stroke-linecap="round"/><path d="${roots}" fill="none" stroke="#5E3A22" stroke-width="1" stroke-linecap="round"/>`;
    }
    let markPos = new Map();
    function renderMarks() {
        if (!st.def) { ['L-zones', 'L-shapes', 'L-marks', 'L-tmarks'].forEach(id => { $(id).innerHTML = ''; }); return; }
        // Зоны
        let z = '';
        for (const row of marksOf('zone')) {
            const d = row.data, cells = d.cells || [];
            if (!cells.length) continue;
            let path = '';
            cells.forEach(k => { const [c, r] = T.parseKey(k); path += `M${M + c * S} ${M + r * S}h${S}v${S}h${-S}Z`; });
            if (d.look === 'fallen') {
                // Вывал: на месте леса — поваленные рыжие стволы (закрывают значки под собой, поэтому без бледности)
                z += `<g><path d="${path}" fill="#ECDFC6"/>${fallenTrees(cells)}<path d="${zoneOutline(cells)}" fill="none" stroke="${inkHex(d.ink)}" stroke-width="1.6" stroke-linecap="square"${row.hidden ? ' stroke-dasharray="5 3"' : ''}/></g>`;
                continue;
            }
            z += `<g${row.hidden ? ' class="ghost"' : ''}><path d="${path}" fill="url(#ink-${INKS[d.ink] ? d.ink : 'red'})"/><path d="${zoneOutline(cells)}" fill="none" stroke="${inkHex(d.ink)}" stroke-width="2" stroke-linecap="square"${row.hidden ? ' stroke-dasharray="5 3"' : ''}/></g>`;
        }
        $('L-zones').innerHTML = z;
        // Линии и круги
        let sh = '', shText = '';
        for (const row of marksOf('shape')) {
            const d = row.data, hex = inkHex(d.ink), path = shapePathD(d), selected = st.sel && st.sel.type === 'shape' && st.sel.id === row.id;
            if (selected) sh += `<path d="${path}" fill="none" stroke="${hex}" stroke-opacity="0.22" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
            // fill: 'salt' — белая залитая область (солончак, сухое озеро); рисуется без бледности, скрытая — только пунктиром
            const salt = d.shape === 'poly' && d.fill === 'salt';
            sh += `<g${row.hidden && !salt ? ' class="ghost"' : ''}><path d="${path}" fill="${salt ? '#FBF8EE' : d.shape === 'poly' ? `url(#ink-${INKS[d.ink] ? d.ink : 'red'})` : 'none'}" stroke="${hex}" stroke-width="${salt ? 1.4 : 2.2}" stroke-linecap="round" stroke-linejoin="round"${row.hidden ? ' stroke-dasharray="6 4"' : ''}/></g>`;
            sh += `<path d="${path}" data-sid="${esc(row.id)}" fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" style="pointer-events:stroke;cursor:pointer"/>`;
            const [ax, ay] = shapeAnchor(d);
            const label = [d.name, selected ? shapeMeasure(d) : ''].filter(Boolean).join(' — ');
            if (label) shText += `<text class="shape-name halo" x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" fill="${hex}"${row.hidden ? ' opacity="0.55"' : ''}>${esc(label)}</text>`;
        }
        $('L-shapes').innerHTML = sh;
        // Метки и подписи
        const markers = marksOf('marker');
        const placed = markerPositions(markers);
        markPos = placed.pos;
        let mk = '', mt = '';
        for (const row of markers) {
            const [x, y] = markPos.get(row.id), d = row.data;
            mk += `<g data-mid="${esc(row.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"${row.hidden ? ' class="ghost"' : ''}>` +
                (row.hidden ? `<circle r="12.5" fill="${hexA(PANEL, 0.5)}" stroke="#A8432A" stroke-width="1" stroke-dasharray="2.5 2"/>` : '') +
                markerSvg(d.type) + '</g>';
            const np = placed.names.get(row.id);
            if (np) mt += `<text class="mark-name halo" x="${np[0].toFixed(1)}" y="${np[1].toFixed(1)}"${row.hidden ? ' opacity="0.55"' : ''}>${esc(d.name)}</text>`;
        }
        for (const row of marksOf('label')) {
            const d = row.data, size = LABEL_SIZES[d.size] ? d.size : 'm';
            const dy = size === 'l' ? 6 : 4;
            mk += `<text data-lid="${esc(row.id)}" class="label-${size} halo" x="${d.x}" y="${d.y + dy}"${row.hidden ? ' opacity="0.5"' : ''}>${esc(d.text || '…')}</text>`;
        }
        $('L-marks').innerHTML = mk;
        $('L-tmarks').innerHTML = mt + shText;
    }

    // ---------------- Слой выделения, наведения и черчения ----------------
    function renderUI() {
        if (!st.def) { $('L-under').innerHTML = ''; $('L-ui').innerHTML = ''; return; }
        let under = '', ui = '';
        const k = st.view.k;
        const cellRect = (c, r, style) => `<rect x="${M + c * S}" y="${M + r * S}" width="${S}" height="${S}" ${style}/>`;
        // Кисть рельефа/тумана — показываем, какие клетки закрасятся
        if (st.hover && (st.tool === 'terrain' || st.tool === 'fog') && !st.drawing) {
            brushCells(...T.parseKey(st.hover)).forEach(([c, r]) => { under += cellRect(c, r, `fill="${INK}" fill-opacity="0.1" stroke="${INK}" stroke-width="${1 / k}"`); });
        } else if (st.hover && (!st.sel || st.sel.type !== 'cell' || st.sel.key !== st.hover) && st.tool !== 'draw') {
            const [c, r] = T.parseKey(st.hover);
            under += cellRect(c, r, `fill="${INK}" fill-opacity="0.08" stroke="${INK}" stroke-width="1"`);
        }
        if (st.sel && st.sel.type === 'cell') {
            const [c, r] = T.parseKey(st.sel.key);
            under += cellRect(c, r, `fill="none" stroke="#A8432A" stroke-width="2.2"`);
        }
        if (st.sel && (st.sel.type === 'place')) {
            const p = (st.def.places || []).find(q => q.id === st.sel.id);
            if (p) under += cellRect(p.c, p.r, `fill="none" stroke="#A8432A" stroke-width="2.2" stroke-dasharray="4 3"`);
        }
        if (st.sel && st.sel.type === 'road') {
            const rd = (st.def.roads || []).find(q => q.id === st.sel.id);
            if (rd) under += `<path d="${T.roadPath(rd.cells)}" fill="none" stroke="#A8432A" stroke-opacity="0.35" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        // Черчение (и линейка, которая держится на экране несколько секунд)
        const dr = st.drawing || st.ruler;
        if (dr && dr.kind === 'shape') {
            const hex = inkHex(dr.ink);
            let pts = dr.pts.slice();
            if ((dr.shape === 'path' || dr.shape === 'poly') && dr.cursor) pts = [...pts, dr.cursor];
            const fake = { shape: dr.shape, pts };
            if (pts.length >= 2) {
                if (dr.shape === 'measure') {
                    const [a, b] = pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
                    let ticks = '';
                    for (let t = 0; t <= L + 0.01; t += S) { const x = a[0] + (b[0] - a[0]) * t / L, y = a[1] + (b[1] - a[1]) * t / L; ticks += `M${(x - nx * 4).toFixed(1)} ${(y - ny * 4).toFixed(1)}L${(x + nx * 4).toFixed(1)} ${(y + ny * 4).toFixed(1)}`; }
                    ui += `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="${PANEL}" stroke-width="5" stroke-linecap="round"/><path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}${ticks}" stroke="${INK}" stroke-width="1.3" stroke-linecap="round" fill="none"/>`;
                } else ui += `<path d="${shapePathD(fake)}" fill="${dr.shape === 'poly' && pts.length > 2 ? hexA(hex, 0.08) : 'none'}" stroke="${hex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 4"/>`;
                const [ax, ay] = shapeAnchor(fake);
                ui += `<text class="measure" x="${ax.toFixed(1)}" y="${(ay - 4).toFixed(1)}" fill="${dr.shape === 'measure' ? INK : hex}">${esc(shapeMeasure(fake))}</text>`;
            }
            if (dr.shape === 'path' || dr.shape === 'poly') dr.pts.forEach((p, i) => { ui += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === 0 && dr.shape === 'poly' ? 4.5 : 3}" fill="${PANEL}" stroke="${hex}" stroke-width="1.5"/>`; });
        }
        if (dr && dr.kind === 'road' && dr.cells.length > 1) {
            ui += `<path d="${T.roadPath(dr.cells, 0)}" fill="none" stroke="${dr.road === 'river' ? '#3D5A73' : INK}" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        // Точка привязки при черчении
        if (st.tool === 'draw' && st.hoverPt && !compact()) {
            const p = st.sub.drawMode === 'free' ? st.hoverPt : snapPt(st.hoverPt);
            ui += `<circle cx="${p[0]}" cy="${p[1]}" r="${3 / k + 1.5}" fill="none" stroke="${inkHex(st.sub.ink)}" stroke-width="${1.2 / k + 0.4}"/>`;
        }
        // Сигналы «смотрите сюда»
        st.pings.forEach(p => {
            ui += `<g transform="translate(${p.x} ${p.y})"><circle class="ping-ring" r="6" stroke="${p.color}"/><circle class="ping-ring" r="6" stroke="${p.color}" style="animation-delay:.35s"/><circle r="3.5" fill="${p.color}"/>` +
                (p.who ? `<text class="ping-name halo" y="-12" fill="${p.color}">${esc(p.who)}</text>` : '') + '</g>';
        });
        $('L-under').innerHTML = under;
        $('L-ui').innerHTML = ui;
    }

    // ---------------- Компас и линейка ----------------
    function renderOrnament() {
        const orn = $('gm-orn');
        if (!st.def || st.def.look?.compass === false) { orn.innerHTML = ''; $('gm-compass').innerHTML = ''; return; }
        const k = st.view.k, cellPx = S * k;
        const steps = [1, 2, 5, 10, 20, 50, 100];
        let n = steps.find(s => s * cellPx >= 70) || 100;
        const L = n * cellPx;
        let segs = '';
        const parts = n === 1 ? 2 : n <= 5 ? n : 5;
        for (let i = 0; i < parts; i++) segs += `<rect x="${(5 + i * L / parts).toFixed(1)}" y="4" width="${(L / parts).toFixed(1)}" height="5" fill="${i % 2 ? PANEL : INK}" stroke="${INK}" stroke-width="0.8"/>`;
        const sc = st.def.scale, unit = sc && sc.unit ? ` · ${fmtNum(n * (Number(sc.n) || 1))} ${sc.unit}` : '';
        const rose = [0, 90, 180, 270].map(a => `<g transform="rotate(${a})"><path d="M0 -26L3.8 -3.8L0 0Z" fill="${INK}"/><path d="M0 -26L-3.8 -3.8L0 0Z" fill="${PANEL}" stroke="${INK}" stroke-width="0.7" stroke-linejoin="round"/></g>`).join('') +
            [45, 135, 225, 315].map(a => `<g transform="rotate(${a})"><path d="M0 -15L2.4 -2.4L0 0Z" fill="${INK}"/><path d="M0 -15L-2.4 -2.4L0 0Z" fill="${PANEL}" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round"/></g>`).join('');
        $('gm-compass').innerHTML =
            `<svg width="74" height="78" viewBox="-37 -41 74 78"><circle r="22" fill="${hexA(PANEL, 0.6)}" stroke="${INK}" stroke-width="0.8"/><circle r="18.5" fill="none" stroke="${INK}" stroke-width="0.5" stroke-dasharray="1 2.4"/>${rose}<circle r="1.8" fill="${PANEL}" stroke="${INK}" stroke-width="0.7"/><text y="-30" text-anchor="middle" style="font-family:'Alegreya SC',serif;font-size:12px" fill="${INK}">С</text></svg>`;
        orn.innerHTML = `<div class="gm-scalebar"><svg width="${(L + 10).toFixed(0)}" height="12" aria-hidden="true">${segs}</svg><span>${n} кл.${esc(unit)}</span></div>`;
    }

    // ---------------- Панель инструментов ----------------
    function toolButton(id) {
        const t = TOOLS[id];
        return `<button type="button" class="gm-tool${t.gm ? ' gm-only' : ''}" data-tool="${id}" aria-pressed="${st.tool === id}" title="${t.title} (${t.key.slice(3)})">${toolIcon(id)}<span>${t.label}</span></button>`;
    }
    function renderRail() {
        rail.innerHTML = PLAYER_TOOL_IDS.map(toolButton).join('') + (gm && !st.preview ? '<div class="gm-rail-sep"></div>' + GM_TOOL_IDS.map(toolButton).join('') : '');
    }
    rail.addEventListener('click', e => {
        const b = e.target.closest('[data-tool]');
        if (b) setTool(b.dataset.tool);
    });
    function setTool(id) {
        if (!TOOLS[id] || (TOOLS[id].gm && (!gm || st.preview))) return;
        if (gest && gest.mode !== 'pinch') { abortGesture(gest); gest = null; }
        finishDrawing(false);
        if (st.drawing && st.drawing.kind === 'road') st.drawing = null;
        st.tool = id;
        st.panelTab = 'tool';
        if (id !== 'inspect' && st.sel && st.sel.type !== 'cell' && !(id === 'place' && st.sel.type === 'place') && !(id === 'road' && st.sel.type === 'road') && !(id === 'draw' && st.sel.type === 'shape')) st.sel = null;
        svg.setAttribute('class', 'gm-svg tool-' + id);
        svg.style.cursor = id === 'inspect' ? 'grab' : 'crosshair';
        st.panelCollapsed = false;
        invalidate('rail', 'panel', 'ui', 'marks');
    }

    // ---------------- Заголовок ----------------
    function renderHead() {
        const def = st.def;
        $('gm-title').textContent = def ? (def.title || 'Карта похода') : 'Карта похода';
        let sub = '';
        if (def) {
            sub = def.subtitle || `Сетка ${def.cols} × ${def.rows} клеток`;
            if (def.scale && def.scale.unit && !def.subtitle) sub += ` · клетка — ${fmtNum(Number(def.scale.n) || 1)} ${def.scale.unit}`;
        } else if (!st.loading) sub = gm ? 'Карт пока нет' : 'Мастер ещё не открыл карту';
        $('gm-sub').textContent = sub;
        const bar = $('gm-gmbar');
        if (!gm || !st.mapRow) { bar.innerHTML = ''; return; }
        const cur = st.mapRow.is_current;
        // На телефоне у кнопок остаются только значки (полные подписи — во всплывающей подсказке)
        bar.innerHTML =
            (cur ? '<span class="gm-badge" title="Эту карту сейчас видят игроки">у игроков</span>' : '<button type="button" class="gm-btn small primary" data-act="map-current" data-id="' + esc(st.mapId) + '" title="Показать игрокам эту карту"><span class="lbl">Показать игрокам эту карту</span><span class="sh">Игрокам</span></button>') +
            `<button type="button" class="gm-btn small" data-act="preview" aria-pressed="${st.preview}" title="${st.preview ? 'Выйти из вида игроков' : 'Посмотреть глазами игроков'}">${st.preview ? '◉' : '◎'}<span class="lbl"> ${st.preview ? 'Вид игроков — выйти' : 'Глазами игроков'}</span></button>` +
            (cur ? '<button type="button" class="gm-btn small" data-act="show-view" title="Карта у игроков перейдёт к тому месту, которое видите вы">⌖<span class="lbl"> Показать игрокам это место</span></button>' : '');
    }
    $('gm-gmbar').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) panelAction(b.dataset.act, b); });

    // ---------------- Правка пометок ----------------
    function pushUndo(entry, key = null) {
        if (batch) { batch.items.push(entry); return; }
        if (key && undoStack.length && undoStack[undoStack.length - 1].key === key) return;
        entry.key = key;
        undoStack.push(entry);
        if (undoStack.length > 150) undoStack.shift();
    }
    function beginBatch(key) { batch = { type: 'batch', items: [], key }; }
    function endBatch() {
        const b = batch; batch = null;
        if (b && b.items.length) { undoStack.push(b); if (undoStack.length > 150) undoStack.shift(); }
    }
    function lock(id) { locks.set(id, Date.now()); }
    const isLocked = id => pend.has(id) || inflightIds.has(id) || saveTimers.has(id) || (locks.has(id) && Date.now() - locks.get(id) < 2500);

    // Сохранение пометки: fields — что изменилось. Строка берётся в момент отправки (самая свежая)
    function persistMark(id, fields, delay = 0) {
        lock(id);
        const d = pend.get(id) || new Set();
        fields.forEach(f => d.add(f));
        pend.set(id, d);
        clearTimeout(saveTimers.get(id));
        saveTimers.set(id, setTimeout(() => flushMark(id), delay));
        invalidateFoot();
    }
    async function flushMark(id) {
        saveTimers.delete(id);
        if (inflightIds.has(id)) return; // сохранится сразу после текущего запроса
        const fields = pend.get(id);
        if (!fields) return;
        pend.delete(id);
        const row = st.marks.get(id) || tomb.get(id);
        if (!row) return;
        inflightIds.add(id); inflight++;
        let res;
        try {
            if (fields.has('insert')) {
                const { created_at, updated_at, ...payload } = row;
                res = await store.saveMark({ ...payload, deleted: !!row.deleted });
            } else {
                const patch = {};
                if (fields.has('data')) patch.data = row.data;
                if (fields.has('hidden')) patch.hidden = !!row.hidden;
                if (fields.has('deleted')) patch.deleted = !!row.deleted;
                res = await store.updateMark(id, patch);
            }
        } catch (err) { res = { error: err }; }
        inflightIds.delete(id); inflight--;
        lock(id);
        if (res.error) {
            // Не сохранилось — вернём поля в очередь и повторим позже (пометка остаётся «своей», чужое её не перетрёт)
            const again = pend.get(id) || new Set();
            fields.forEach(f => again.add(f));
            pend.set(id, again);
            const n = (retries.get(id) || 0) + 1;
            retries.set(id, n);
            st.conn.ok = false;
            if (n === 1 || n % 6 === 0) toast(isMissingTable(res.error) ? 'База карты не настроена — пометки пока не сохраняются' : 'Не удалось сохранить, пробую ещё раз: ' + (res.error.message || res.error), true);
            clearTimeout(saveTimers.get(id));
            saveTimers.set(id, setTimeout(() => flushMark(id), Math.min(30000, 1500 * 2 ** Math.min(n - 1, 5))));
        } else {
            retries.delete(id);
            st.conn.ok = true;
            if (row.deleted && !pend.has(id)) tomb.delete(id);
            if (!gm) notifyMarks([id]);
            if (pend.has(id) && !saveTimers.has(id)) saveTimers.set(id, setTimeout(() => flushMark(id), 0));
        }
        invalidateFoot();
    }
    // Игроки сообщают остальным, какие пометки изменились; у мастера это делает пересылка изменений из базы
    let notifyIds = new Set(), notifyTimer = null;
    function notifyMarks(ids) {
        ids.forEach(id => notifyIds.add(id));
        clearTimeout(notifyTimer);
        notifyTimer = setTimeout(() => {
            const list = [...notifyIds]; notifyIds = new Set();
            if (list.length && sub) sub.send({ type: 'marks', mapId: st.mapId, ids: list });
        }, 150);
    }
    // Чужая правка пришла, пока здесь пометку правят, — не теряем её, а сверяемся с базой позже
    const deferred = new Set();
    let deferTimer = null;
    function deferRefetch(id) { deferred.add(id); clearTimeout(deferTimer); deferTimer = setTimeout(runDeferred, 2700); }
    function runDeferred() {
        const ids = [...deferred].filter(id => !isLocked(id));
        ids.forEach(id => deferred.delete(id));
        if (deferred.size) { clearTimeout(deferTimer); deferTimer = setTimeout(runDeferred, 2700); }
        if (ids.length) refetchMarks(ids);
    }
    let refetchIds = new Set(), refetchTimer = null;
    function refetchSoon(ids) {
        ids.forEach(id => refetchIds.add(id));
        clearTimeout(refetchTimer);
        refetchTimer = setTimeout(() => { const list = [...refetchIds]; refetchIds = new Set(); refetchMarks(list); }, 120);
    }
    async function refetchMarks(ids) {
        if (!ids.length || !st.mapId) return;
        const { data, error } = await store.getMarks(ids, { gm });
        if (error) { ids.forEach(deferRefetch); return; }
        const got = new Map(data.map(r => [r.id, r]));
        for (const id of ids) {
            if (isLocked(id)) { deferRefetch(id); continue; }
            const r = got.get(id);
            if (!r || r.deleted || (!gm && r.hidden) || r.map_id !== st.mapId) {
                if (st.marks.delete(id) && st.sel && st.sel.id === id) st.sel = null;
            } else st.marks.set(id, r);
        }
        invalidate('marks', 'panel', 'ui');
    }

    function newMark(kind, data) {
        const row = {
            id: uid('k'), map_id: st.mapId, kind,
            hidden: gm ? st.hideNew.marks : false, deleted: false,
            author: st.author || 'Игрок',
            data: { ...data, t: Date.now(), ...(gm ? { gm: true } : {}) }
        };
        st.marks.set(row.id, row);
        persistMark(row.id, ['insert']);
        pushUndo({ type: 'create', id: row.id });
        invalidate('marks', 'panel');
        return row;
    }
    function patchMark(id, patch, { coalesce = null, delay = 0 } = {}) {
        const row = st.marks.get(id);
        if (!row || !canEdit(row)) return;
        pushUndo({ type: 'update', id, before: { data: row.data, hidden: row.hidden } }, coalesce ? id + ':' + coalesce : null);
        const next = { ...row, data: patch.data ? { ...row.data, ...patch.data } : row.data };
        if ('hidden' in patch) next.hidden = patch.hidden;
        st.marks.set(id, next);
        persistMark(id, [...(patch.data ? ['data'] : []), ...('hidden' in patch ? ['hidden'] : [])], delay);
        invalidate('marks');
    }
    function removeMark(id) {
        const row = st.marks.get(id);
        if (!row || !canEdit(row)) return;
        pushUndo({ type: 'delete', row });
        st.marks.delete(id);
        tomb.set(id, { ...row, deleted: true });
        persistMark(id, ['deleted']);
        if (st.sel && st.sel.type === 'shape' && st.sel.id === id) st.sel = null;
        invalidate('marks', 'panel', 'ui');
    }
    function applyUndo(e) {
        if (e.type === 'batch') { [...e.items].reverse().forEach(applyUndo); return; }
        if (e.type === 'create') {
            const row = st.marks.get(e.id);
            if (row) { st.marks.delete(e.id); tomb.set(e.id, { ...row, deleted: true }); persistMark(e.id, ['deleted']); }
        } else if (e.type === 'delete') {
            const row = { ...e.row, deleted: false };
            tomb.delete(row.id);
            st.marks.set(row.id, row); persistMark(row.id, ['deleted', 'data', 'hidden']);
        } else if (e.type === 'update') {
            const row = st.marks.get(e.id);
            if (row) { const next = { ...row, data: e.before.data, hidden: e.before.hidden }; st.marks.set(e.id, next); persistMark(e.id, ['data', 'hidden']); }
        } else if (e.type === 'def') {
            st.def = e.before; defEdits++; saveMapSoon(150); invalidate('terrain', 'head', 'ui', 'panel');
        }
    }
    function undo() {
        const e = undoStack.pop();
        if (!e) { toast('Отменять нечего'); return; }
        applyUndo(e);
        invalidate('marks', 'panel', 'ui');
        toast('Отменено');
    }

    // ---------------- Правка самой карты (мастер) ----------------
    function editDef(fn, { undoKey = null, delay = 700, layers = ['terrain', 'ui'] } = {}) {
        if (!gm || !st.def) return;
        const before = st.def, next = fn(before);
        if (!next || next === before) return;
        pushUndo({ type: 'def', before }, undoKey);
        st.def = next;
        defEdits++;
        lock('map');
        saveMapSoon(delay);
        invalidate(...layers);
    }
    function saveMapSoon(delay = 700) {
        clearTimeout(mapSaveTimer);
        mapSaveTimer = setTimeout(saveMapNow, delay);
    }
    async function saveMapNow() {
        clearTimeout(mapSaveTimer); mapSaveTimer = null;
        if (!gm || !st.def || !st.mapId) return;
        const rev = uid('rv');
        ownRevs.add(rev);
        const def = { ...st.def, rev };
        st.def = def;
        const mapId = st.mapId;
        const row = { id: mapId, name: def.title || 'Карта', data: T.playerProjection(def), gm_data: def };
        mapSaving++;
        let res;
        try { res = await store.saveMap(row); } catch (err) { res = { error: err }; }
        mapSaving--;
        lock('map');
        if (res.error) {
            st.conn.ok = false;
            mapRetries++;
            if (mapRetries === 1 || mapRetries % 6 === 0) toast('Карта не сохранилась, пробую ещё раз: ' + (res.error.message || res.error), true);
            if (st.mapId === mapId && !mapSaveTimer) saveMapSoon(Math.min(30000, 2000 * 2 ** Math.min(mapRetries, 4)));
        } else {
            mapRetries = 0;
            st.conn.ok = true;
            const i = st.maps.findIndex(m => m.id === mapId);
            if (i >= 0) st.maps[i] = { ...st.maps[i], name: row.name, updated_at: res.updated_at || st.maps[i].updated_at };
            if (st.mapRow && st.mapRow.id === mapId && res.updated_at) st.mapRow = { ...st.mapRow, updated_at: res.updated_at };
            sub && sub.send({ type: 'map', mapId });
        }
        invalidateFoot();
    }
    function brushCells(c, r) {
        const n = st.sub.brush, out = [];
        const rad = n === 1 ? 0 : n === 2 ? 1 : 2;
        for (let dc = -rad; dc <= rad; dc++) for (let dr = -rad; dr <= rad; dr++) {
            if (rad === 2 && Math.abs(dc) + Math.abs(dr) > 3) continue;
            const cc = c + dc, rr = r + dr;
            if (cc >= 0 && rr >= 0 && cc < st.def.cols && rr < st.def.rows) out.push([cc, rr]);
        }
        return out;
    }
    function paintDef(field, cells, ch) {
        let s = st.def[field], changed = false;
        defEdits++;
        const cols = st.def.cols;
        const arr = s.split('');
        cells.forEach(([c, r]) => { const i = r * cols + c; if (arr[i] !== ch) { arr[i] = ch; changed = true; } });
        if (!changed) return false;
        st.def = { ...st.def, [field]: arr.join('') };
        return true;
    }

    // ---------------- Указатель: рисование, перемещение, щипок ----------------
    const ptrs = new Map();
    let gest = null, rulerTimer = null;
    let pressTimer = null;
    const TAP = e => (e.pointerType === 'touch' ? 10 : 5);

    svg.addEventListener('pointerdown', e => {
        if (!st.def) return;
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        // Новое первое касание — значит, прежние пальцы уже отпущены (даже если отпускание потерялось)
        if (e.isPrimary && ptrs.size) { abortGesture(gest); ptrs.clear(); gest = null; }
        try { svg.setPointerCapture(e.pointerId); } catch {}
        ptrs.set(e.pointerId, svgPoint(e));
        hideTip();
        if (ptrs.size === 2) { startPinch(); return; }
        if (ptrs.size > 2) return;
        const panOnly = e.button === 1 || e.button === 2 || spaceDown;
        startGesture(e, panOnly);
    });
    svg.addEventListener('pointermove', e => {
        if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, svgPoint(e));
        if (gest && gest.mode === 'pinch') { movePinch(); return; }
        if (gest && gest.pointerId === e.pointerId) { moveGesture(e); return; }
        if (!e.buttons) hoverMove(e);
    });
    const endPtr = e => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.delete(e.pointerId);
        if (gest && gest.mode === 'pinch') {
            if (ptrs.size === 1) {
                const [id, p] = [...ptrs.entries()][0];
                gest = { mode: 'pan', pointerId: id, sx: p[0], sy: p[1], ox: st.view.x, oy: st.view.y, moved: true };
            } else if (!ptrs.size) gest = null;
            return;
        }
        if (gest && gest.pointerId === e.pointerId) { endGesture(e, e.type === 'pointercancel'); gest = null; }
    };
    svg.addEventListener('pointerup', endPtr);
    svg.addEventListener('pointercancel', endPtr);
    svg.addEventListener('pointerleave', e => { if (!e.buttons) { st.hover = null; st.hoverPt = null; hideTip(); invalidate('ui'); } });
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const [px, py] = svgPoint(e);
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(px, py, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });
    svg.addEventListener('dblclick', e => {
        if (st.tool === 'inspect' && st.def) sendPing(toMap(e));
        if (st.drawing && st.drawing.kind === 'shape' && (st.drawing.shape === 'path' || st.drawing.shape === 'poly')) finishDrawing(true);
    });

    // Жест прервали (второй палец, отмена системой, новое касание): доводим начатое до целого состояния
    function abortGesture(g) {
        clearTimeout(pressTimer);
        if (!g) return;
        switch (g.mode) {
            case 'erase': endBatch(); invalidate('panel'); break;
            case 'zone': if (st.marks.has(g.zoneId)) persistMark(g.zoneId, ['data']); invalidate('panel'); break;
            case 'tool-draw': case 'road': st.drawing = null; break;
            case 'brush': if (st.def !== g.before) { pushUndo({ type: 'def', before: g.before }); saveMapSoon(400); } invalidate('terrain'); break;
            case 'mark': if (g.before) { const row = st.marks.get(g.id); if (row) st.marks.set(g.id, { ...row, data: g.before }); invalidate('marks'); } break;
            case 'place-drag': if (g.moved && st.def !== g.before) { st.def = g.before; defEdits++; invalidate('terrain'); } break;
        }
        invalidate('ui');
    }
    function startPinch() {
        if (gest && gest.mode !== 'pinch') abortGesture(gest);
        const [a, b] = [...ptrs.values()];
        gest = { mode: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...st.view } };
    }
    function movePinch() {
        const [a, b] = [...ptrs.values()];
        if (!a || !b) return;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const { v0, c0 } = gest, k = clamp(v0.k * d / gest.d0, kMin(), kMax());
        const mx = (c0[0] - v0.x) / v0.k, my = (c0[1] - v0.y) / v0.k;
        setView({ k, x: c[0] - mx * k, y: c[1] - my * k });
    }

    function startGesture(e, panOnly) {
        const [px, py] = svgPoint(e), mp = toMap(e);
        const base = { pointerId: e.pointerId, sx: px, sy: py, ox: st.view.x, oy: st.view.y, moved: false, start: mp };
        const tool = st.tool;
        if (panOnly) { gest = { ...base, mode: 'pan' }; return; }
        const markEl = e.target.closest && e.target.closest('[data-mid],[data-lid]');
        if (tool === 'inspect' && markEl) {
            const row = st.marks.get(markEl.dataset.mid || markEl.dataset.lid);
            gest = { ...base, mode: 'mark', id: row && row.id, canDrag: row && canEdit(row) };
            return;
        }
        if (tool === 'inspect' && e.pointerType === 'touch') {
            pressTimer = setTimeout(() => { if (gest && !gest.moved) { gest.pinged = true; sendPing(mp); } }, 600);
        }
        if (tool === 'zone') {
            const key = keyAt(mp);
            if (!key) { gest = { ...base, mode: 'pan' }; return; }
            const zone = activeZone(true);
            const has = (zone.data.cells || []).includes(key);
            pushUndo({ type: 'update', id: zone.id, before: { data: zone.data, hidden: zone.hidden } });
            gest = { ...base, mode: 'zone', zoneId: zone.id, paint: has ? 'remove' : 'add', last: cellOf(mp) };
            paintZone(gest, [cellOf(mp)]);
            return;
        }
        if (tool === 'draw') {
            const mode = st.sub.drawMode;
            if (mode === 'line' || mode === 'circle' || mode === 'measure') {
                st.ruler = null;
                const p = snapPt(mp);
                st.drawing = { kind: 'shape', shape: mode, ink: st.sub.ink, pts: [p, p] };
                gest = { ...base, mode: 'tool-draw' };
                invalidate('ui');
                return;
            }
            if (mode === 'free') {
                st.drawing = { kind: 'shape', shape: 'free', ink: st.sub.ink, pts: [mp.map(v => +v.toFixed(1))] };
                gest = { ...base, mode: 'tool-draw' };
                invalidate('ui');
                return;
            }
            gest = { ...base, mode: 'tap' }; // ломаная/область: точки ставим по нажатию
            return;
        }
        if (tool === 'eraser') {
            beginBatch();
            gest = { ...base, mode: 'erase' };
            eraseAt(mp);
            return;
        }
        if (tool === 'terrain' || tool === 'fog') {
            const cr = cellOf(mp);
            if (!cr) { gest = { ...base, mode: 'pan' }; return; }
            const before = st.def;
            // Кисть рельефа рисует и местность, и её ступень (лесок / лес / чаща); 0 — ступень по глубине
            const tierCh = tool === 'terrain' && T.TER_CHAR[st.sub.terrain] && st.sub.terrain !== 'plains' && st.sub.terrain !== 'plateau' ? String(st.sub.tier || 0) : '0';
            gest = { ...base, mode: 'brush', field: tool === 'terrain' ? 'terrain' : 'fog', ch: tool === 'terrain' ? (T.TER_CHAR[st.sub.terrain] || '.') : String(st.sub.fog), tierCh, last: cr, before };
            brushAt(gest, cr);
            return;
        }
        if (tool === 'place') {
            const cr = cellOf(mp);
            const p = cr && (st.def.places || []).find(q => q.c === cr[0] && q.r === cr[1]);
            gest = { ...base, mode: p ? 'place-drag' : 'tap', placeId: p && p.id, before: st.def };
            return;
        }
        if (tool === 'road') {
            const cr = cellOf(mp);
            if (!cr) { gest = { ...base, mode: 'pan' }; return; }
            gest = { ...base, mode: 'road', cells: [cr] };
            return;
        }
        gest = { ...base, mode: 'tap' };
    }

    function moveGesture(e) {
        const [px, py] = svgPoint(e), mp = toMap(e), g = gest;
        const dist = Math.hypot(px - g.sx, py - g.sy);
        if (dist > TAP(e)) { if (!g.moved) clearTimeout(pressTimer); g.moved = true; }
        st.hoverPt = mp;
        switch (g.mode) {
            case 'pan': case 'tap':
                if (g.moved) { setView({ k: st.view.k, x: g.ox + px - g.sx, y: g.oy + py - g.sy }); st.hover = null; }
                if (g.mode === 'tap' && st.drawing && st.drawing.kind === 'shape') { st.drawing.cursor = snapPt(mp); invalidate('ui'); }
                break;
            case 'mark':
                if (!g.moved) break;
                if (!g.canDrag) { g.mode = 'pan'; break; }
                {
                    const row = st.marks.get(g.id); if (!row) break;
                    const p = st.sub.snap ? (cellOf(mp) ? T.cellCenter(...cellOf(mp)) : null) : mp;
                    if (!p) break;
                    if (!g.before) { g.before = row.data; }
                    st.marks.set(g.id, { ...row, data: { ...row.data, x: +p[0].toFixed(1), y: +p[1].toFixed(1) } });
                    invalidate('marks');
                }
                break;
            case 'zone': {
                const cr = cellOf(mp);
                if (cr && (!g.last || cr[0] !== g.last[0] || cr[1] !== g.last[1])) {
                    paintZone(g, g.last ? T.cellLine(g.last[0], g.last[1], cr[0], cr[1]) : [cr]);
                    g.last = cr;
                }
                break;
            }
            case 'tool-draw': {
                const d = st.drawing; if (!d) break;
                if (d.shape === 'free') {
                    const last = d.pts[d.pts.length - 1];
                    if (Math.hypot(mp[0] - last[0], mp[1] - last[1]) > 2 / st.view.k + 0.8) d.pts.push(mp.map(v => +v.toFixed(1)));
                } else d.pts[1] = snapPt(mp);
                invalidate('ui');
                break;
            }
            case 'erase': eraseAt(mp); break;
            case 'brush': {
                const cr = cellOf(mp);
                if (cr && (cr[0] !== g.last[0] || cr[1] !== g.last[1])) {
                    T.cellLine(g.last[0], g.last[1], cr[0], cr[1]).forEach(c => brushAt(g, c));
                    g.last = cr;
                }
                st.hover = cr ? T.keyOf(cr[0], cr[1]) : null;
                invalidate('ui');
                break;
            }
            case 'place-drag': {
                if (!g.moved) break;
                const cr = cellOf(mp);
                if (!cr) break;
                const places = st.def.places.map(p => p.id === g.placeId ? { ...p, c: cr[0], r: cr[1] } : p);
                st.def = { ...st.def, places };
                defEdits++; lock('map');
                invalidate('terrain', 'ui');
                break;
            }
            case 'road': {
                const cr = cellOf(mp);
                const last = g.cells[g.cells.length - 1];
                if (cr && (cr[0] !== last[0] || cr[1] !== last[1])) {
                    T.cellLine(last[0], last[1], cr[0], cr[1]).slice(1).forEach(c => {
                        const prev = g.cells[g.cells.length - 2];
                        if (prev && prev[0] === c[0] && prev[1] === c[1]) g.cells.pop(); // вернулись назад — укорачиваем
                        else g.cells.push(c);
                    });
                    st.drawing = { kind: 'road', road: st.sub.road, cells: g.cells };
                    invalidate('ui');
                }
                break;
            }
        }
    }

    function endGesture(e, cancelled) {
        clearTimeout(pressTimer);
        const g = gest, mp = toMap(e);
        if (cancelled) { abortGesture(g); return; }
        switch (g.mode) {
            case 'tap':
                if (!g.moved && !g.pinged) tapAt(mp, e);
                break;
            case 'pan':
                break;
            case 'mark':
                if (!g.moved) {
                    const row = st.marks.get(g.id);
                    if (row) select({ type: 'cell', key: keyAt([row.data.x, row.data.y]) }, row.id);
                } else if (g.before) {
                    const row = st.marks.get(g.id);
                    if (row) {
                        pushUndo({ type: 'update', id: row.id, before: { data: g.before, hidden: row.hidden } });
                        persistMark(row.id, ['data']);
                        select({ type: 'cell', key: keyAt([row.data.x, row.data.y]) }, row.id);
                    }
                }
                break;
            case 'zone': {
                if (st.marks.has(g.zoneId)) persistMark(g.zoneId, ['data']);
                invalidate('panel');
                break;
            }
            case 'tool-draw': {
                const d = st.drawing;
                st.drawing = null;
                if (d) {
                    if (d.shape === 'free') {
                        const pts = simplify(d.pts, 1.2);
                        if (pts.length >= 2 && shapeLength({ shape: 'free', pts }) >= 10) commitShape('free', pts);
                    } else if (d.shape === 'measure') {
                        // Линейка: показываем результат несколько секунд и ничего не сохраняем
                        st.ruler = d;
                        clearTimeout(rulerTimer);
                        rulerTimer = setTimeout(() => { st.ruler = null; invalidate('ui'); }, 6000);
                    } else if (Math.hypot(d.pts[1][0] - d.pts[0][0], d.pts[1][1] - d.pts[0][1]) >= 14) commitShape(d.shape, d.pts);
                }
                invalidate('ui');
                break;
            }
            case 'erase': endBatch(); invalidate('panel'); break;
            case 'brush': {
                if (st.def !== g.before) {
                    pushUndo({ type: 'def', before: g.before });
                    saveMapSoon(400);
                }
                invalidate('terrain');
                break;
            }
            case 'place-drag': {
                if (!g.moved) select({ type: 'place', id: g.placeId });
                else if (st.def !== g.before) { pushUndo({ type: 'def', before: g.before }); saveMapSoon(300); select({ type: 'place', id: g.placeId }); }
                break;
            }
            case 'road': {
                st.drawing = null;
                if (!g.moved || g.cells.length < 2) {
                    const cr = cellOf(mp);
                    const rd = cr && [...(st.def.roads || [])].reverse().find(r => r.cells.some(q => q[0] === cr[0] && q[1] === cr[1]));
                    if (rd) select({ type: 'road', id: rd.id }); else { st.sel = null; invalidate('panel', 'ui'); }
                } else {
                    const road = { id: uid('rd'), kind: st.sub.road, cells: g.cells.map(c => [c[0], c[1]]), hidden: st.hideNew.map };
                    editDef(d => ({ ...d, roads: [...(d.roads || []), road] }), { delay: 300 });
                    select({ type: 'road', id: road.id });
                }
                invalidate('ui');
                break;
            }
        }
    }

    function tapAt(mp, e) {
        const key = keyAt(mp), cr = cellOf(mp);
        const tool = st.tool;
        if (tool === 'inspect') {
            const sEl = e.target.closest && e.target.closest('[data-sid]');
            if (sEl) return select({ type: 'shape', id: sEl.dataset.sid });
            const lEl = e.target.closest && e.target.closest('[data-lid]');
            if (lEl) { const row = st.marks.get(lEl.dataset.lid); if (row) return select({ type: 'cell', key: keyAt([row.data.x, row.data.y]) }, row.id); }
            return select(key ? { type: 'cell', key } : null);
        }
        if (!key) { select(null); return; }
        const at = st.sub.snap ? T.cellCenter(cr[0], cr[1]) : mp.map(v => +v.toFixed(1));
        if (tool === 'marker') {
            const row = newMark('marker', { x: at[0], y: at[1], type: st.sub.mtype, name: '', note: '' });
            select({ type: 'cell', key }, row.id, compact() ? null : 'name');
        } else if (tool === 'label') {
            const row = newMark('label', { x: at[0], y: at[1], text: '', size: st.sub.labelSize });
            select({ type: 'cell', key }, row.id, 'text');
        } else if (tool === 'draw') {
            const p = snapPt(mp), d = st.drawing;
            if (!d || d.kind !== 'shape') {
                st.drawing = { kind: 'shape', shape: st.sub.drawMode, ink: st.sub.ink, pts: [p], cursor: p };
            } else {
                const first = d.pts[0], last = d.pts[d.pts.length - 1];
                if (d.shape === 'poly' && d.pts.length > 2 && p[0] === first[0] && p[1] === first[1]) return finishDrawing(true);
                if (p[0] === last[0] && p[1] === last[1]) return finishDrawing(true);
                d.pts.push(p);
            }
            invalidate('ui', 'panel');
        } else if (tool === 'place') {
            const p = { id: uid('pl'), c: cr[0], r: cr[1], type: st.sub.place, name: '', hidden: st.hideNew.map };
            editDef(d => ({ ...d, places: [...(d.places || []), p] }), { delay: 300 });
            select({ type: 'place', id: p.id }, null, 'place-name');
        } else {
            select({ type: 'cell', key });
        }
    }

    function finishDrawing(commit) {
        const d = st.drawing;
        if (!d || d.kind !== 'shape' || (d.shape !== 'path' && d.shape !== 'poly')) { if (d && d.kind === 'shape' && !commit) { st.drawing = null; invalidate('ui'); } return; }
        st.drawing = null;
        const need = d.shape === 'poly' ? 3 : 2;
        if (commit && d.pts.length >= need) commitShape(d.shape, d.pts);
        invalidate('ui', 'panel');
    }
    function commitShape(shape, pts) {
        const row = newMark('shape', { shape, ink: st.sub.ink, pts: pts.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]), name: '', note: '' });
        st.sel = { type: 'shape', id: row.id };
        invalidate('panel', 'marks');
    }
    function simplify(pts, eps) {
        if (pts.length < 3) return pts;
        const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; };
        let idx = 0, max = 0;
        for (let i = 1; i < pts.length - 1; i++) { const d = dist(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
        if (max > eps) return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
        return [pts[0], pts[pts.length - 1]];
    }

    function activeZone(create) {
        let z = st.sub.zone && st.marks.get(st.sub.zone);
        if (z && (!visibleRow(z) || !canEdit(z))) z = null;
        if (!z && create) {
            const used = new Set(marksOf('zone').map(q => q.data.ink));
            const ink = Object.keys(INKS).find(i => !used.has(i)) || 'red';
            const prevBatch = batch; batch = null;
            z = newMark('zone', { name: 'Новая зона', ink, cells: [] });
            batch = prevBatch;
            st.sub.zone = z.id;
        }
        return z;
    }
    function paintZone(g, cells) {
        const z = st.marks.get(g.zoneId);
        if (!z) return;
        const set = new Set(z.data.cells || []);
        let changed = false;
        cells.forEach(cr => {
            if (!cr) return;
            const k = T.keyOf(cr[0], cr[1]);
            if (g.paint === 'add' && !set.has(k)) { set.add(k); changed = true; }
            if (g.paint === 'remove' && set.has(k)) { set.delete(k); changed = true; }
        });
        if (!changed) return;
        st.marks.set(z.id, { ...z, data: { ...z.data, cells: [...set] } });
        lock(z.id);
        invalidate('marks');
    }
    function eraseAt(mp) {
        const key = keyAt(mp), thr = 10 / st.view.k + 3;
        for (const row of [...st.marks.values()]) {
            if (!visibleRow(row) || !canEdit(row)) continue;
            if (row.kind === 'marker' || row.kind === 'label') {
                const near = row.kind === 'marker' && markPos.has(row.id) ? Math.hypot(markPos.get(row.id)[0] - mp[0], markPos.get(row.id)[1] - mp[1]) < 11 : false;
                if (near || keyAt([row.data.x, row.data.y]) === key) removeMark(row.id);
            } else if (row.kind === 'shape') {
                if (distToShape(row.data, mp) < thr) removeMark(row.id);
            } else if (row.kind === 'zone' && key && (row.data.cells || []).includes(key)) {
                patchMark(row.id, { data: { cells: row.data.cells.filter(k => k !== key) } });
            }
        }
    }
    function brushAt(g, [c, r]) {
        const cells = brushCells(c, r);
        let changed = paintDef(g.field, cells, g.ch);
        if (g.field === 'terrain' && st.def.tier) changed = paintDef('tier', cells, g.tierCh) || changed;
        if (changed) { lock('map'); invalidate('terrain', 'ui'); }
    }

    // ---------------- Наведение и подсказки ----------------
    function hoverMove(e) {
        const mp = toMap(e);
        const key = e.pointerType === 'touch' ? null : keyAt(mp);
        st.hoverPt = mp;
        if (st.drawing && st.drawing.kind === 'shape') st.drawing.cursor = snapPt(mp);
        if (key !== st.hover || st.tool === 'draw' || st.drawing) { st.hover = key; invalidate('ui'); }
        const el = e.target.closest && e.target.closest('[data-mid],[data-lid],[data-sid]');
        if (el && e.pointerType !== 'touch') showTip(el, e); else hideTip();
    }
    const tip = $('gm-tip');
    function showTip(el, e) {
        const id = el.dataset.mid || el.dataset.lid || el.dataset.sid;
        const row = st.marks.get(id);
        if (!row) return hideTip();
        const d = row.data;
        let title = '', sub = '';
        if (row.kind === 'marker') { title = d.name || (MARKER_TYPES[d.type] || MARKER_TYPES.note).label; sub = d.name ? (MARKER_TYPES[d.type] || MARKER_TYPES.note).label : ''; }
        else if (row.kind === 'label') title = '«' + (d.text || '…') + '»';
        else { title = d.name || DRAW_MODES[d.shape]?.label || 'Линия'; sub = shapeMeasure(d); }
        const note = (d.note || '').trim();
        tip.innerHTML = `<b>${esc(title)}</b>${sub ? ` <span class="gm-small">· ${esc(sub)}</span>` : ''}` +
            (note ? `<div class="n">${esc(note.length > 400 ? note.slice(0, 400) + '…' : note)}</div>` : '') +
            `<div class="a">${esc(row.author || '')}${row.hidden ? ' · видно только мастеру' : ''}</div>`;
        tip.style.display = 'block';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let x = e.clientX + 16, y = e.clientY + 16;
        if (x + w > innerWidth - 8) x = e.clientX - w - 12;
        if (y + h > innerHeight - 8) y = e.clientY - h - 12;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }

    // ---------------- Выделение ----------------
    let pendingFocus = null;
    function select(sel, focusId = null, focusField = null) {
        st.sel = sel;
        st.focusId = focusId;
        st.panelTab = 'tool';
        st.panelCollapsed = false;
        if (focusId && focusField) pendingFocus = `[data-id="${CSS.escape(focusId)}"][data-f="${focusField}"]`;
        else if (focusField === 'place-name' && sel) pendingFocus = `[data-place="${CSS.escape(sel.id)}"][data-f="name"]`;
        invalidate('panel', 'ui', 'marks');
        // Поле для ввода должно получить фокус сразу, иначе первые нажатия клавиш потеряются
        if (pendingFocus) { cancelAnimationFrame(raf); render(); }
    }
    function focusItem(row) {
        let x, y;
        if (row.kind === 'zone') {
            const cells = row.data.cells || [];
            if (!cells.length) return;
            const pts = cells.map(k => T.cellCenter(...T.parseKey(k)));
            x = pts.reduce((a, p) => a + p[0], 0) / pts.length; y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
            select({ type: 'cell', key: cells[0] }, row.id);
        } else if (row.kind === 'shape') {
            [x, y] = shapeAnchor(row.data);
            select({ type: 'shape', id: row.id });
        } else {
            x = row.data.x; y = row.data.y;
            select({ type: 'cell', key: keyAt([x, y]) }, row.id);
        }
        centerOn(x, y, Math.max(st.view.k, fitK() * 1.8));
    }
    function centerOn(x, y, k = st.view.k) {
        const f = freeRect();
        animateTo({ k, x: (f.l + f.r) / 2 - x * k, y: (f.t + f.b) / 2 - y * k });
    }

    // ---------------- Сигнал «смотрите сюда» ----------------
    function sendPing([x, y]) {
        const p = { type: 'ping', mapId: st.mapId, x: +x.toFixed(1), y: +y.toFixed(1), who: gm ? 'Мастер' : (st.author || 'Игрок'), color: gm ? '#A8432A' : '#3D5A73' };
        showPing(p);
        sub && sub.send(p);
    }
    function showPing(p) {
        const ping = { ...p, id: Math.random() };
        st.pings.push(ping);
        invalidate('ui');
        setTimeout(() => { st.pings = st.pings.filter(q => q !== ping); invalidate('ui'); }, 4300);
    }

    // ---------------- Боковая панель ----------------
    function inkPicker(cur, act, dataId = '') {
        return `<div class="gm-inks">${Object.entries(INKS).map(([id, v]) => `<button type="button" class="gm-ink" data-act="${act}" data-v="${id}"${dataId ? ` data-id="${esc(dataId)}"` : ''} title="${v.name}" aria-label="${v.name}" aria-pressed="${cur === id}"><i style="background:${v.hex}"></i></button>`).join('')}</div>`;
    }
    function hideToggle(row) {
        if (!gm) return '';
        return `<button type="button" class="gm-eye${row.hidden ? ' off' : ''}" data-act="mark-hide" data-id="${esc(row.id)}" title="${row.hidden ? 'Скрыто от игроков — нажмите, чтобы показать' : 'Видно игрокам — нажмите, чтобы скрыть'}">${row.hidden ? EYE_OFF + ' скрыто' : EYE_ON + ' видно'}</button>`;
    }
    function metaLine(row) {
        const when = row.created_at ? new Date(row.created_at) : row.data.t ? new Date(row.data.t) : null;
        const date = when ? when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
        return `<div class="gm-item-meta"><span>${esc(row.author || '')}${date ? ' · ' + date : ''}${!canEdit(row) ? ' · правит мастер' : ''}</span><span class="gm-row">${hideToggle(row)}${canEdit(row) ? `<button type="button" class="gm-x" data-act="mark-del" data-id="${esc(row.id)}" title="Удалить" aria-label="Удалить">×</button>` : ''}</span></div>`;
    }
    const ro = row => canEdit(row) ? '' : ' readonly';
    function hideNewCheck(cat) {
        if (!gm) return '';
        return `<label class="gm-check"><input type="checkbox" data-act="hide-new" data-v="${cat}"${st.hideNew[cat] ? ' checked' : ''}> Новое видно только мне</label>`;
    }

    function toolSection() {
        const t = TOOLS[st.tool], s = st.sub;
        let hint = t.hint + (gm && t.gmHint ? t.gmHint : ''), opts = '';
        if (st.tool === 'marker') {
            opts = `<div class="gm-chips">${Object.entries(MARKER_TYPES).map(([id, m]) => `<button type="button" class="gm-chip" data-act="mtype" data-v="${id}" aria-pressed="${s.mtype === id}">${markerIcon(id)}<span>${m.label}</span></button>`).join('')}</div>` +
                `<label class="gm-check"><input type="checkbox" data-act="snap"${s.snap ? ' checked' : ''}> В центр клетки</label>` + hideNewCheck('marks');
        } else if (st.tool === 'label') {
            opts = `<div class="gm-chips">${Object.entries(LABEL_SIZES).map(([id, l]) => `<button type="button" class="gm-chip text" data-act="lsize" data-v="${id}" aria-pressed="${s.labelSize === id}">${l}</button>`).join('')}</div>` +
                `<label class="gm-check"><input type="checkbox" data-act="snap"${s.snap ? ' checked' : ''}> В центр клетки</label>` + hideNewCheck('marks');
        } else if (st.tool === 'draw') {
            hint = DRAW_MODES[s.drawMode].hint;
            opts = `<div class="gm-chips">${Object.entries(DRAW_MODES).map(([id, m]) => `<button type="button" class="gm-chip" data-act="draw-mode" data-v="${id}" aria-pressed="${s.drawMode === id}"><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><path d="${m.d}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${m.label}</span></button>`).join('')}</div>` +
                inkPicker(s.ink, 'ink') + hideNewCheck('marks');
            if (st.drawing && st.drawing.kind === 'shape' && (st.drawing.shape === 'path' || st.drawing.shape === 'poly')) {
                opts += `<div class="gm-row"><button type="button" class="gm-btn small primary" data-act="draw-finish">Готово</button><button type="button" class="gm-btn small" data-act="draw-back">Убрать точку</button><button type="button" class="gm-btn small" data-act="draw-cancel">Отмена</button></div>`;
            }
        } else if (st.tool === 'zone') {
            const zones = marksOf('zone');
            const az = activeZone(false);
            opts = `<div class="gm-sec" style="gap:6px">${zones.map(z => `
                <div class="gm-zone-row${az && az.id === z.id ? ' active' : ''}" data-act="zone-pick" data-id="${esc(z.id)}">
                    <div class="gm-sq" style="border-color:${inkHex(z.data.ink)};background:${hexA(inkHex(z.data.ink), 0.15)}"></div>
                    <input class="gm-input" data-id="${esc(z.id)}" data-f="name" value="${esc(z.data.name || '')}" aria-label="Название зоны"${ro(z)}>
                    <span class="gm-small">${(z.data.cells || []).length} кл.${z.hidden ? ' · ◌' : ''}</span>
                    ${canEdit(z) ? `<button type="button" class="gm-x" data-act="mark-del" data-id="${esc(z.id)}" aria-label="Удалить зону" title="Удалить зону">×</button>` : '<span></span>'}
                </div>`).join('')}
                <div class="gm-row between">${az ? inkPicker(az.data.ink, 'zone-ink', az.id) : '<span class="gm-small">Сначала закрасьте клетку — появится зона</span>'}<button type="button" class="gm-btn" data-act="zone-add">+ зона</button></div>
                ${az && gm ? `<div class="gm-row">${hideToggle(az)}</div>` : ''}${hideNewCheck('marks')}</div>`;
        } else if (st.tool === 'terrain') {
            const tiles = ['plains', 'plateau', 'forest', 'conifer', 'hills', 'mountains', 'wetwood', 'swamp', 'water'];
            opts = `<div class="gm-chips">${tiles.map(t => `<button type="button" class="gm-chip" data-act="terrain" data-v="${t}" aria-pressed="${s.terrain === t}">${terrainTile(t, 1, 22)}<span>${T.TER_NAMES[t]}</span></button>`).join('')}
                <button type="button" class="gm-chip" data-act="terrain" data-v="blank" aria-pressed="${s.terrain === 'blank'}"><svg width="22" height="22" aria-hidden="true"><rect x="0.5" y="0.5" width="21" height="21" fill="${PAPER}" stroke="rgba(43,38,32,.3)" stroke-dasharray="2 2"/></svg><span>Пусто</span></button></div>` +
                (T.LV[s.terrain] && s.terrain !== 'plains' && s.terrain !== 'plateau' ? `<div class="gm-row"><span class="gm-small">Ступень:</span>${[[0, 'Сама'], ...T.LV[s.terrain].map((n, i) => [i + 1, n])].map(([v, l]) => `<button type="button" class="gm-chip text" data-act="tier" data-v="${v}" aria-pressed="${(s.tier || 0) === v}" title="${v ? 'Нарисовать именно так' : 'По расстоянию от края: у края — первая ступень, в глубине — третья'}">${l}</button>`).join('')}</div>` : '') +
                brushPicker();
        } else if (st.tool === 'fog') {
            opts = `<div class="gm-chips">${FOG_LEVELS.map(f => `<button type="button" class="gm-chip text" data-act="fog" data-v="${f.v}" aria-pressed="${s.fog === f.v}">${f.label}</button>`).join('')}</div>` + brushPicker() +
                `<div class="gm-row"><button type="button" class="gm-btn small" data-act="fog-all" data-v="3">Открыть всё</button><button type="button" class="gm-btn small" data-act="fog-all" data-v="0">Скрыть всё</button><button type="button" class="gm-btn small" data-act="fog-circle">Известный круг</button></div>`;
        } else if (st.tool === 'place') {
            opts = `<div class="gm-chips">${Object.entries(T.PLACE_TYPES).map(([id, p]) => `<button type="button" class="gm-chip" data-act="place-type" data-v="${id}" aria-pressed="${s.place === id}">${placeTile(id, 24)}<span>${p.label}</span></button>`).join('')}</div>` + hideNewCheck('map');
        } else if (st.tool === 'road') {
            opts = `<div class="gm-chips">${Object.entries(ROAD_KINDS).map(([id, l]) => `<button type="button" class="gm-chip text" data-act="road-kind" data-v="${id}" aria-pressed="${s.road === id}">${l}</button>`).join('')}</div>` + hideNewCheck('map') +
                `<div class="gm-row"><button type="button" class="gm-btn small" data-act="auto-trails">Тропы между селениями</button></div>`;
        }
        const undoBtn = undoStack.length ? `<button type="button" class="gm-btn small" data-act="undo" title="Отменить последнее действие (Ctrl+Z)">↶ Отменить</button>` : '';
        const short = compact() && st.sel;
        return `<div class="gm-sec"><div class="gm-row between"><div class="gm-kicker red">${esc(t.title)}</div>${undoBtn}</div>${short ? '' : `<p class="gm-hint">${esc(hint)}</p>`}${opts}</div>`;
    }
    function brushPicker() {
        return `<div class="gm-row"><span class="gm-small">Кисть:</span>${[[1, '1 клетка'], [2, '3 × 3'], [3, 'большая']].map(([v, l]) => `<button type="button" class="gm-chip text" data-act="brush" data-v="${v}" aria-pressed="${st.sub.brush === v}">${l}</button>`).join('')}</div>`;
    }
    const mapStyle = () => (st.def && STYLES[st.def.look?.style]) ? st.def.look.style : 'sketch';
    function terrainTile(t, l, size = 30) {
        const { fill, parts } = legendTile(mapStyle(), t, l, (st.def && st.def.look) || {});
        return `<svg width="${size}" height="${size}" viewBox="-15 -15 30 30" aria-hidden="true" style="display:block"><rect x="-15" y="-15" width="30" height="30" fill="${fill}"/>${parts.map(p => `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.thin ? 0.5 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
    }
    function placeTile(type, size = 30) {
        const parts = T.placeGlyph(type, 0, 1, 0.95);
        return `<svg width="${size}" height="${size}" viewBox="-15 -15 30 30" aria-hidden="true" style="display:block"><rect x="-15" y="-15" width="30" height="30" fill="#F4EDDD"/>${parts.map(p => `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
    }

    function markerCard(row) {
        const d = row.data, mt = MARKER_TYPES[d.type] || MARKER_TYPES.note;
        const types = canEdit(row) ? `<div class="gm-chips">${Object.entries(MARKER_TYPES).map(([id, m]) => `<button type="button" class="gm-chip" style="min-height:30px;padding:3px 4px" data-act="mark-type" data-id="${esc(row.id)}" data-v="${id}" aria-pressed="${d.type === id}" title="${m.label}" aria-label="${m.label}">${markerIcon(id, 20)}</button>`).join('')}</div>` : '';
        return `<div class="gm-item${st.focusId === row.id ? ' focus' : ''}">
            <div class="gm-item-head">${markerIcon(d.type)}<input class="gm-input" data-id="${esc(row.id)}" data-f="name" value="${esc(d.name || '')}" placeholder="${esc(mt.label)} — название"${ro(row)} aria-label="Название метки"><span></span></div>
            <textarea class="gm-note" data-id="${esc(row.id)}" data-f="note" placeholder="Заметка к метке…" rows="2"${ro(row)} aria-label="Заметка">${esc(d.note || '')}</textarea>
            ${st.focusId === row.id ? types : ''}
            ${metaLine(row)}
        </div>`;
    }
    function labelCard(row) {
        const d = row.data;
        return `<div class="gm-item${st.focusId === row.id ? ' focus' : ''}">
            <div class="gm-item-head"><span style="font-family:'Alegreya SC',serif;font-size:15px;color:var(--label);text-align:center">Аа</span><input class="gm-input" style="font-style:italic;color:var(--label)" data-id="${esc(row.id)}" data-f="text" value="${esc(d.text || '')}" placeholder="Текст подписи"${ro(row)} aria-label="Текст подписи"><span></span></div>
            ${canEdit(row) ? `<div class="gm-chips">${Object.entries(LABEL_SIZES).map(([id, l]) => `<button type="button" class="gm-chip text" style="min-height:28px;padding:2px 8px" data-act="label-size" data-id="${esc(row.id)}" data-v="${id}" aria-pressed="${(d.size || 'm') === id}">${l}</button>`).join('')}</div>` : ''}
            ${metaLine(row)}
        </div>`;
    }
    function shapeCard(row) {
        const d = row.data, mode = DRAW_MODES[d.shape] || DRAW_MODES.line;
        return `<div class="gm-sec">
            <div class="gm-row between"><div class="gm-coord" style="font-size:22px">${esc(mode.label)}</div><button type="button" class="gm-x" data-act="clear-sel" aria-label="Закрыть">×</button></div>
            <div class="gm-small" style="font-size:15px">${esc(shapeMeasure(d))}</div>
            <input class="gm-input" data-id="${esc(row.id)}" data-f="name" value="${esc(d.name || '')}" placeholder="Название (видно на карте)"${ro(row)} aria-label="Название линии">
            <textarea class="gm-note" data-id="${esc(row.id)}" data-f="note" placeholder="Заметка…" rows="2"${ro(row)} aria-label="Заметка">${esc(d.note || '')}</textarea>
            ${canEdit(row) ? inkPicker(d.ink, 'shape-ink', row.id) : ''}
            ${metaLine(row)}
        </div>`;
    }
    function placeCard(p) {
        const pt = T.PLACE_TYPES[p.type] || T.PLACE_TYPES.village;
        return `<div class="gm-sec">
            <div class="gm-row between"><div class="gm-coord">${T.coordName(p.c, p.r)}</div><button type="button" class="gm-x" data-act="clear-sel" aria-label="Закрыть">×</button></div>
            <div class="gm-row">${placeTile(p.type, 30)}<input class="gm-input" style="flex:1" data-place="${esc(p.id)}" data-f="name" value="${esc(p.name || '')}" placeholder="${esc(pt.label)} — название" aria-label="Название"></div>
            <textarea class="gm-note" data-place="${esc(p.id)}" data-f="note" placeholder="Заметка мастера — игроки её не видят…" rows="2" aria-label="Заметка к селению">${esc(p.note || '')}</textarea>
            <div class="gm-chips">${Object.entries(T.PLACE_TYPES).map(([id, q]) => `<button type="button" class="gm-chip" style="min-height:30px;padding:3px" data-act="place-set-type" data-id="${esc(p.id)}" data-v="${id}" aria-pressed="${p.type === id}" title="${q.label}" aria-label="${q.label}">${placeTile(id, 22)}</button>`).join('')}</div>
            <div class="gm-item-meta"><span>${p.hidden ? 'Игроки не видят' : (T.fogAt(st.def, p.c, p.r) === 0 ? 'Под туманом — игроки не видят' : 'Видно игрокам')}</span><span class="gm-row">
                <button type="button" class="gm-eye${p.hidden ? ' off' : ''}" data-act="place-hide" data-id="${esc(p.id)}">${p.hidden ? EYE_OFF + ' скрыто' : EYE_ON + ' видно'}</button>
                <button type="button" class="gm-x" data-act="place-del" data-id="${esc(p.id)}" title="Убрать" aria-label="Убрать">×</button></span></div>
        </div>`;
    }
    function roadCard(rd) {
        return `<div class="gm-sec">
            <div class="gm-row between"><div class="gm-coord" style="font-size:22px">${ROAD_KINDS[rd.kind] || 'Тропа'}</div><button type="button" class="gm-x" data-act="clear-sel" aria-label="Закрыть">×</button></div>
            <div class="gm-small" style="font-size:15px">${T.coordName(...rd.cells[0])} → ${T.coordName(...rd.cells[rd.cells.length - 1])} · ${fmtLen(roadLength(rd.cells))}</div>
            <div class="gm-chips">${Object.entries(ROAD_KINDS).map(([id, l]) => `<button type="button" class="gm-chip text" data-act="road-set-kind" data-id="${esc(rd.id)}" data-v="${id}" aria-pressed="${rd.kind === id}">${l}</button>`).join('')}</div>
            <div class="gm-item-meta"><span>${rd.hidden ? 'Игроки не видят' : 'Видно игрокам (кроме участков под туманом)'}</span><span class="gm-row">
                <button type="button" class="gm-eye${rd.hidden ? ' off' : ''}" data-act="road-hide" data-id="${esc(rd.id)}">${rd.hidden ? EYE_OFF + ' скрыто' : EYE_ON + ' видно'}</button>
                <button type="button" class="gm-x" data-act="road-del" data-id="${esc(rd.id)}" title="Убрать" aria-label="Убрать">×</button></span></div>
        </div>`;
    }
    function roadLength(cells) { let L = 0; for (let i = 1; i < cells.length; i++) L += Math.hypot(cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]) * S; return L; }

    function cellCard(key) {
        const [c, r] = T.parseKey(key), def = st.def;
        const fog = T.fogAt(def, c, r), pv = playerView();
        const hiddenCell = pv && fog === 0;
        const t = hiddenCell ? null : T.terAt(gm && st.preview ? T.playerProjection(def) : def, c, r);
        const lvl = t ? cellLevel(c, r) : 0;
        const terrain = hiddenCell ? 'Неизведанные земли' : t ? (pv && fog < 3 ? 'Предположительно: ' : '') + T.LV[t][lvl].toLowerCase().replace(/^./, ch => ch.toUpperCase()) : 'Пустая клетка';
        const certainty = hiddenCell ? 'за пределами известного' : gm && !st.preview ? 'Игрокам: ' + T.FOG_NAMES[fog] : T.FOG_NAMES[fog];
        const feats = [];
        const place = (def.places || []).find(p => p.c === c && p.r === r && !(pv && (p.hidden || fog === 0)));
        if (place) feats.push(gm && !st.preview ? `<button type="button" class="gm-jrow" style="grid-template-columns:22px 1fr" data-act="pick-place" data-id="${esc(place.id)}">${placeTile(place.type, 22)}<span class="t">${esc((T.PLACE_TYPES[place.type] || {}).label || '')}${place.name ? ' ' + esc(place.name) : ''}${place.hidden ? ' <small>· скрыто</small>' : ''}</span></button>` + (place.note ? `<div class="gm-small" style="font-size:14px;white-space:pre-wrap">${esc(place.note)}</div>` : '')
            : `<div style="font-size:15px;font-style:italic">${esc((T.PLACE_TYPES[place.type] || {}).label || '')} ${esc(place.name || '')}</div>`);
        if (!hiddenCell) (def.roads || []).filter(rd => !(pv && rd.hidden) && rd.cells.some(q => q[0] === c && q[1] === r)).forEach(rd => {
            feats.push(`<div style="font-size:15px;font-style:italic">Через клетку ${rd.kind === 'river' ? 'течёт река' : rd.kind === 'road' ? 'идёт дорога' : 'идёт тропа'}${gm && rd.hidden && !st.preview ? ' (скрыта)' : ''}</div>`);
        });
        const zones = marksOf('zone').filter(z => (z.data.cells || []).includes(key));
        const markers = marksOf('marker').filter(m => keyAt([m.data.x, m.data.y]) === key);
        const labels = marksOf('label').filter(m => keyAt([m.data.x, m.data.y]) === key);
        const [cx, cy] = T.cellCenter(c, r);
        const shapes = marksOf('shape').filter(s => distToShape(s.data, [cx, cy]) < S * 0.6);
        return `<div class="gm-sec" style="gap:10px">
            <div class="gm-row between" style="align-items:baseline"><div class="gm-coord">${T.coordName(c, r)}</div><button type="button" class="gm-x" data-act="clear-sel" title="Снять выделение (Esc)" aria-label="Снять выделение">×</button></div>
            <div class="gm-row" style="gap:10px;flex-wrap:nowrap"><div class="gm-swatch">${t ? terrainTile(t, lvl, 30) : `<svg width="30" height="30"><rect width="30" height="30" fill="${PAPER}"/></svg>`}</div>
                <div style="display:flex;flex-direction:column;font-size:15px"><span>${esc(terrain)}</span><span class="gm-small">${esc(certainty)}</span></div></div>
            ${feats.join('')}
            ${zones.map(z => `<div class="gm-row" style="font-size:14px"><div class="gm-sq" style="width:12px;height:12px;border-color:${inkHex(z.data.ink)};background:${hexA(inkHex(z.data.ink), 0.15)}"></div><span>${esc(z.data.name || 'Зона')}</span>${z.hidden ? '<span class="gm-small">· скрыто</span>' : ''}</div>`).join('')}
            ${shapes.map(s => `<button type="button" class="gm-jrow" style="grid-template-columns:22px 1fr" data-act="pick-shape" data-id="${esc(s.id)}"><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><path d="${(DRAW_MODES[s.data.shape] || DRAW_MODES.line).d}" fill="none" stroke="${inkHex(s.data.ink)}" stroke-width="1.6" stroke-linecap="round"/></svg><span class="t">${esc(s.data.name || (DRAW_MODES[s.data.shape] || DRAW_MODES.line).label)} <small>· ${esc(shapeMeasure(s.data))}</small></span></button>`).join('')}
            <div>${markers.map(markerCard).join('')}${labels.map(labelCard).join('')}</div>
            <div class="gm-row"><button type="button" class="gm-btn small" data-act="add-here" data-v="marker">+ метка здесь</button><button type="button" class="gm-btn small" data-act="add-here" data-v="label">+ подпись</button></div>
        </div>`;
    }

    function journalSection() {
        const rows = [...st.marks.values()].filter(r => visibleRow(r) && (r.kind === 'marker' || r.kind === 'label' || (r.kind === 'shape' && r.data.name) || (r.kind === 'zone' && (r.data.cells || []).length)))
            .sort((a, b) => (a.data.t || 0) - (b.data.t || 0));
        const item = r => {
            const d = r.data;
            let coord = '', icon = '', title = '';
            if (r.kind === 'marker') { coord = T.coordName(...cellOf([d.x, d.y]) || [0, 0]); icon = markerIcon(d.type); title = esc(d.name || (MARKER_TYPES[d.type] || MARKER_TYPES.note).label) + (d.note ? ' <small>· заметка</small>' : ''); }
            else if (r.kind === 'label') { coord = T.coordName(...cellOf([d.x, d.y]) || [0, 0]); icon = '<span style="font-family:\'Alegreya SC\',serif;color:var(--label);text-align:center;display:block">Аа</span>'; title = `<i>«${esc(d.text || '…')}»</i>`; }
            else if (r.kind === 'shape') { const p = cellOf(shapeAnchor(d)); coord = p ? T.coordName(...p) : ''; icon = `<svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true"><path d="${(DRAW_MODES[d.shape] || DRAW_MODES.line).d}" fill="none" stroke="${inkHex(d.ink)}" stroke-width="1.6" stroke-linecap="round"/></svg>`; title = esc(d.name); }
            else { coord = T.coordName(...T.parseKey(d.cells[0])); icon = `<div class="gm-sq" style="margin:auto;width:14px;height:14px;border-color:${inkHex(d.ink)};background:${hexA(inkHex(d.ink), 0.15)}"></div>`; title = esc(d.name || 'Зона') + ` <small>· ${d.cells.length} кл.</small>`; }
            return `<button type="button" class="gm-jrow" data-act="focus" data-id="${esc(r.id)}"><span class="c">${coord}</span>${icon}<span class="t">${title}${r.hidden ? ' <small>· скрыто</small>' : ''}</span></button>`;
        };
        return `<div class="gm-sec"><div class="gm-kicker">${gm ? 'Пометки на карте' : 'Пометки отряда'}</div>
            <div class="gm-journal">${rows.length ? rows.map(item).join('') : '<span class="gm-small" style="font-size:15px">Пока пусто</span>'}</div></div>`;
    }
    function legendSection() {
        const def = st.def, pv = playerView();
        const src = gm && st.preview ? T.playerProjection(def) : def;
        const present = new Set();
        for (let i = 0; i < src.terrain.length; i++) { const t = T.TER_CODES[src.terrain[i]]; if (t && (!pv || src.fog[i] !== '0')) present.add(t); }
        const placeTypes = [...new Set((src.places || []).filter(p => !(pv && p.hidden)).map(p => p.type))];
        const roadKinds = [...new Set((src.roads || []).filter(r => !(pv && r.hidden)).map(r => r.kind || 'trail'))];
        const roadSample = { trail: `<path d="M-12 7C-6 -4 2 8 12 -6" fill="none" stroke="${PANEL}" stroke-width="2.6"/><path d="M-12 7C-6 -4 2 8 12 -6" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 3"/>`,
            road: `<path d="M-12 7C-6 -4 2 8 12 -6" fill="none" stroke="${INK}" stroke-width="4"/><path d="M-12 7C-6 -4 2 8 12 -6" fill="none" stroke="${PANEL}" stroke-width="2"/>`,
            river: `<path d="M-12 7C-6 -4 2 8 12 -6" fill="none" stroke="#3D5A73" stroke-width="2.2" stroke-linecap="round"/>` };
        const rows = [
            ...placeTypes.map(t => `<div class="gm-legend-row"><span class="tiles">${placeTile(t)}</span><span>${(T.PLACE_TYPES[t] || {}).label || ''}</span></div>`),
            ...roadKinds.map(k => `<div class="gm-legend-row"><span class="tiles"><svg width="30" height="30" viewBox="-15 -15 30 30"><rect x="-15" y="-15" width="30" height="30" fill="#F4EDDD"/>${roadSample[k] || roadSample.trail}</svg></span><span>${ROAD_KINDS[k] || 'Тропа'}</span></div>`),
            ...(present.has('plateau') ? [`<div class="gm-legend-row"><span class="tiles">${terrainTile('plateau', 0)}</span><span>Плато — ровный верх, по краю обрыв</span></div>`] : []),
            ...['forest', 'conifer', 'hills', 'mountains', 'wetwood', 'swamp', 'water'].filter(t => present.has(t)).map(t => `<div class="gm-legend-row"><span class="tiles">${[0, 1, 2].map(l => terrainTile(t, l)).join('')}</span><span>${T.LV[t].join(' · ')}</span></div>`)
        ];
        if (def.fog.includes('0') || def.fog.includes('1') || def.fog.includes('2')) {
            rows.push(`<div class="gm-legend-row"><span class="tiles"><svg width="30" height="30" viewBox="0 0 30 30"><rect width="30" height="30" fill="#F4EDDD"/><path d="M0 15H30" stroke="${INK}" stroke-width="1.2" stroke-dasharray="5 3"/></svg></span><span>Граница известных земель</span></div>`);
        }
        if (!rows.length) return '';
        return `<div class="gm-sec" style="padding-top:6px"><div class="gm-kicker">Местность</div><div class="gm-sec" style="gap:6px">${rows.join('')}</div></div>`;
    }

    function connLine() {
        let color, label;
        if (store.kind === 'local') { color = '#C99A3A'; label = 'Демо: всё хранится только в этом браузере'; }
        else if (st.conn.ok === false) { color = '#A8432A'; label = 'Нет связи с базой'; }
        else if (st.conn.realtime) { color = '#4F6B3A'; label = 'Изменения видны сразу'; }
        else if (st.conn.polling) { color = '#C99A3A'; label = 'Обновления раз в 5 секунд'; }
        else { color = '#C99A3A'; label = 'Подключение…'; }
        const names = [...new Set(st.online.map(p => p && p.name).filter(Boolean))];
        const here = names.length > 1 ? `<div>Сейчас на карте: ${names.map(n => esc(n)).join(', ')}</div>` : '';
        return `<span class="gm-conn"><i style="background:${color}"></i>${label}${inflight || pend.size || mapSaveTimer || mapSaving ? ' · сохраняю…' : ''}</span>${here}`;
    }
    let footTimer = null;
    function invalidateFoot() {
        clearTimeout(footTimer);
        footTimer = setTimeout(() => { const f = $('gm-foot-conn'); if (f) f.innerHTML = connLine(); else invalidate('panel'); }, 50);
    }
    function footSection() {
        if (gm) {
            return `<div class="gm-foot"><div id="gm-foot-conn">${connLine()}</div>
                <div class="gm-row"><button type="button" class="gm-btn small" data-act="copy-player-link">Ссылка для игроков</button><a href="master.html" style="font-size:13px">Мастер-пульт</a></div></div>`;
        }
        return `<div class="gm-foot"><div id="gm-foot-conn">${connLine()}</div>
            <div class="gm-row between"><span>Подпись: <b style="font-weight:500;color:var(--ink)">${esc(st.author || 'Игрок')}</b></span>${charId ? `<a href="index.html?id=${encodeURIComponent(charId)}">Лист персонажа</a>` : `<button type="button" class="gm-btn small" data-act="rename">Изменить</button>`}</div></div>`;
    }

    // --- Вкладка «Карта» (мастер) ---
    function mapTab() {
        const def = st.def;
        const maps = st.maps.map(m => `<div class="gm-maprow${m.id === st.mapId ? ' open' : ''}">
            <div><b>${esc(m.name || 'Карта')}</b>${m.is_current ? '<span class="gm-badge">у игроков</span>' : ''}</div>
            <div class="gm-row">${m.id !== st.mapId ? `<button type="button" class="gm-btn small" data-act="map-open" data-id="${esc(m.id)}">Открыть</button>` : ''}${!m.is_current ? `<button type="button" class="gm-btn small" data-act="map-current" data-id="${esc(m.id)}" title="Игроки увидят эту карту">Игрокам</button>` : ''}</div>
        </div>`).join('');
        const newForm = st.newMapForm ? `<div class="gm-sec" style="border:1px dashed rgba(43,38,32,.4);padding:10px">
            <label class="gm-field"><span>Название</span><input class="gm-input" id="nm-title" value="${esc(fv('nm-title', 'Новая карта'))}"></label>
            <div class="gm-row"><label class="gm-field"><span>Столбцов</span><input class="gm-input num" id="nm-cols" type="number" min="4" max="120" value="${esc(fv('nm-cols', '25'))}"></label><span style="padding-top:14px">×</span><label class="gm-field"><span>Строк</span><input class="gm-input num" id="nm-rows" type="number" min="4" max="120" value="${esc(fv('nm-rows', '25'))}"></label></div>
            <label class="gm-field"><span>Основа</span><select class="gm-select" id="nm-base">${[['random', 'Случайная местность, как в эскизе'], ['plains', 'Равнина — нарисую сам'], ['blank', 'Пустой лист — для своей картинки'], ...Object.entries(PRESETS).map(([k, v]) => ['preset:' + k, v])].map(([v, l]) => `<option value="${v}"${fv('nm-base', 'random') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <div class="gm-row"><button type="button" class="gm-btn primary" data-act="map-create">Создать</button><button type="button" class="gm-btn" data-act="map-new-cancel">Отмена</button></div></div>` : '';
        const importBtn = '<label class="gm-btn small" style="cursor:pointer">Из файла<input type="file" accept=".json,application/json" data-act="import" hidden></label>';
        if (!def) return `<div class="gm-sec"><div class="gm-kicker red">Карты</div>${maps}${newForm || `<div class="gm-row"><button type="button" class="gm-btn" data-act="map-new">+ Новая карта</button>${importBtn}</div>`}</div>`;
        const img = def.image;
        const imgScale = img ? Math.round(img.w / (def.cols * S) * 100) : 100;
        return `<div class="gm-sec"><div class="gm-kicker red">Карты</div>${maps}${newForm || '<div class="gm-row"><button type="button" class="gm-btn" data-act="map-new">+ Новая карта</button></div>'}</div>
        <div class="gm-divider"></div>
        <div class="gm-sec"><div class="gm-kicker">Эта карта</div>
            <label class="gm-field"><span>Название</span><input class="gm-input" data-def="title" value="${esc(def.title || '')}"></label>
            <label class="gm-field"><span>Подзаголовок (пусто — размер и масштаб)</span><input class="gm-input" data-def="subtitle" value="${esc(def.subtitle || '')}" placeholder="Известный круг земель"></label>
        </div>
        <div class="gm-sec"><div class="gm-kicker">Масштаб</div>
            <div class="gm-row"><span>1 клетка =</span><input class="gm-input num" data-def="scale-n" type="number" min="0" step="any" value="${esc(def.scale?.n ?? 1)}" aria-label="Сколько в одной клетке"><input class="gm-input" style="width:110px" data-def="scale-unit" list="gm-units" value="${esc(def.scale?.unit || '')}" placeholder="км, вёрст…" aria-label="Единица"></div>
            <datalist id="gm-units">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
            <span class="gm-small">Линии и круги показывают длину в клетках и в этих единицах.</span>
        </div>
        <div class="gm-sec"><div class="gm-kicker">Размер сетки</div>
            <div class="gm-row"><input class="gm-input num" id="sz-cols" type="number" min="4" max="120" value="${esc(fv('sz-cols', def.cols))}" aria-label="Столбцов"><span>×</span><input class="gm-input num" id="sz-rows" type="number" min="4" max="120" value="${esc(fv('sz-rows', def.rows))}" aria-label="Строк"><button type="button" class="gm-btn small" data-act="resize">Изменить</button></div>
            <div class="gm-row"><span class="gm-small">Добавить с краю:</span><button type="button" class="gm-btn small" data-act="grow" data-v="l" title="Столбец слева">← 1</button><button type="button" class="gm-btn small" data-act="grow" data-v="t" title="Строка сверху">↑ 1</button><button type="button" class="gm-btn small" data-act="grow" data-v="r" title="Столбец справа">1 →</button><button type="button" class="gm-btn small" data-act="grow" data-v="b" title="Строка снизу">1 ↓</button></div>
        </div>
        <div class="gm-sec"><div class="gm-kicker">Подложка-картинка</div>
            <div class="gm-row"><label class="gm-btn small" style="cursor:pointer">Загрузить файл<input type="file" accept="image/*" data-act="img-file" hidden></label><span class="gm-small">или ссылка:</span></div>
            <div class="gm-row"><input class="gm-input" style="flex:1" id="img-url" placeholder="https://…/map.jpg" value="${esc(fv('img-url', img && !String(img.url).startsWith('data:') ? img.url : ''))}"><button type="button" class="gm-btn small" data-act="img-url">ОК</button></div>
            ${img ? `
            <label class="gm-field"><span>Прозрачность рисунка: ${Math.round((img.opacity ?? 1) * 100)}%</span><input type="range" class="gm-range" min="10" max="100" value="${Math.round((img.opacity ?? 1) * 100)}" data-act="img-opacity"></label>
            <label class="gm-field"><span>Размер относительно сетки: ${imgScale}%</span><input type="range" class="gm-range" min="20" max="400" value="${imgScale}" data-act="img-scale"></label>
            <div class="gm-row"><span class="gm-small">Сдвиг:</span>${[['←', -1, 0], ['→', 1, 0], ['↑', 0, -1], ['↓', 0, 1]].map(([l, dx, dy]) => `<button type="button" class="gm-btn small" data-act="img-move" data-dx="${dx}" data-dy="${dy}" title="На четверть клетки">${l}</button>`).join('')}</div>
            <label class="gm-check"><input type="checkbox" data-act="img-aged"${img.aged !== false ? ' checked' : ''}> Состарить под пергамент</label>
            <div class="gm-row"><button type="button" class="gm-btn small" data-act="img-fit">Растянуть по сетке</button><button type="button" class="gm-btn small" data-act="img-grid">Сетку — по картинке</button><button type="button" class="gm-btn small danger" data-act="img-remove">Убрать</button></div>` : '<span class="gm-small">Своя нарисованная карта ляжет под сетку; поверх можно рисовать рельеф или оставить пустые клетки.</span>'}
        </div>
        <div class="gm-sec"><div class="gm-kicker">Оформление</div>
            <div class="gm-field"><span>Стиль местности: ${esc(STYLES[mapStyle()].hint)}</span>
                <div class="gm-chips">${Object.entries(STYLES).map(([id, v]) => `<button type="button" class="gm-chip text" data-act="style" data-v="${id}" aria-pressed="${mapStyle() === id}">${v.label}</button>`).join('')}</div></div>
            ${mapStyle() === 'engraving' ? (() => {
                const gs = GLYPH_SETS[def.look?.glyphs] ? def.look.glyphs : 'antique', sp = SPREADS[def.look?.spread] ? def.look.spread : 'range';
                return `<div class="gm-field"><span>Значки: ${esc(GLYPH_SETS[gs].hint)}</span><div class="gm-chips">${Object.entries(GLYPH_SETS).map(([id, v]) => `<button type="button" class="gm-chip text" data-act="glyphs" data-v="${id}" aria-pressed="${gs === id}">${v.label}</button>`).join('')}</div></div>
                <div class="gm-field"><span>Вглубь массива: ${esc(SPREADS[sp].hint)}</span><div class="gm-chips">${Object.entries(SPREADS).map(([id, v]) => `<button type="button" class="gm-chip text" data-act="spread" data-v="${id}" aria-pressed="${sp === id}">${v.label}</button>`).join('')}</div></div>`;
            })() : ''}
            <label class="gm-check"><input type="checkbox" data-act="look" data-v="art"${def.look?.art !== false ? ' checked' : ''}> Тона и значки местности</label>
            <label class="gm-check"><input type="checkbox" data-act="look" data-v="coords"${def.look?.coords !== false ? ' checked' : ''}> Буквы и цифры по краям</label>
            <label class="gm-check"><input type="checkbox" data-act="look" data-v="compass"${def.look?.compass !== false ? ' checked' : ''}> Компас и линейка</label>
            <label class="gm-field"><span>Сетка: ${Math.round((def.look?.grid ?? 0.14) * 100)}%</span><input type="range" class="gm-range" min="0" max="60" value="${Math.round((def.look?.grid ?? 0.14) * 100)}" data-act="grid-op"></label>
        </div>
        <div class="gm-sec"><div class="gm-kicker">Генератор</div>
            <div class="gm-row"><span class="gm-small">Зерно</span><input class="gm-input num" id="gen-seed" type="number" value="${esc(st.form['gen-seed'] ??= String(Math.floor(Math.random() * 1000)))}"><button type="button" class="gm-btn small" data-act="generate">Новая местность</button></div>
            <span class="gm-small">Заменит рельеф, туман, селения и тропы этой карты. Пометки игроков останутся.</span>
        </div>
        <div class="gm-sec"><div class="gm-kicker">Ещё</div>
            <div class="gm-row"><button type="button" class="gm-btn small" data-act="map-dup">Копия карты</button><button type="button" class="gm-btn small" data-act="export">Скачать файл</button><label class="gm-btn small" style="cursor:pointer">Из файла<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
            <div class="gm-row"><button type="button" class="gm-btn small danger" data-act="map-del">Удалить карту</button></div>
        </div>`;
    }

    function renderPanel() {
        if (!st.def && !gm) { panel.innerHTML = `<div class="gm-sec"><div class="gm-kicker red">Карта</div><p class="gm-hint">${st.loading ? 'Загружаю…' : 'Мастер ещё не открыл карту для отряда. Страница обновится сама.'}</p></div>${st.loading ? '' : footSection()}`; return; }
        // Сохраняем фокус и прокрутку: панель перерисовывается целиком
        const ae = document.activeElement;
        let fsel = null, s0 = 0, s1 = 0;
        if (ae && panel.contains(ae) && (ae.dataset.f || ae.dataset.def || ae.id)) {
            fsel = ae.id ? '#' + CSS.escape(ae.id) : ae.dataset.def ? `[data-def="${ae.dataset.def}"]` : ae.dataset.place ? `[data-place="${CSS.escape(ae.dataset.place)}"][data-f="${ae.dataset.f}"]` : `[data-id="${CSS.escape(ae.dataset.id)}"][data-f="${ae.dataset.f}"]`;
            try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch {}
        }
        const scroll = panel.scrollTop;
        let html = compact() ? `<button type="button" class="gm-collapse" data-act="collapse" aria-label="${st.panelCollapsed ? 'Развернуть панель' : 'Свернуть панель'}"><span></span></button>` : '';
        if (gm) html += `<div class="gm-tabs" role="tablist"><button type="button" data-act="tab" data-v="tool" aria-pressed="${st.panelTab === 'tool'}">Пометки</button><button type="button" data-act="tab" data-v="map" aria-pressed="${st.panelTab === 'map'}">Карта</button></div>`;
        if (gm && (st.panelTab === 'map' || !st.def)) html += mapTab();
        else {
            html += toolSection() + '<div class="gm-divider"></div>';
            const sel = st.sel;
            if (sel && sel.type === 'cell') html += cellCard(sel.key);
            else if (sel && sel.type === 'shape' && st.marks.get(sel.id)) html += shapeCard(st.marks.get(sel.id));
            else if (sel && sel.type === 'place' && (st.def.places || []).find(p => p.id === sel.id)) html += placeCard(st.def.places.find(p => p.id === sel.id));
            else if (sel && sel.type === 'road' && (st.def.roads || []).find(p => p.id === sel.id)) html += roadCard(st.def.roads.find(p => p.id === sel.id));
            else html += journalSection() + legendSection();
        }
        html += footSection();
        panel.innerHTML = html;
        panel.classList.toggle('collapsed', compact() && st.panelCollapsed);
        panel.scrollTop = scroll;
        panel.querySelectorAll('textarea.gm-note').forEach(autoGrow);
        const target = pendingFocus ? panel.querySelector(pendingFocus) : fsel ? panel.querySelector(fsel) : null;
        if (target) {
            target.focus({ preventScroll: !pendingFocus });
            if (!pendingFocus) { try { target.setSelectionRange(s0, s1); } catch {} }
            else target.scrollIntoView({ block: 'nearest' });
        }
        pendingFocus = null;
    }
    function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 260) + 'px'; }

    // --- События панели ---
    panel.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b || b.tagName === 'INPUT' && b.type !== 'checkbox' || b.tagName === 'SELECT') return;
        if (b.tagName === 'INPUT' && b.type === 'checkbox') return; // их обрабатывает change
        if (b.classList.contains('gm-zone-row') && e.target.closest('input,button')) {
            if (e.target.closest('button')) return; // кнопка внутри строки — её событие ниже по дереву
        }
        panelAction(b.dataset.act, b);
    });
    panel.addEventListener('input', e => {
        const el = e.target;
        if (el.id && FORM_IDS.has(el.id)) { st.form[el.id] = el.value; return; }
        if (el.dataset.id && el.dataset.f) {
            const row = st.marks.get(el.dataset.id);
            if (!row || !canEdit(row)) return;
            patchMark(row.id, { data: { [el.dataset.f]: el.value } }, { coalesce: el.dataset.f, delay: 700 });
            if (el.tagName === 'TEXTAREA') autoGrow(el);
            invalidateFoot();
        } else if (el.dataset.place) {
            const f = el.dataset.f === 'note' ? 'note' : 'name';
            editDef(d => ({ ...d, places: d.places.map(p => p.id === el.dataset.place ? { ...p, [f]: el.value } : p) }), { undoKey: 'p' + f + ':' + el.dataset.place, delay: 800, layers: f === 'name' ? ['names'] : [] });
            if (el.tagName === 'TEXTAREA') autoGrow(el);
        } else if (el.dataset.def === 'title' || el.dataset.def === 'subtitle') {
            editDef(d => ({ ...d, [el.dataset.def]: el.value }), { undoKey: 'def:' + el.dataset.def, delay: 800, layers: ['head'] });
            if (el.dataset.def === 'title') { const m = st.maps.find(x => x.id === st.mapId); if (m) m.name = el.value; }
        } else if (el.dataset.def === 'scale-n' || el.dataset.def === 'scale-unit') {
            const n = $('gm-panel').querySelector('[data-def="scale-n"]').value, unit = $('gm-panel').querySelector('[data-def="scale-unit"]').value.trim();
            editDef(d => ({ ...d, scale: { n: Number(String(n).replace(',', '.')) || 1, unit } }), { undoKey: 'def:scale', delay: 800, layers: ['head', 'marks', 'view'] });
        } else if (el.dataset.act === 'img-opacity' || el.dataset.act === 'img-scale' || el.dataset.act === 'grid-op') {
            rangeAction(el);
        }
    });
    panel.addEventListener('change', e => {
        const el = e.target;
        if (el.id && FORM_IDS.has(el.id)) st.form[el.id] = el.value;
        if (el.type === 'checkbox' || el.type === 'file' || el.type === 'range') panelAction(el.dataset.act, el);
    });
    panel.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.dataset.f) e.target.blur();
        if (e.key === 'Enter' && e.target.id === 'img-url') panelAction('img-url', e.target);
    });
    panel.addEventListener('focusout', e => {
        // Пометку без названия и текста, созданную только что, не оставляем пустой подписью
        const el = e.target;
        if (el.dataset && el.dataset.f === 'text') {
            const row = st.marks.get(el.dataset.id);
            if (row && row.kind === 'label' && !String(row.data.text || '').trim()) setTimeout(() => {
                const r2 = st.marks.get(el.dataset.id);
                if (r2 && !String(r2.data.text || '').trim() && !panel.contains(document.activeElement)) removeMark(r2.id);
            }, 200);
        }
    });

    function rangeAction(el) {
        const v = Number(el.value);
        const lbl = el.closest('label') && el.closest('label').querySelector('span');
        if (el.dataset.act === 'img-opacity') {
            editDef(d => ({ ...d, image: { ...d.image, opacity: v / 100 } }), { undoKey: 'img-op', delay: 600 });
            if (lbl) lbl.textContent = `Прозрачность рисунка: ${v}%`;
        } else if (el.dataset.act === 'img-scale') {
            editDef(d => { const img = d.image, w = d.cols * S * v / 100, h = w * img.h / img.w; return { ...d, image: { ...img, w, h } }; }, { undoKey: 'img-sc', delay: 600 });
            if (lbl) lbl.textContent = `Размер относительно сетки: ${v}%`;
        } else if (el.dataset.act === 'grid-op') {
            editDef(d => ({ ...d, look: { ...d.look, grid: v / 100 } }), { undoKey: 'grid-op', delay: 600 });
            if (lbl) lbl.textContent = `Сетка: ${v}%`;
        }
    }

    async function panelAction(act, el) {
        const v = el && el.dataset ? el.dataset.v : undefined, id = el && el.dataset ? el.dataset.id : undefined;
        switch (act) {
            case 'tab': st.panelTab = v; invalidate('panel'); break;
            case 'collapse': st.panelCollapsed = !st.panelCollapsed; invalidate('panel'); break;
            case 'mtype': st.sub.mtype = v; invalidate('panel'); break;
            case 'lsize': st.sub.labelSize = v; invalidate('panel'); break;
            case 'snap': st.sub.snap = el.checked; break;
            case 'hide-new': st.hideNew[v] = el.checked; break;
            case 'draw-mode': finishDrawing(false); st.drawing = null; st.sub.drawMode = v; invalidate('panel', 'ui'); break;
            case 'ink': st.sub.ink = v; invalidate('panel', 'ui'); break;
            case 'draw-finish': finishDrawing(true); break;
            case 'draw-back': if (st.drawing && st.drawing.pts.length > 1) { st.drawing.pts.pop(); invalidate('ui'); } else { st.drawing = null; invalidate('ui', 'panel'); } break;
            case 'draw-cancel': st.drawing = null; invalidate('ui', 'panel'); break;
            case 'zone-pick': st.sub.zone = id; invalidate('panel'); break;
            case 'zone-add': {
                const used = new Set(marksOf('zone').map(q => q.data.ink));
                const ink = Object.keys(INKS).find(i => !used.has(i)) || 'red';
                const z = newMark('zone', { name: 'Новая зона', ink, cells: [] });
                st.sub.zone = z.id;
                pendingFocus = `[data-id="${CSS.escape(z.id)}"][data-f="name"]`;
                invalidate('panel');
                break;
            }
            case 'zone-ink': patchMark(id, { data: { ink: v } }); invalidate('panel'); break;
            case 'shape-ink': patchMark(id, { data: { ink: v } }); invalidate('panel'); break;
            case 'mark-type': patchMark(id, { data: { type: v } }); invalidate('panel'); break;
            case 'label-size': patchMark(id, { data: { size: v } }); invalidate('panel'); break;
            case 'mark-del': removeMark(id); invalidate('panel'); break;
            case 'mark-hide': { const row = st.marks.get(id); if (row) { patchMark(id, { hidden: !row.hidden }); invalidate('panel'); } break; }
            case 'clear-sel': select(null); break;
            case 'focus': { const row = st.marks.get(id); if (row) focusItem(row); break; }
            case 'pick-shape': select({ type: 'shape', id }); break;
            case 'pick-place': select({ type: 'place', id }); break;
            case 'add-here': {
                if (!st.sel || st.sel.type !== 'cell') break;
                const [c, r] = T.parseKey(st.sel.key), [x, y] = T.cellCenter(c, r);
                const row = v === 'label' ? newMark('label', { x, y, text: '', size: st.sub.labelSize }) : newMark('marker', { x, y, type: st.sub.mtype, name: '', note: '' });
                select(st.sel, row.id, v === 'label' ? 'text' : 'name');
                break;
            }
            case 'undo': undo(); break;
            case 'rename': askName(true); break;
            // --- мастер: инструменты карты ---
            case 'terrain': st.sub.terrain = v; invalidate('panel'); break;
            case 'tier': st.sub.tier = Number(v); invalidate('panel'); break;
            case 'brush': st.sub.brush = Number(v); invalidate('panel', 'ui'); break;
            case 'fog': st.sub.fog = Number(v); invalidate('panel'); break;
            case 'fog-all': editDef(d => ({ ...d, fog: v.repeat(d.cols * d.rows) })); toast(v === '3' ? 'Вся карта открыта игрокам' : 'Вся карта скрыта туманом'); break;
            case 'fog-circle': editDef(d => ({ ...d, fog: T.generateDef({ cols: d.cols, rows: d.rows, villages: false }).fog })); break;
            case 'place-type': st.sub.place = v; invalidate('panel'); break;
            case 'place-set-type': editDef(d => ({ ...d, places: d.places.map(p => p.id === id ? { ...p, type: v } : p) })); invalidate('panel'); break;
            case 'place-hide': editDef(d => ({ ...d, places: d.places.map(p => p.id === id ? { ...p, hidden: !p.hidden } : p) })); invalidate('panel'); break;
            case 'place-del': editDef(d => ({ ...d, places: d.places.filter(p => p.id !== id) })); st.sel = null; invalidate('panel'); break;
            case 'road-kind': st.sub.road = v; invalidate('panel'); break;
            case 'road-set-kind': editDef(d => ({ ...d, roads: d.roads.map(r => r.id === id ? { ...r, kind: v } : r) })); invalidate('panel'); break;
            case 'road-hide': editDef(d => ({ ...d, roads: d.roads.map(r => r.id === id ? { ...r, hidden: !r.hidden } : r) })); invalidate('panel'); break;
            case 'road-del': editDef(d => ({ ...d, roads: d.roads.filter(r => r.id !== id) })); st.sel = null; invalidate('panel', 'ui'); break;
            case 'auto-trails': {
                const places = (st.def.places || []).filter(p => !p.hidden);
                if (places.length < 2) { toast('Нужно хотя бы два видимых селения'); break; }
                editDef(d => ({ ...d, roads: [...(d.roads || []).filter(r => r.kind !== 'trail'), ...T.autoTrails(d, places)] }));
                toast('Тропы проложены по самым лёгким путям');
                break;
            }
            case 'preview':
                st.preview = !st.preview;
                if (st.preview && TOOLS[st.tool].gm) st.tool = 'inspect';
                st.sel = null;
                svg.setAttribute('class', 'gm-svg tool-' + st.tool);
                invalidate('terrain', 'marks', 'panel', 'rail', 'head', 'ui');
                toast(st.preview ? 'Так карту видят игроки: без скрытого и под туманом' : 'Снова видно всё');
                break;
            case 'show-view': {
                const r = visibleMapRect();
                const view = { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1), at: Date.now() };
                editDef(d => ({ ...d, view }), { delay: 50, layers: [] });
                sub && sub.send({ type: 'view', mapId: st.mapId, view });
                toast('Игроки перенесены к этому месту');
                break;
            }
            case 'copy-player-link': {
                const url = new URL('map.html' + (demo ? '?demo' : ''), location.href).href;
                try { await navigator.clipboard.writeText(url); toast('Ссылка для игроков скопирована'); }
                catch { window.prompt('Ссылка для игроков:', url); }
                break;
            }
            // --- мастер: карты ---
            case 'map-open': await openMap(id); break;
            case 'map-current': await makeCurrent(id); break;
            case 'map-new': st.newMapForm = true; invalidate('panel'); break;
            case 'map-new-cancel': st.newMapForm = false; ['nm-title', 'nm-cols', 'nm-rows', 'nm-base'].forEach(k => delete st.form[k]); invalidate('panel'); break;
            case 'map-create': {
                const title = $('nm-title').value.trim() || 'Новая карта';
                const cols = clamp(parseInt($('nm-cols').value, 10) || 25, 4, 120), rows = clamp(parseInt($('nm-rows').value, 10) || 25, 4, 120);
                const base = $('nm-base').value;
                st.newMapForm = false;
                ['nm-title', 'nm-cols', 'nm-rows', 'nm-base'].forEach(k => delete st.form[k]);
                if (base.startsWith('preset:')) {
                    // Готовая карта из папки maps/ (размер берётся из неё)
                    try {
                        const data = await (await fetch('maps/' + base.slice(7) + '.json', { cache: 'no-store' })).json();
                        const name = title && title !== 'Новая карта' ? title : data.def.title;
                        await createMap({ def: { ...data.def, title: name, view: null }, marks: data.marks || [] });
                    } catch (err) { toast('Не удалось загрузить готовую карту: ' + err.message, true); }
                    break;
                }
                await createMap({ title, cols, rows, base });
                break;
            }
            case 'map-dup': {
                const def = { ...st.def, title: (st.def.title || 'Карта') + ' — копия', view: null };
                await createMap({ def });
                break;
            }
            case 'map-del': {
                if (!confirm(`Удалить карту «${st.def.title || 'Карта'}» вместе со всеми пометками? Это не отменить.`)) break;
                // Отложенные сохранения этой карты отменяем, иначе они вернут её в базу
                clearTimeout(mapSaveTimer); mapSaveTimer = null;
                for (const mid of [...pend.keys()]) { clearTimeout(saveTimers.get(mid)); saveTimers.delete(mid); pend.delete(mid); }
                const { error } = await store.deleteMap(st.mapId);
                if (error) { toast('Не удалось удалить: ' + error.message, true); break; }
                sub && sub.send({ type: 'map', mapId: st.mapId });
                st.maps = st.maps.filter(m => m.id !== st.mapId);
                const next = st.maps.find(m => m.is_current) || st.maps[0];
                if (next) await openMap(next.id); else { setMap(null, []); }
                toast('Карта удалена');
                break;
            }
            case 'resize': {
                const cols = clamp(parseInt($('sz-cols').value, 10) || st.def.cols, 4, 120), rows = clamp(parseInt($('sz-rows').value, 10) || st.def.rows, 4, 120);
                delete st.form['sz-cols']; delete st.form['sz-rows'];
                if (cols === st.def.cols && rows === st.def.rows) { invalidate('panel'); break; }
                editDef(d => T.resizeDef(d, cols, rows));
                invalidate('panel', 'marks', 'head');
                setView(fitView());
                break;
            }
            case 'grow': {
                const d0 = st.def;
                const [cols, rows, sc, sr] = v === 'l' ? [d0.cols + 1, d0.rows, 1, 0] : v === 'r' ? [d0.cols + 1, d0.rows, 0, 0] : v === 't' ? [d0.cols, d0.rows + 1, 0, 1] : [d0.cols, d0.rows + 1, 0, 0];
                if (cols > 120 || rows > 120) break;
                // Карта и пометки сдвигаются вместе — и отменяются одним действием
                beginBatch();
                editDef(d => T.resizeDef(d, cols, rows, sc, sr));
                if (sc || sr) shiftMarks(sc * S, sr * S);
                endBatch();
                invalidate('panel', 'marks', 'head');
                break;
            }
            case 'img-file': {
                const file = el.files && el.files[0];
                if (!file) break;
                toast('Загружаю картинку…');
                const res = await store.uploadImage(file).catch(err => ({ error: err }));
                if (res.error) { toast('Не удалось загрузить: ' + (res.error.message || res.error) + '. Можно вставить ссылку на картинку.', true); break; }
                setImage(res.url, res.w, res.h);
                break;
            }
            case 'img-url': {
                const url = $('img-url').value.trim();
                if (!url) break;
                const im = new Image();
                im.onload = () => setImage(url, im.naturalWidth, im.naturalHeight);
                im.onerror = () => toast('Картинка по этой ссылке не открылась', true);
                im.src = url;
                break;
            }
            case 'img-opacity': case 'img-scale': case 'grid-op': rangeAction(el); invalidate('panel'); break;
            case 'img-move': {
                const dx = Number(el.dataset.dx) * S / 4, dy = Number(el.dataset.dy) * S / 4;
                editDef(d => ({ ...d, image: { ...d.image, x: d.image.x + dx, y: d.image.y + dy } }), { undoKey: 'img-move', delay: 600 });
                break;
            }
            case 'img-aged': editDef(d => ({ ...d, image: { ...d.image, aged: el.checked } })); break;
            case 'img-fit': editDef(d => ({ ...d, image: fitImage(d.image, d) })); invalidate('panel'); break;
            case 'img-grid': {
                const img = st.def.image;
                const rows = clamp(Math.round(st.def.cols * img.h / img.w), 4, 120);
                editDef(d => { const nd = T.resizeDef(d, d.cols, rows); return { ...nd, image: fitImage(d.image, nd) }; });
                invalidate('panel', 'head');
                setView(fitView());
                break;
            }
            case 'img-remove': editDef(d => ({ ...d, image: null })); invalidate('panel'); break;
            case 'look': editDef(d => ({ ...d, look: { ...d.look, [v]: el.checked } }), { layers: ['terrain', 'view'] }); break;
            case 'style': editDef(d => ({ ...d, look: { ...d.look, style: v } }), { layers: ['terrain', 'panel'] }); break;
            case 'glyphs': editDef(d => ({ ...d, look: { ...d.look, glyphs: v } }), { layers: ['terrain', 'panel'] }); break;
            case 'spread': editDef(d => ({ ...d, look: { ...d.look, spread: v } }), { layers: ['terrain', 'panel'] }); break;
            case 'generate': {
                if (!confirm('Заменить рельеф, туман, селения и тропы этой карты случайными? Отменить можно кнопкой «Отменить».')) break;
                const seed = parseInt($('gen-seed').value, 10) || 0;
                editDef(d => { const g = T.generateDef({ cols: d.cols, rows: d.rows, seed }); return { ...d, terrain: g.terrain, fog: g.fog, places: g.places, roads: g.roads }; });
                st.panelTab = 'tool';
                invalidate('panel');
                break;
            }
            case 'export': {
                const data = { kind: 'gempire-map', def: st.def, marks: [...st.marks.values()].map(({ created_at, updated_at, map_id, ...r }) => r) };
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
                a.download = (st.def.title || 'карта').replace(/[\\/:*?"<>|]+/g, '') + '.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                break;
            }
            case 'import': {
                const file = el.files && el.files[0];
                if (!file) break;
                try {
                    const data = JSON.parse(await file.text());
                    if (data.kind !== 'gempire-map' || !data.def) throw new Error('это не файл карты');
                    await createMap({ def: { ...data.def, title: (data.def.title || 'Карта') + ' (из файла)', view: null }, marks: data.marks || [] });
                } catch (err) { toast('Не удалось открыть файл: ' + err.message, true); }
                break;
            }
        }
    }
    function fitImage(img, def) {
        const w = def.cols * S, h = w * img.h / img.w;
        return { ...img, x: M, y: M, w, h };
    }
    function setImage(url, iw, ih) {
        editDef(d => {
            const w = d.cols * S, h = w * ih / iw;
            const terrain = d.image ? d.terrain : (/^p+$/.test(d.terrain) ? '.'.repeat(d.cols * d.rows) : d.terrain);
            return { ...d, terrain, image: { url, x: M, y: M, w, h, opacity: 1, aged: true } };
        });
        toast('Картинка положена под сетку. «Сетку — по картинке» подгонит число строк.');
        invalidate('panel');
    }
    function shiftMarks(dx, dy) {
        for (const row of [...st.marks.values()]) {
            const d = row.data;
            let data = null;
            if (row.kind === 'marker' || row.kind === 'label') data = { x: d.x + dx, y: d.y + dy };
            else if (row.kind === 'shape') data = { pts: d.pts.map(p => [p[0] + dx, p[1] + dy]) };
            else if (row.kind === 'zone') data = { cells: (d.cells || []).map(k => { const [c, r] = T.parseKey(k); return T.keyOf(c + dx / S, r + dy / S); }) };
            if (data) {
                pushUndo({ type: 'update', id: row.id, before: { data: d, hidden: row.hidden } });
                st.marks.set(row.id, { ...row, data: { ...d, ...data } });
                persistMark(row.id, ['data']);
            }
        }
    }

    // ---------------- Клавиатура ----------------
    let spaceDown = false;
    window.addEventListener('keydown', e => {
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable);
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !typing) { e.preventDefault(); undo(); return; }
        if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
        if (e.code === 'Space') { spaceDown = true; svg.style.cursor = 'grab'; e.preventDefault(); return; }
        if (e.key === 'Escape') {
            if (st.drawing) { st.drawing = null; invalidate('ui', 'panel'); }
            else if ($('gm-modal').firstChild) return;
            else select(null);
            return;
        }
        if (e.key === 'Enter' && st.drawing) { finishDrawing(true); return; }
        if (e.key === 'Backspace' && st.drawing && st.drawing.kind === 'shape') { panelAction('draw-back'); e.preventDefault(); return; }
        if (e.key === '+' || e.key === '=') { zoomCenter(1.3); return; }
        if (e.key === '-' || e.key === '_') { zoomCenter(1 / 1.3); return; }
        if (e.key === '0') { animateTo(homeView()); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = Object.entries(TOOLS).find(([, v]) => v.key === e.code);
        if (t) setTool(t[0]);
    });
    const releaseSpace = () => { if (!spaceDown) return; spaceDown = false; svg.style.cursor = st.tool === 'inspect' ? 'grab' : 'crosshair'; };
    window.addEventListener('keyup', e => { if (e.code === 'Space') releaseSpace(); });
    // Пробел отпустили в другом окне — иначе карта так и осталась бы в режиме «только двигать»
    window.addEventListener('blur', releaseSpace);
    $('gm-zoom').addEventListener('click', e => {
        const b = e.target.closest('[data-z]'); if (!b) return;
        if (b.dataset.z === 'in') zoomCenter(1.3); else if (b.dataset.z === 'out') zoomCenter(1 / 1.3); else animateTo(homeView());
    });
    let lastW = 0, lastH = 0;
    new ResizeObserver(() => {
        const w = root.clientWidth, h = root.clientHeight;
        if (!lastW) { lastW = w; lastH = h; return; }
        // Сохраняем центр карты при повороте телефона и изменении окна
        const { k, x, y } = st.view;
        const dx = (w - lastW) / 2, dy = (h - lastH) / 2;
        lastW = w; lastH = h;
        setView({ k, x: x + dx, y: y + dy });
        invalidate('panel');
    }).observe(root);
    window.addEventListener('beforeunload', e => {
        if (mapSaveTimer || mapSaving || pend.size || inflight) { flushSaves(); e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { flushSaves(); releaseSpace(); } });
    function flushSaves() {
        if (mapSaveTimer) saveMapNow();
        for (const id of [...pend.keys()]) { clearTimeout(saveTimers.get(id)); saveTimers.delete(id); flushMark(id); }
    }

    // ---------------- Загрузка и синхронизация ----------------
    function normDef(d) {
        if (!d || !d.cols || !d.rows) return null;
        const n = d.cols * d.rows;
        const pad = (s, ch) => { s = typeof s === 'string' ? s : ''; return s.length >= n ? s.slice(0, n) : s + ch.repeat(n - s.length); };
        return {
            ...T.emptyDef(d.cols, d.rows), ...d,
            terrain: pad(d.terrain, 'p'), fog: pad(d.fog, '3'), tier: pad(d.tier, '0'),
            places: Array.isArray(d.places) ? d.places : [], roads: Array.isArray(d.roads) ? d.roads.filter(r => Array.isArray(r.cells) && r.cells.length > 1) : [],
            look: { grid: 0.14, coords: true, art: true, compass: true, ...(d.look || {}) },
            scale: { n: 1, unit: '', ...(d.scale || {}) }
        };
    }
    function defOf(row) { return row ? normDef(gm ? (row.gm_data || row.data) : row.data) : null; }

    function setMap(row, marks) {
        const changedMap = !row || row.id !== st.mapId;
        st.mapRow = row;
        st.mapId = row ? row.id : null;
        st.def = defOf(row);
        if (changedMap) {
            delete st.form['sz-cols']; delete st.form['sz-rows']; delete st.form['img-url'];
            st.marks = new Map();
            undoStack = [];
            st.sel = null; st.drawing = null; st.sub.zone = null;
            st.viewSeen = st.def && st.def.view ? st.def.view.at : 0;
        }
        mergeMarks(marks || []);
        $('gm-empty').hidden = !!st.def;
        if (!st.def) {
            $('gm-empty').innerHTML = `<div><b>${gm ? 'Карт пока нет' : 'Карты пока нет'}</b><span>${gm ? 'Создайте первую на вкладке «Карта».' : 'Мастер ещё не открыл карту для отряда. Страница обновится сама, как только карта появится.'}</span></div>`;
            if (gm) st.panelTab = 'map';
        }
        if (changedMap && st.def) { requestAnimationFrame(() => { setView(restoreView()); }); }
        invalidate('terrain', 'marks', 'panel', 'head', 'rail', 'ui', 'view');
    }
    function mergeMarks(rows) {
        const next = new Map();
        for (const r of rows) {
            if (r.deleted || (!gm && r.hidden)) continue;
            // Пометку, которую здесь сейчас правят или только что удалили, оставляем как есть
            if (isLocked(r.id) || tomb.has(r.id)) { if (st.marks.has(r.id)) next.set(r.id, st.marks.get(r.id)); else if (!tomb.has(r.id) && !pend.has(r.id)) next.set(r.id, r); continue; }
            next.set(r.id, r);
        }
        for (const [id, r] of st.marks) if (!next.has(id) && isLocked(id) && !r.deleted) next.set(id, r);
        st.marks = next;
    }

    // Список карт берём каждый раз, саму карту — только если она изменилась
    async function loadAll(first = false) {
        const { data: list, error } = await store.listMaps({ gm });
        if (error) return handleLoadError(error);
        let id = null;
        if (gm) {
            st.maps = list;
            id = st.mapId && list.find(m => m.id === st.mapId) ? st.mapId : null;
            if (!id) {
                let saved = null;
                try { saved = localStorage.getItem('gempire-map-gm-open'); } catch {}
                id = (list.find(m => m.id === saved) || list.find(m => m.is_current) || list[0] || {}).id || null;
            }
        } else id = list[0] ? list[0].id : null;
        const meta = id ? list.find(m => m.id === id) : null;
        const marks = id ? await store.listMarks(id, { gm }) : { data: [] };
        if (marks.error) return handleLoadError(marks.error);
        st.conn.ok = true;
        const same = !first && id && id === st.mapId;
        const editing = gm && (mapSaveTimer || mapSaving || isLocked('map'));
        if (same && (editing || (st.mapRow && meta.updated_at === st.mapRow.updated_at))) {
            st.mapRow = { ...st.mapRow, is_current: meta.is_current, name: meta.name };
            mergeMarks(marks.data);
            invalidate('marks', 'panel', 'head');
        } else if (!id) {
            if (st.mapId || first) setMap(null, []);
        } else {
            const editsBefore = defEdits;
            const { data: row, error: e2 } = await store.getMap(id, { gm });
            if (e2 || !row) return handleLoadError(e2 || { message: 'карта не найдена' });
            const incoming = gm ? (row.gm_data || row.data) : row.data;
            // Пока ждали ответа, мастер мог продолжить править — тогда его версия свежее
            const editedMeanwhile = gm && same && (defEdits !== editsBefore || mapSaveTimer || mapSaving || isLocked('map'));
            if (editedMeanwhile || (same && incoming && st.def && incoming.rev === st.def.rev)) {
                if (editedMeanwhile) row.updated_at = st.mapRow && st.mapRow.updated_at;
                st.mapRow = row; mergeMarks(marks.data); invalidate('marks', 'panel', 'head');
            } else {
                const switched = !gm && !first && st.mapId && row.id !== st.mapId;
                setMap(row, marks.data);
                if (switched) toast('Мастер открыл другую карту: «' + (row.name || 'Карта') + '»');
            }
        }
        if (!gm) checkSharedView();
        st.loading = false;
        invalidate('panel', 'head');
    }
    function handleLoadError(error) {
        st.loading = false;
        if (isMissingTable(error)) { st.setupNeeded = true; showSetup(); }
        else { st.conn.ok = false; toast('Нет связи с базой: ' + error.message, true); }
        invalidate('panel', 'head');
    }
    function checkSharedView() {
        const v = st.def && st.def.view;
        if (!v || !v.at || v.at === st.viewSeen) return;
        st.viewSeen = v.at;
        animateTo(fitView(v), 700);
        toast('Мастер показывает это место');
    }

    let reloadTimer = null;
    function reloadSoon(ms = 250) { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadAll(false), ms); }

    let sub = null;
    let relayIds = new Set(), relayTimer = null;
    function notifyRelay(id) {
        relayIds.add(id);
        clearTimeout(relayTimer);
        relayTimer = setTimeout(() => { const ids = [...relayIds]; relayIds = new Set(); if (ids.length && sub) sub.send({ type: 'marks', mapId: st.mapId, ids }); }, 200);
    }
    const meInfo = () => ({ name: gm ? 'Мастер' : (st.author || 'Игрок'), gm });
    function connect() {
        sub = store.subscribe({
            gm,
            me: meInfo(),
            onPresence: list => { st.online = list; invalidateFoot(); },
            onStatus: s => { st.conn.realtime = s.realtime; st.conn.polling = s.polling; invalidateFoot(); },
            onPoll: () => loadAll(false),
            onMaps: p => {
                const row = p.new && p.new.id ? p.new : null;
                if (gm && row && row.id === st.mapId && row.gm_data && ownRevs.has(row.gm_data.rev)) {
                    const m = st.maps.find(x => x.id === row.id); if (m) m.is_current = row.is_current;
                    if (st.mapRow) st.mapRow = { ...st.mapRow, is_current: row.is_current };
                    invalidate('head', 'panel');
                    return;
                }
                reloadSoon();
            },
            // Сюда приходят строки из базы целиком — только у мастера
            onMarks: p => {
                if (p.eventType === 'DELETE') {
                    const id = p.old && p.old.id;
                    if (id && st.marks.has(id) && !isLocked(id)) { st.marks.delete(id); invalidate('marks', 'panel', 'ui'); }
                    return;
                }
                const row = p.new;
                if (!row || row.map_id !== st.mapId) return;
                // Пересылаем игрокам весть «эта пометка изменилась» — они перезапросят её без скрытого
                notifyRelay(row.id);
                if (isLocked(row.id)) { deferRefetch(row.id); return; }
                if (row.deleted || (!gm && row.hidden)) {
                    if (st.marks.delete(row.id)) { if (st.sel && st.sel.id === row.id) st.sel = null; invalidate('marks', 'panel', 'ui'); }
                    return;
                }
                st.marks.set(row.id, row);
                invalidate('marks', 'panel');
            },
            onBroadcast: p => {
                if (!p) return;
                if (p.type === 'map') { if (!gm || p.mapId !== st.mapId || !mapSaving) reloadSoon(300); return; }
                if (p.mapId !== st.mapId) return;
                if (p.type === 'marks' && Array.isArray(p.ids)) {
                    const free = p.ids.filter(id => !isLocked(id));
                    p.ids.filter(id => isLocked(id)).forEach(deferRefetch);
                    if (free.length) refetchSoon(free);
                    return;
                }
                if (p.type === 'ping') showPing(p);
                if (p.type === 'view' && !gm && p.view) { st.viewSeen = p.view.at; animateTo(fitView(p.view), 700); toast('Мастер показывает это место'); }
            }
        });
    }

    async function openMap(id) {
        if (mapSaveTimer) await saveMapNow();
        const { data: row, error: e1 } = await store.getMap(id, { gm: true });
        if (e1 || !row) { toast('Не удалось открыть карту' + (e1 ? ': ' + e1.message : ''), true); return; }
        const { data, error } = await store.listMarks(id, { gm: true });
        if (error) { toast('Не удалось открыть: ' + error.message, true); return; }
        try { localStorage.setItem('gempire-map-gm-open', id); } catch {}
        setMap(row, data);
    }
    async function makeCurrent(id) {
        if (mapSaveTimer) await saveMapNow();
        const { error } = await store.setCurrent(id);
        if (error) { toast('Не получилось: ' + error.message, true); return; }
        st.maps = st.maps.map(m => ({ ...m, is_current: m.id === id }));
        if (st.mapRow) st.mapRow = { ...st.mapRow, is_current: st.mapRow.id === id };
        sub && sub.send({ type: 'map', mapId: id });
        toast('Теперь игроки видят «' + ((st.maps.find(m => m.id === id) || {}).name || 'карту') + '»');
        invalidate('head', 'panel');
    }
    async function createMap({ title, cols = 25, rows = 25, base = 'random', def = null, marks = [] }) {
        if (mapSaveTimer) await saveMapNow();
        let d = def ? normDef(def) : null;
        if (!d) {
            d = base === 'random' ? T.generateDef({ cols, rows, seed: Math.floor(Math.random() * 1000) }) : T.emptyDef(cols, rows);
            if (base === 'blank') d.terrain = '.'.repeat(cols * rows);
            d.title = title;
        }
        const rev = uid('rv');
        ownRevs.add(rev);
        d = { ...d, rev };
        const id = uid('map-');
        const row = { id, name: d.title || 'Карта', data: T.playerProjection(d), gm_data: d, is_current: st.maps.length === 0 };
        const { error } = await store.saveMap(row);
        if (error) { toast('Не удалось создать карту: ' + error.message, true); if (isMissingTable(error)) showSetup(); return; }
        for (const m of marks) await store.saveMark({ ...m, id: uid('k'), map_id: id });
        st.maps.push({ ...row, created_at: new Date().toISOString() });
        try { localStorage.setItem('gempire-map-gm-open', id); } catch {}
        const marksRes = marks.length ? await store.listMarks(id, { gm: true }) : { data: [] };
        setMap(st.maps[st.maps.length - 1], marksRes.data);
        st.panelTab = 'map';
        toast(row.is_current ? 'Карта создана — игроки уже видят её' : 'Карта создана. Чтобы её увидели игроки, нажмите «Показать игрокам эту карту».');
    }

    // ---------------- Окна: настройка базы, подпись игрока ----------------
    async function showSetup() {
        const box = $('gm-modal');
        if (!gm) {
            box.innerHTML = `<div class="gm-modal-wrap"><div class="gm-modal"><h2>Карта ещё не готова</h2><p>Мастер пока не подключил карту к базе. Загляните чуть позже.</p></div></div>`;
            return;
        }
        let sql = '';
        try { sql = await (await fetch('supabase/map-setup.sql', { cache: 'no-store' })).text(); } catch {}
        box.innerHTML = `<div class="gm-modal-wrap"><div class="gm-modal">
            <h2>Один раз подготовить базу</h2>
            <p>Для карты нужны две новые таблицы в Supabase. Это делается один раз, листы персонажей не затрагиваются.</p>
            <ol><li>Откройте <a href="https://supabase.com/dashboard/project/fzfijdsjgxoympldpwyq/sql/new" target="_blank" rel="noopener">SQL Editor в Supabase</a>.</li>
                <li>Вставьте текст ниже целиком и нажмите <b>Run</b>.</li>
                <li>Обновите эту страницу.</li></ol>
            <textarea readonly id="gm-sql">${esc(sql || 'Текст лежит в репозитории: supabase/map-setup.sql')}</textarea>
            <div class="gm-row"><button type="button" class="gm-btn primary" id="gm-sql-copy">Скопировать SQL</button><a class="gm-btn" href="?demo" style="text-decoration:none">Посмотреть в демо-режиме</a></div>
        </div></div>`;
        $('gm-sql-copy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText($('gm-sql').value); toast('Скопировано'); } catch { $('gm-sql').select(); }
        });
    }
    function askName(force = false) {
        if (gm || (!force && st.author)) return;
        const box = $('gm-modal');
        box.innerHTML = `<div class="gm-modal-wrap"><form class="gm-modal" id="gm-name-form" style="width:min(420px,100%)">
            <h2>Как вас подписать?</h2>
            <p>Имя будет стоять под вашими метками и заметками, чтобы отряд знал, кто что отметил.</p>
            <input class="gm-input" id="gm-name" style="font-size:18px" maxlength="40" placeholder="Имя персонажа" value="${esc(st.author || '')}" autocomplete="nickname">
            <div class="gm-row"><button type="submit" class="gm-btn primary">Готово</button>${force ? '' : '<button type="button" class="gm-btn" id="gm-name-skip">Позже</button>'}</div>
        </form></div>`;
        const close = () => { box.innerHTML = ''; invalidate('panel'); };
        $('gm-name').focus();
        $('gm-name-form').addEventListener('submit', e => {
            e.preventDefault();
            const v = $('gm-name').value.trim();
            if (v) { st.author = v; try { localStorage.setItem('gempire-map-author', v); } catch {} }
            sub && sub.track && sub.track(meInfo());
            close();
        });
        const skip = $('gm-name-skip');
        if (skip) skip.addEventListener('click', () => { st.author = st.author || 'Игрок'; sub && sub.track && sub.track(meInfo()); close(); });
    }

    // ---------------- Старт ----------------
    svg.setAttribute('class', 'gm-svg tool-inspect');
    svg.style.cursor = 'grab';
    invalidate('rail', 'panel', 'head');
    (async () => {
        if (!gm) {
            let name = null;
            if (charId) name = await store.charName(charId).catch(() => null);
            if (!name) { try { name = localStorage.getItem('gempire-map-author'); } catch {} }
            st.author = name;
        }
        await loadAll(true);
        if (!st.setupNeeded) {
            connect();
            if (!gm && !st.author) askName();
        }
    })();

    // Для отладки из консоли
    window.__gempireMap = { st, store, invalidate, ptrsSize: () => ptrs.size, gest: () => gest };
}
