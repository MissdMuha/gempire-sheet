// Гравюрная местность для карты похода: тона клеток, значки леса/гор/холмов/топей/воды,
// поселения, тропы, туман. Всё рисуется в SVG-строки — так слой целиком меняется за один раз.
//
// Карта (def):
//   cols, rows       — размер сетки в клетках
//   terrain          — строка cols*rows символов: . пусто, w вода, s топь, p равнина, f лес, h холмы, m горы
//   fog              — строка cols*rows символов 0..3: 0 неизвестно, 1 по слухам, 2 приблизительно, 3 разведано
//   places           — поселения [{ id, c, r, type, name, hidden }]
//   roads            — тропы, дороги, реки [{ id, kind, cells: [[c, r], ...], hidden }]

export const S = 28;   // размер клетки в единицах карты
export const M = 40;   // поле под буквы и цифры координат

export const PAPER = '#F1EADB';
export const PANEL = '#F7F2E7';
export const INK = '#2B2620';
export const WATER_INK = '#3D5A73';

export const TER_CODES = { w: 'water', s: 'swamp', p: 'plains', f: 'forest', h: 'hills', m: 'mountains' };
export const TER_CHAR = { water: 'w', swamp: 's', plains: 'p', forest: 'f', hills: 'h', mountains: 'm' };
export const TER_NAMES = { water: 'Вода', swamp: 'Топь', plains: 'Равнина', forest: 'Лес', hills: 'Холмы', mountains: 'Горы' };
export const LV = {
    forest: ['Лесок', 'Лес', 'Чаща'], hills: ['Пригорки', 'Холмы', 'Взгорье'], mountains: ['Предгорья', 'Горы', 'Хребет'],
    swamp: ['Сырой луг', 'Топь', 'Трясина'], water: ['Мелководье', 'Озеро', 'Глубокие воды'], plains: ['Равнина', 'Равнина', 'Равнина']
};
export const TONES = {
    water: ['#DCE3DE', '#CFD9D5', '#C1CFCB'], forest: ['#EAE4CC', '#E1DBC0', '#D6D0B1'], mountains: ['#E9DFC9', '#DFD4BC', '#D3C7AC'],
    hills: ['#F2E8CF', '#EBDFC3', '#E3D5B5'], swamp: ['#E7E5D1', '#DDDCC5', '#D1D1B6'], plains: ['#F4EDDD', '#F4EDDD', '#F4EDDD']
};
export const FOG_NAMES = ['неизвестно игрокам', 'по слухам', 'известно приблизительно', 'разведано'];
export const FOG_OPACITY = [0, 0.45, 0.78, 1];

const LET = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭ';
export function colName(i) {
    return i < LET.length ? LET[i] : LET[Math.floor(i / LET.length) - 1] + LET[i % LET.length];
}
export function coordName(c, r) { return colName(c) + (r + 1); }
export function keyOf(c, r) { return c + ',' + r; }
export function parseKey(key) { const [c, r] = String(key).split(',').map(Number); return [c, r]; }
export function cellCenter(c, r) { return [M + c * S + S / 2, M + r * S + S / 2]; }
export function mapSize(def) { return [M * 2 + def.cols * S, M * 2 + def.rows * S]; }

export function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Шум и случайности (детерминированные: одна и та же клетка всегда рисуется одинаково) ---
export function rnd(n) {
    n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
}
function vnoise(x, y, st, sd) {
    const gx = Math.floor(x / st), gy = Math.floor(y / st), u0 = x / st - gx, v0 = y / st - gy, s = t => t * t * (3 - 2 * t);
    const h = (a, b) => rnd(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ sd);
    const a = h(gx, gy), b = h(gx + 1, gy), c = h(gx, gy + 1), d = h(gx + 1, gy + 1), u = s(u0), v = s(v0);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Сдвиг и масштаб пути: все координаты в путях значков записаны парами «x y»
function T(p, dx, dy, k) {
    return p.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, a, b) => (dx + a * k).toFixed(1) + ' ' + (dy + b * k).toFixed(1));
}

// --- Формы значков местности ---
const SH = {
    crown: 'M0 -10C5 -10 7 -6 5 -3C8 -1 7 4 2 4L-2 4C-7 4 -8 -1 -5 -3C-7 -6 -5 -10 0 -10Z',
    crownD: 'M0 4L0 10M-2.5 10L2.5 10M2 -6L2.5 0M4 -3.5L4.2 1.5M-3 -1L-1 1',
    fir: 'M0 -11L4 -5L2 -5L6 1L3 1L7 6L-7 6L-3 1L-6 1L-2 -5L-4 -5Z',
    firD: 'M0 6L0 10M-2 10L2 10M1 -3L3 -1M2 2L4.5 4',
    peak: 'M-11 9C-6 6 -3 1 0 -11C3 1 6 6 11 9Z',
    peakD: 'M0 -11L-1 -4L1 0L-1 5L0 9M2 -4L3 8.5M4 0L5.5 8.5M6 4L7.5 8.8',
    mound: 'M-11 6C-9 -3 -4 -7 0 -7C4 -7 9 -3 11 6Z',
    moundD: 'M3 -4.5L4 2M5.5 -3L6.5 3M7.5 -1L8.5 4M-6 2C-3 0 -1 0 1 1',
    reeds: 'M-3 7L-4.5 -4M0 7L0 -6M3 7L4.5 -3M-3 7C-6 4 -8 3 -10 3M3 7C6 5 8 4 10 4M-10 9L-5 9M-1 9L5 9M7 11L11 11',
    head: 'M-5.3 -4C-5.3 -8 -3.7 -8 -3.7 -4C-3.7 -1 -5.3 -1 -5.3 -4ZM-0.8 -6C-0.8 -10 0.8 -10 0.8 -6C0.8 -3 -0.8 -3 -0.8 -6ZM3.7 -3C3.7 -7 5.3 -7 5.3 -3C5.3 0 3.7 0 3.7 -3Z',
    wave: 'M-10 0C-9 -3 -6 -4 -5 -1C-4.5 0.5 -6 1 -6.5 0M-5 0C-4 -3 -1 -4 0 -1C0.5 0.5 -1 1 -1.5 0M0 0C1 -3 4 -4 5 -1C5.5 0.5 4 1 3.5 0M5 0C6 -3 9 -4 10 -1',
    tuft: 'M-3 3L-4 -1M0 3L0 -3M3 3L4 -1',
    snow: 'M-3.2 -3.5C-2 -2.5 -1.2 -4.5 0 -3.5C1.2 -4.5 2 -2.5 3.2 -3.5',
    pool: 'M-11 -9L-5 -9M-12 -7L-7 -7M6 -10L11 -10M5 -8L9 -8'
};
const LAYOUT = {
    forest: [[[-2, 1, 0.55], [6, 5, 0.42]], [[-6, -3, 0.62], [6, -4, 0.6], [0, 3, 0.7]], [[-9, -7, 0.72], [3, -9, 0.7], [10, 0, 0.72], [-5, 2, 0.8], [3, 7, 0.78], [-11, 8, 0.66]]],
    mountains: [[[0, 3, 0.62]], [[6, -1, 0.62], [-3, 1, 0.92]], [[-10, 2, 0.85], [10, 0, 0.9], [0, -2, 1.3]]],
    hills: [[[0, 3, 0.55]], [[5, -2, 0.62], [-3, 3, 0.78]], [[-7, -3, 0.8], [7, -4, 0.75], [0, 5, 1.0]]]
};

// Значок местности для клетки: список частей { d, fill, stroke, y } (y — для порядка отрисовки сверху вниз)
export function glyph(t, x, y, k, rr, lvl = 1) {
    const P = PANEL, I = INK, W = WATER_INK, H = SH, out = [];
    const Tr = (p, dx, dy, s) => T(p, x + dx * k, y + dy * k, s * k);
    const part = (d, fill, stroke, yy) => out.push({ d, fill, stroke, y: yy });
    const jx = (i) => (rr(i + 20) - 0.5) * 3, jy = (i) => (rr(i + 30) - 0.5) * 3;
    if (t === 'forest') {
        LAYOUT.forest[lvl].forEach(([dx, dy, s], i) => {
            const fir = rr(i + 3) < (lvl === 2 ? 0.5 : 0.3), a = dx + jx(i), b = dy + jy(i);
            part(Tr(fir ? H.fir : H.crown, a, b, s), P, I, y + b * k);
            part(Tr(fir ? H.firD : H.crownD, a, b, s), 'none', I, y + b * k + 0.01);
        });
    } else if (t === 'mountains') {
        LAYOUT.mountains[lvl].forEach(([dx, dy, s], i) => {
            const a = dx + jx(i), b = dy + jy(i);
            part(Tr(H.peak, a, b, s), P, I, y + b * k + 4);
            part(Tr(H.peakD + (lvl === 2 && s > 1 ? H.snow : ''), a, b, s), 'none', I, y + b * k + 4.01);
        });
    } else if (t === 'hills') {
        LAYOUT.hills[lvl].forEach(([dx, dy, s], i) => {
            const a = dx + jx(i), b = dy + jy(i);
            part(Tr(H.mound, a, b, s), P, I, y + b * k + 3);
            part(Tr(H.moundD, a, b, s), 'none', I, y + b * k + 3.01);
        });
    } else if (t === 'swamp') {
        if (lvl === 0) part(Tr(H.tuft, jx(1), jy(1) + 2, 1.2), 'none', I, y);
        else {
            part(Tr(H.reeds, jx(1), jy(1), lvl === 2 ? 0.9 : 0.75), 'none', I, y);
            part(Tr(H.head, jx(1), jy(1), lvl === 2 ? 0.9 : 0.75), I, I, y + 0.01);
            if (lvl === 2) part(Tr(H.pool, 0, 0, 1), 'none', W, y + 0.02);
        }
    } else if (t === 'water') {
        const rows = lvl === 0 ? (rr(5) < 0.5 ? [[0, 0, 0.45]] : []) : lvl === 1 ? [[0, 0, 0.55]] : [[-2, -4, 0.55], [3, 4, 0.55]];
        rows.forEach(([dx, dy, s], i) => part(Tr(H.wave, dx + jx(i), dy, s), 'none', W, y + i * 0.01));
    } else if (t === 'plains') {
        if (rr(7) > 0.22) return out;
        part(Tr(H.tuft, (rr(2) - 0.5) * 12, (rr(3) - 0.5) * 12, 0.9), 'none', I, y);
    }
    return out;
}

// --- Поселения и особые места ---
const HOUSE = 'M-4 0L-4 -3.5L0 -7L4 -3.5L4 0Z', HOUSE_D = 'M-4 -3.5L4 -3.5M-1 0L-1 -2L1 -2L1 0';
const CHURCH = 'M-3.5 2L-3.5 -5L0 -8.5L3.5 -5L3.5 2Z', CHURCH_D = 'M0 -8.5L0 -13M-2 -11.2L2 -11.2M-1.2 2L-1.2 -1.5C-1.2 -3 1.2 -3 1.2 -1.5L1.2 2';
const BATTLE = (x0, x1, top, base) => {
    // Зубчатая башенка от x0 до x1: верх top, низ base
    const w = x1 - x0, m = w / 5;
    return `M${x0} ${base}L${x0} ${top + 3}L${x0 - 1} ${top + 3}L${x0 - 1} ${top}L${x0 + m} ${top}L${x0 + m} ${top + 1.5}L${x0 + 2 * m} ${top + 1.5}L${x0 + 2 * m} ${top}` +
        `L${x0 + 3 * m} ${top}L${x0 + 3 * m} ${top + 1.5}L${x0 + 4 * m} ${top + 1.5}L${x0 + 4 * m} ${top}L${x1 + 1} ${top}L${x1 + 1} ${top + 3}L${x1} ${top + 3}L${x1} ${base}Z`;
};
const PLACE_SHAPES = {
    village: () => [[-5, 2, 'h'], [5, 4, 'h'], [0, 9, 'h']],
    town: () => [[-7, 2, 'h'], [7, 3, 'h'], [0, 0, 'c'], [-2, 9, 'h']]
};
export const PLACE_TYPES = {
    village: { label: 'Деревня' },
    town: { label: 'Село' },
    city: { label: 'Город' },
    castle: { label: 'Замок' },
    tower: { label: 'Башня' },
    ruin: { label: 'Руины' },
    cave: { label: 'Пещера' },
    shrine: { label: 'Святилище' }
};

export function placeGlyph(type, x, y, k = 1) {
    const P = PANEL, I = INK, out = [];
    const Tr = (p, dx = 0, dy = 0, s = 1) => T(p, x + dx * k, y + dy * k, s * k);
    const add = (d, fill = P, stroke = I) => out.push({ d, fill, stroke });
    if (type === 'village' || type === 'town') {
        const L = PLACE_SHAPES[type]().sort((a, b) => a[1] - b[1]);
        L.forEach(([dx, dy, t]) => { add(Tr(t === 'c' ? CHURCH : HOUSE, dx, dy)); add(Tr(t === 'c' ? CHURCH_D : HOUSE_D, dx, dy), 'none'); });
    } else if (type === 'city') {
        [[-5, -1, 'h'], [4, -2, 'c'], [0, -4, 'h']].sort((a, b) => a[1] - b[1]).forEach(([dx, dy, t]) => {
            add(Tr(t === 'c' ? CHURCH : HOUSE, dx, dy, 0.9)); add(Tr(t === 'c' ? CHURCH_D : HOUSE_D, dx, dy, 0.9), 'none');
        });
        add(Tr('M-9 8L-9 2L9 2L9 8Z'));
        add(Tr('M-7 2L-7 0.6L-5.6 0.6L-5.6 2M-3 2L-3 0.6L-1.6 0.6L-1.6 2M1.6 2L1.6 0.6L3 0.6L3 2M5.6 2L5.6 0.6L7 0.6L7 2M-1.5 8L-1.5 5.8C-1.5 4.2 1.5 4.2 1.5 5.8L1.5 8'), 'none');
        add(Tr('M-12.5 9L-12.5 1L-8.5 1L-8.5 9Z')); add(Tr('M-13 1L-10.5 -4L-8 1Z'));
        add(Tr('M8.5 9L8.5 1L12.5 1L12.5 9Z')); add(Tr('M8 1L10.5 -4L13 1Z'));
        add(Tr('M-10.5 4L-10.5 5.5M10.5 4L10.5 5.5'), 'none');
    } else if (type === 'castle') {
        add(Tr(BATTLE(-3, 3, -12, -1)));
        add(Tr('M-0.8 -8L-0.8 -6M0.8 -8L0.8 -6'), 'none');
        add(Tr('M-6.5 6L-6.5 -1L6.5 -1L6.5 6Z'));
        add(Tr('M-6.5 -1L-6.5 -2.4L-5 -2.4L-5 -1M-2 -1L-2 -2.4L-0.5 -2.4L-0.5 -1M0.5 -1L0.5 -2.4L2 -2.4L2 -1M5 -1L5 -2.4L6.5 -2.4L6.5 -1M-1.6 6L-1.6 3.6C-1.6 1.8 1.6 1.8 1.6 3.6L1.6 6'), 'none');
        add(Tr(BATTLE(-10, -6.5, -7, 7)));
        add(Tr(BATTLE(6.5, 10, -7, 7)));
        add(Tr('M-8.25 -2L-8.25 0M8.25 -2L8.25 0'), 'none');
    } else if (type === 'tower') {
        add(Tr(BATTLE(-3.2, 3.2, -12, 8)));
        add(Tr('M-1.3 8L-1.3 5C-1.3 3.4 1.3 3.4 1.3 5L1.3 8M0 -6L0 -3.5M-3.2 -8L3.2 -8'), 'none');
        add(Tr('M-7 9L7 9M-5.5 10.5L-2.5 10.5M3 10.5L6 10.5'), 'none');
    } else if (type === 'ruin') {
        add(Tr('M-9 7L-9 -2L-7.5 -4.5L-6 -1.5L-6 7Z'));
        add(Tr('M-4 7L-4 0L-2 -2L-0.5 0.5L1 -1L2.5 1L2.5 7Z'));
        add(Tr('M4.5 7L4.5 -6L6 -8L7.5 -5L7.5 7Z'));
        add(Tr('M6 -3L6 -1M-1 3L-1 5M-11 8L-9 7M9 8L11.5 8M-3 8.5L-1 8.5M2 9L4 9'), 'none');
    } else if (type === 'cave') {
        add(Tr('M-11 7C-10 -1 -5 -7 0 -7C5 -7 10 -1 11 7Z'));
        add(Tr('M-4 7L-4 3C-4 -1 3 -1 3 3L3 7Z'), I);
        add(Tr('M5 -3L6 2M7.5 -0.5L8.5 4M-7 1L-6 -2M-9 4L-8 1'), 'none');
    } else if (type === 'shrine') {
        add(Tr('M-9 6L-9.4 -1C-9.4 -3.5 -5.8 -3.5 -5.8 -1L-6.2 6Z'));
        add(Tr('M-2 6L-2.4 -6C-2.4 -8.6 1.6 -8.6 1.6 -6L1.2 6Z'));
        add(Tr('M5 6L4.8 -2C4.8 -4.4 8.2 -4.4 8.2 -2L8 6Z'));
        add(Tr('M-12 6.5L12 6.5M-0.4 -3L-0.4 1M6.5 0L6.5 2.5'), 'none');
    }
    return out;
}

// --- Поля карты ---
export function emptyDef(cols = 25, rows = 25) {
    return {
        v: 1, cols, rows,
        title: 'Карта похода', subtitle: '',
        scale: { n: 1, unit: '' },
        terrain: 'p'.repeat(cols * rows),
        fog: '3'.repeat(cols * rows),
        places: [], roads: [],
        image: null,
        look: { grid: 0.14, coords: true, art: true, compass: true }
    };
}

export function terAt(def, c, r) {
    if (c < 0 || r < 0 || c >= def.cols || r >= def.rows) return null;
    const ch = def.terrain ? def.terrain[r * def.cols + c] : 'p';
    return TER_CODES[ch] || null;
}
export function fogAt(def, c, r) {
    if (c < 0 || r < 0 || c >= def.cols || r >= def.rows) return 0;
    if (!def.fog) return 3;
    const v = def.fog.charCodeAt(r * def.cols + c) - 48;
    return v >= 0 && v <= 3 ? v : 3;
}

function setCharAt(str, i, ch) { return str.slice(0, i) + ch + str.slice(i + 1); }
export function withCell(def, field, c, r, ch) {
    const i = r * def.cols + c;
    if (def[field][i] === ch) return def;
    return { ...def, [field]: setCharAt(def[field], i, ch) };
}

// Изменение размера сетки (клетки остаются на своих местах относительно левого верхнего угла, плюс сдвиг)
export function resizeDef(def, cols, rows, shiftC = 0, shiftR = 0) {
    let terrain = '', fog = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const oc = c - shiftC, or = r - shiftR, inside = oc >= 0 && or >= 0 && oc < def.cols && or < def.rows;
        terrain += inside ? def.terrain[or * def.cols + oc] : (def.terrain.includes('p') ? 'p' : '.');
        fog += inside ? (def.fog ? def.fog[or * def.cols + oc] : '3') : '3';
    }
    const inGrid = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
    // Картинка-подложка и показанное игрокам место сдвигаются вместе с клетками
    const dx = shiftC * S, dy = shiftR * S;
    return {
        ...def, cols, rows, terrain, fog,
        image: def.image ? { ...def.image, x: def.image.x + dx, y: def.image.y + dy } : def.image,
        view: def.view ? { ...def.view, x: def.view.x + dx, y: def.view.y + dy } : def.view,
        places: (def.places || []).map(p => ({ ...p, c: p.c + shiftC, r: p.r + shiftR })).filter(p => inGrid(p.c, p.r)),
        roads: (def.roads || []).map(rd => ({ ...rd, cells: rd.cells.map(([c, r]) => [c + shiftC, r + shiftR]).filter(([c, r]) => inGrid(c, r)) })).filter(rd => rd.cells.length > 1)
    };
}

// Уровень «густоты» клетки: 0 у края своей местности, 2 в глубине
function levels(def, visible) {
    const { cols, rows } = def, out = new Uint8Array(cols * rows);
    const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows) ? undefined : (visible && !visible(c, r) ? null : terAt(def, c, r));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const t = at(c, r);
        const ring = d => {
            for (let i = -d; i <= d; i++) for (let j = -d; j <= d; j++) {
                if (Math.abs(i) !== d && Math.abs(j) !== d) continue;
                const n = at(c + i, r + j);
                if (n !== undefined && n !== t) return true;
            }
            return false;
        };
        out[r * cols + c] = ring(1) ? 0 : ring(2) ? 1 : 2;
    }
    return out;
}

export function terrainLevels(def) { return levels(def, null); }

// Сглаженный путь по центрам клеток со случайным дрожанием (как нарисованная от руки тропа)
export function roadPath(cells, jitter = 9) {
    const pts = cells.map(([c, r], i, arr) => {
        const j = (i === 0 || i === arr.length - 1) ? 0 : 1, h = rnd(Math.imul(c + 11, 374761393) ^ Math.imul(r + 5, 668265263));
        return [M + c * S + 14 + j * (h - 0.5) * jitter, M + r * S + 14 + j * (rnd(h * 1e9 | 0) - 0.5) * jitter];
    });
    if (pts.length < 2) return '';
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
        d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}

// Отрисовка рельефа. opts.player — как видят игроки (туман прячет клетки), иначе вид мастера
export function renderTerrain(def, { player = false, art = true } = {}) {
    const { cols, rows } = def;
    const fogOf = (c, r) => fogAt(def, c, r);
    const visible = player ? (c, r) => fogOf(c, r) > 0 : null;
    const lv = levels(def, visible);
    const opOf = (c, r) => player ? FOG_OPACITY[fogOf(c, r)] : 1;
    const showArt = art && def.look?.art !== false;

    // Тона клеток: подряд идущие клетки одного цвета и прозрачности склеиваем в один прямоугольник
    let tones = '';
    for (let r = 0; r < rows; r++) {
        let run = null;
        const flush = () => { if (run) tones += `<rect x="${M + run.c * S}" y="${M + r * S}" width="${run.n * S}" height="${S}" fill="${run.fill}"${run.op < 1 ? ` opacity="${run.op}"` : ''}/>`; run = null; };
        for (let c = 0; c < cols; c++) {
            const t = terAt(def, c, r), op = opOf(c, r);
            if (!t || op === 0 || !showArt) { flush(); continue; }
            const fill = TONES[t][lv[r * cols + c]];
            if (run && run.fill === fill && run.op === op) run.n++;
            else { flush(); run = { c, n: 1, fill, op }; }
        }
        flush();
    }

    // Границы местностей и берега
    const edgeGroups = {}, shoreGroups = {};
    const addSeg = (groups, op, seg) => { (groups[op] = groups[op] || []).push(seg); };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const t = terAt(def, c, r);
        if (visible && !visible(c, r)) continue;
        const x = M + c * S, y = M + r * S;
        const edge = (nc, nr, seg) => {
            if (nc >= cols || nr >= rows) return;
            if (visible && !visible(nc, nr)) return;
            const nt = terAt(def, nc, nr);
            if (nt === t || (!t && !nt)) return;
            const op = Math.min(opOf(c, r), opOf(nc, nr));
            if (t === 'water' || nt === 'water') addSeg(shoreGroups, op, seg); else addSeg(edgeGroups, op, seg);
        };
        edge(c + 1, r, `M${x + S} ${y}v${S}`);
        edge(c, r + 1, `M${x} ${y + S}h${S}`);
    }
    let edges = '';
    if (showArt) {
        for (const [op, segs] of Object.entries(edgeGroups)) edges += `<path d="${segs.join('')}" fill="none" stroke="${INK}" stroke-opacity="${(0.55 * op).toFixed(2)}" stroke-width="1" stroke-linecap="square"/>`;
        for (const [op, segs] of Object.entries(shoreGroups)) edges += `<path d="${segs.join('')}" fill="none" stroke="${WATER_INK}" stroke-opacity="${op}" stroke-width="1.4" stroke-linecap="square"/>`;
    }

    // Значки местности, сверху вниз, чтобы ближние перекрывали дальние
    const placeAt = new Set((def.places || []).filter(p => !(player && p.hidden)).map(p => keyOf(p.c, p.r)));
    const glyphs = [];
    if (showArt) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const t = terAt(def, c, r), op = opOf(c, r);
            if (!t || op === 0 || placeAt.has(keyOf(c, r))) continue;
            let l = lv[r * cols + c];
            // В глубине большого хребта крупные пики через клетку — иначе массив сливается в сплошную штриховку
            if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
            const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
            const [cx, cy] = cellCenter(c, r);
            const k = [1.55, 1.85, 2.25][l];
            const gop = op === 1 ? 1 : op === FOG_OPACITY[2] ? 0.8 : op;
            glyph(t, cx, cy, k, rr, l).forEach(g => glyphs.push({ ...g, op: gop, sw: l === 2 ? 1.15 : 1 }));
        }
        glyphs.sort((a, b) => a.y - b.y);
    }
    const glyphSvg = glyphs.map(g => `<path d="${g.d}" fill="${g.fill}" stroke="${g.stroke}"${g.op < 1 ? ` opacity="${g.op}"` : ''}${g.sw !== 1 ? ` stroke-width="${g.sw}"` : ''}/>`).join('');

    // Тропы, дороги, реки
    let roads = '';
    for (const rd of def.roads || []) {
        if (player && rd.hidden) continue;
        const runs = player ? splitRuns(rd.cells, (c, r) => fogOf(c, r) > 0) : [rd.cells];
        for (const cells of runs) {
            const d = roadPath(cells);
            if (!d) continue;
            const ghost = !player && rd.hidden ? ' opacity="0.45"' : '';
            const dataAttr = player ? '' : ` data-road="${esc(rd.id)}"`;
            if (rd.kind === 'river') {
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/><path d="${d}" fill="none" stroke="${WATER_INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
            } else if (rd.kind === 'road') {
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${INK}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
            } else {
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4" stroke-dasharray="5 3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
            }
        }
    }

    // Поселения
    let places = '';
    for (const p of def.places || []) {
        if (player && (p.hidden || fogOf(p.c, p.r) === 0)) continue;
        const [x, y] = cellCenter(p.c, p.r);
        const op = placeOpacity(def, p, player);
        const parts = placeGlyph(p.type, x, y - 2, 1.6);
        places += `<g data-place="${esc(p.id)}"${op < 1 ? ` opacity="${op}"` : ''}>` + parts.map(pt => `<path d="${pt.d}" fill="${pt.fill}" stroke="${pt.stroke}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>`).join('') + '</g>';
    }
    const placeNames = renderPlaceNames(def, { player });

    // Граница известных земель (пунктир по краю тумана) и штриховка тумана для мастера
    let fogEdge = '', fogShade = '';
    if (def.fog && def.fog.includes('0')) {
        let segs = '';
        // Внешний край сетки не обводим: туман рисуется только между клетками
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const k = fogOf(c, r) > 0, x = M + c * S, y = M + r * S;
            if (r > 0 && (fogOf(c, r - 1) > 0) !== k) segs += `M${x} ${y}h${S}`;
            if (c > 0 && (fogOf(c - 1, r) > 0) !== k) segs += `M${x} ${y}v${S}`;
        }
        fogEdge = `<path d="${segs}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="6 4" stroke-linecap="butt"/>`;
    }
    if (!player && def.fog) {
        const shades = { 0: '', 1: '', 2: '' };
        for (let r = 0; r < rows; r++) {
            let run = null;
            const flush = () => { if (run) shades[run.f] += `M${M + run.c * S} ${M + r * S}h${run.n * S}v${S}h${-run.n * S}Z`; run = null; };
            for (let c = 0; c < cols; c++) {
                const f = fogOf(c, r);
                if (f === 3) { flush(); continue; }
                if (run && run.f === f) run.n++; else { flush(); run = { c, n: 1, f }; }
            }
            flush();
        }
        if (shades[0]) fogShade += `<path d="${shades[0]}" fill="url(#fog-hatch)"/>`;
        if (shades[1]) fogShade += `<path d="${shades[1]}" fill="${PAPER}" opacity="0.42"/>`;
        if (shades[2]) fogShade += `<path d="${shades[2]}" fill="${PAPER}" opacity="0.2"/>`;
    }

    return { tones, edges, glyphs: glyphSvg, roads, places, placeNames, fogEdge, fogShade };
}

function placeOpacity(def, p, player) {
    return player ? Math.max(FOG_OPACITY[fogAt(def, p.c, p.r)], 0.6) : (p.hidden ? 0.45 : 1);
}
export function renderPlaceNames(def, { player = false } = {}) {
    let out = '';
    for (const p of def.places || []) {
        if (!p.name || (player && (p.hidden || fogAt(def, p.c, p.r) === 0))) continue;
        const [x, y] = cellCenter(p.c, p.r), op = placeOpacity(def, p, player);
        out += `<text x="${x}" y="${y + 30}" class="place-name"${op < 1 ? ` opacity="${op}"` : ''}>${esc(p.name)}${!player && p.hidden ? ' ◌' : ''}</text>`;
    }
    return out;
}

function splitRuns(cells, ok) {
    const runs = []; let cur = [];
    for (const cell of cells) {
        if (ok(cell[0], cell[1])) cur.push(cell);
        else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
}

// Маска для картинки-подложки у игроков: под туманом картинку не видно, «по слухам» — бледно
export function fogMask(def, id) {
    const { cols, rows } = def;
    let rects = '';
    for (let r = 0; r < rows; r++) {
        let run = null;
        const flush = () => { if (run) rects += `<rect x="${M + run.c * S}" y="${M + r * S}" width="${run.n * S}" height="${S}" fill="#fff"${run.f < 3 ? ` fill-opacity="${FOG_OPACITY[run.f]}"` : ''}/>`; run = null; };
        for (let c = 0; c < cols; c++) {
            const f = fogAt(def, c, r);
            if (f === 0) { flush(); continue; }
            if (run && run.f === f) run.n++; else { flush(); run = { c, n: 1, f }; }
        }
        flush();
    }
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${M * 2 + cols * S}" height="${M * 2 + rows * S}">${rects}</mask>`;
}

// То, что уходит игрокам: под туманом нет местности, нет тайных поселений и дорог
export function playerProjection(def) {
    const { cols, rows } = def;
    let terrain = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) terrain += fogAt(def, c, r) > 0 ? def.terrain[r * cols + c] : '.';
    const roads = [];
    for (const rd of def.roads || []) {
        if (rd.hidden) continue;
        splitRuns(rd.cells, (c, r) => fogAt(def, c, r) > 0).forEach((cells, i) => roads.push({ ...rd, id: rd.id + '-' + i, cells }));
    }
    return {
        ...def, terrain,
        places: (def.places || []).filter(p => !p.hidden && fogAt(def, p.c, p.r) > 0),
        roads
    };
}

// --- Генератор: случайная местность в духе исходного эскиза ---
const VNAMES = ['Ольховка', 'Сухой Брод', 'Выселки', 'Мельничье', 'Козья Гать', 'Ракитное', 'Погост', 'Заречье', 'Липовец', 'Горелое',
    'Вороний Яр', 'Старая Гать', 'Колодези', 'Бережки', 'Кривой Лог', 'Чернотроп', 'Ясенки', 'Лихой Бор'];

export function generateDef({ cols = 25, rows = 25, seed = 0, villages = true, knownCircle = true } = {}) {
    const def = emptyDef(cols, rows);
    const s1 = 11 + seed * 7919, s2 = 29 + seed * 104729;
    let terrain = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const n = vnoise(c + 3, r + 3, 9, s1) * 0.8 + vnoise(c, r, 4, s2) * 0.2;
        terrain += n < 0.33 ? 'w' : n < 0.4 ? 's' : n < 0.55 ? 'p' : n < 0.65 ? 'f' : n < 0.74 ? 'h' : 'm';
    }
    def.terrain = terrain;
    const W = M * 2 + cols * S, H = M * 2 + rows * S, C = [W / 2, H / 2], R = (Math.min(cols, rows) * S) * 0.46;
    if (knownCircle) {
        let fog = '';
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const [x, y] = cellCenter(c, r), dist = Math.hypot(x - C[0], y - C[1]), q = dist / R;
            fog += q < 0.55 ? '3' : q < 0.85 ? '2' : dist <= R + S * 0.75 ? '1' : '0';
        }
        def.fog = fog;
    }
    if (villages) {
        const lv = levels(def, null);
        const cand = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const t = terAt(def, c, r), f = fogAt(def, c, r);
            if (f < 2) continue;
            if (t === 'plains' || t === 'hills' || (t === 'forest' && lv[r * cols + c] === 0)) cand.push({ c, r, h: rnd(Math.imul(c + 3 + seed, 2246822519) ^ Math.imul(r + 7, 3266489917)) });
        }
        cand.sort((a, b) => a.h - b.h);
        const want = Math.max(3, Math.round(7 * cols * rows / 625));
        const vs = [];
        for (const o of cand) {
            if (vs.length >= want) break;
            if (vs.every(v => Math.max(Math.abs(v.c - o.c), Math.abs(v.r - o.r)) >= 4)) vs.push(o);
        }
        def.places = vs.map((v, i) => ({ id: 'p' + i + '-' + seed, c: v.c, r: v.r, type: i < 2 ? 'town' : 'village', name: VNAMES[(i + seed) % VNAMES.length], hidden: false }));
        def.roads = autoTrails(def, def.places);
    }
    return def;
}

// Самые дешёвые пути между поселениями (остовное дерево по расстоянию)
export function autoTrails(def, places) {
    const { cols, rows } = def;
    if (places.length < 2) return [];
    const cost = (c, r) => ({ plains: 1, forest: 2.2, hills: 2, swamp: 4, mountains: 9, water: 60 }[terAt(def, c, r)] || 3);
    const id = (c, r) => r * cols + c;
    const path = (a, b) => {
        const N = cols * rows, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
        dist[id(a.c, a.r)] = 0;
        for (;;) {
            let u = -1, best = Infinity;
            for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
            if (u < 0 || u === id(b.c, b.r)) break;
            done[u] = 1;
            const uc = u % cols, ur = (u / cols) | 0;
            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const c = uc + dc, r = ur + dr;
                if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
                const v = id(c, r), w = best + cost(c, r) * (dc && dr ? 1.42 : 1);
                if (w < dist[v]) { dist[v] = w; prev[v] = u; }
            }
        }
        const out = [];
        for (let v = id(b.c, b.r); v >= 0; v = prev[v]) out.unshift([v % cols, (v / cols) | 0]);
        return out;
    };
    const inT = [places[0]], rest = places.slice(1), edges = [];
    while (rest.length) {
        let bi = 0, bj = 0, bd = Infinity;
        inT.forEach((a, i) => rest.forEach((b, j) => { const d = Math.hypot(a.c - b.c, a.r - b.r); if (d < bd) { bd = d; bi = i; bj = j; } }));
        edges.push([inT[bi], rest[bj]]);
        inT.push(rest.splice(bj, 1)[0]);
    }
    return edges.map(([a, b], i) => ({ id: 'r' + i + '-' + Date.now().toString(36), kind: 'trail', cells: path(a, b), hidden: false })).filter(r => r.cells.length > 1);
}

// Клетки на отрезке между двумя клетками (чтобы быстрая кисть не оставляла пропусков)
export function cellLine(c0, r0, c1, r1) {
    const out = [], n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 0;
        out.push([Math.round(c0 + (c1 - c0) * t), Math.round(r0 + (r1 - r0) * t)]);
    }
    return out;
}

// Легенда: значки уровней для каждой местности
export function legendGlyph(t, l) {
    return glyph(t, 0, 0, [0.95, 0.85, 0.75][l], () => 0.5, l);
}
