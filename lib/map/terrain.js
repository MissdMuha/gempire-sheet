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

export const TER_CODES = { w: 'water', s: 'swamp', b: 'wetwood', p: 'plains', u: 'plateau', f: 'forest', c: 'conifer', h: 'hills', m: 'mountains' };
export const TER_CHAR = { water: 'w', swamp: 's', wetwood: 'b', plains: 'p', plateau: 'u', forest: 'f', conifer: 'c', hills: 'h', mountains: 'm' };
export const TER_NAMES = { water: 'Вода', swamp: 'Топь', wetwood: 'Заболоченный лес', plains: 'Равнина', plateau: 'Плато', forest: 'Лес', conifer: 'Ельник', hills: 'Холмы', mountains: 'Горы' };
export const LV = {
    forest: ['Лесок', 'Лес', 'Чаща'], conifer: ['Редкий ельник', 'Ельник', 'Глухой ельник'], hills: ['Пригорки', 'Холмы', 'Взгорье'], mountains: ['Предгорья', 'Горы', 'Хребет'],
    swamp: ['Сырой луг', 'Топь', 'Трясина'], wetwood: ['Сырой лес', 'Заболоченный лес', 'Затопленный лес'], water: ['Мелководье', 'Озеро', 'Глубокие воды'], plains: ['Равнина', 'Равнина', 'Равнина'], plateau: ['Плато', 'Плато', 'Плато']
};
export const TONES = {
    water: ['#DCE3DE', '#CFD9D5', '#C1CFCB'], forest: ['#EAE4CC', '#E1DBC0', '#D6D0B1'], conifer: ['#E6E4CC', '#DCDAC0', '#D0CEB1'], mountains: ['#E9DFC9', '#DFD4BC', '#D3C7AC'],
    hills: ['#F2E8CF', '#EBDFC3', '#E3D5B5'], swamp: ['#E7E5D1', '#DDDCC5', '#D1D1B6'], wetwood: ['#E3E5D0', '#D7DECC', '#CBD6CB'], plateau: ['#E9DFC9', '#E9DFC9', '#E9DFC9'], plains: ['#F4EDDD', '#F4EDDD', '#F4EDDD']
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
export function T(p, dx, dy, k) {
    return p.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, a, b) => (dx + a * k).toFixed(1) + ' ' + (dy + b * k).toFixed(1));
}

// --- Формы значков местности ---
export const SH = {
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
    pool: 'M-11 -9L-5 -9M-12 -7L-7 -7M6 -10L11 -10M5 -8L9 -8',
    // Тень на восточных склонах (свет с северо-запада) — для стилей с гравюрной штриховкой
    peakShade: 'M1.2 -6.5L2.2 8.6M3 -2.5L4.3 8.6M5 1.5L6.6 8.7M7.2 4.6L8.8 8.9M9 6.6L10.2 9',
    moundShade: 'M2 -6.8L2.6 -1M4.2 -6.3L5 0.5M6.4 -5L7.4 2.2M8.4 -3L9.5 4.2M10 -0.5L10.6 5',
    seaDash: 'M-6 0L-1 0M2 0L6 0M-3 3L3 3',
    // Заболоченный лес: вода у стволов и сухостой
    wetLines: 'M-7 10.6L-1.6 10.6M1.6 10.6L7 10.6M-4.6 12.8L-0.8 12.8M1.2 12.8L4.8 12.8',
    // Плато: пашня полосами и обрыв по краю
    snag: 'M0 10L0 -8M0 -1.5L-4.6 -6.2L-5.2 -9M0 2.5L4.2 -1.8L5.8 -3.2M0 -8L-1.2 -10.4M0 -8L1.4 -9.8'
};
export const LAYOUT = {
    forest: [[[-2, 1, 0.55], [6, 5, 0.42]], [[-6, -3, 0.62], [6, -4, 0.6], [0, 3, 0.7]], [[-9, -7, 0.72], [3, -9, 0.7], [10, 0, 0.72], [-5, 2, 0.8], [3, 7, 0.78], [-11, 8, 0.66]]],
    mountains: [[[0, 3, 0.62]], [[6, -1, 0.62], [-3, 1, 0.92]], [[-10, 2, 0.85], [10, 0, 0.9], [0, -2, 1.3]]],
    hills: [[[0, 3, 0.55]], [[5, -2, 0.62], [-3, 3, 0.78]], [[-7, -3, 0.8], [7, -4, 0.75], [0, 5, 1.0]]]
};

// Значок местности для клетки: список частей { d, fill, stroke, y } (y — для порядка отрисовки сверху вниз).
// opt — для новых стилей: jitter (разброс), flip (зеркальная раскладка), vary (разброс размера),
// shade (штриховка теней), water: 'deep' (волны только на глубине) или 'none'
export function glyph(t, x, y, k, rr, lvl = 1, opt = {}) {
    const P = PANEL, I = INK, W = WATER_INK, H = SH, out = [];
    const firOnly = t === 'conifer';
    if (firOnly) t = 'forest';
    const amp = opt.jitter ?? 3, fx = opt.flip ? -1 : 1, vary = opt.vary || 0;
    const sz = (i, s) => s * (1 + (rr(i + 50) - 0.5) * vary);
    const Tr = (p, dx, dy, s) => T(p, x + dx * k, y + dy * k, s * k);
    const part = (d, fill, stroke, yy, thin) => out.push(thin ? { d, fill, stroke, y: yy, thin } : { d, fill, stroke, y: yy });
    const jx = (i) => (rr(i + 20) - 0.5) * amp, jy = (i) => (rr(i + 30) - 0.5) * amp;
    if (t === 'forest') {
        LAYOUT.forest[lvl].forEach(([dx, dy, s0], i) => {
            const s = sz(i, s0);
            const fir = firOnly || rr(i + 3) < (lvl === 2 ? 0.5 : 0.3), a = fx * dx + jx(i), b = dy + jy(i);
            part(Tr(fir ? H.fir : H.crown, a, b, s), P, I, y + b * k);
            part(Tr(fir ? H.firD : H.crownD, a, b, s), 'none', I, y + b * k + 0.01);
        });
    } else if (t === 'mountains') {
        LAYOUT.mountains[lvl].forEach(([dx, dy, s0], i) => {
            const s = sz(i, s0), a = fx * dx + jx(i), b = dy + jy(i);
            part(Tr(H.peak, a, b, s), P, I, y + b * k + 4);
            part(Tr(H.peakD + (lvl === 2 && s0 > 1 ? H.snow : ''), a, b, s), 'none', I, y + b * k + 4.01);
            if (opt.shade) part(Tr(H.peakShade, a, b, s), 'none', I, y + b * k + 4.02, true);
        });
    } else if (t === 'hills') {
        LAYOUT.hills[lvl].forEach(([dx, dy, s0], i) => {
            const s = sz(i, s0), a = fx * dx + jx(i), b = dy + jy(i);
            part(Tr(H.mound, a, b, s), P, I, y + b * k + 3);
            part(Tr(H.moundD, a, b, s), 'none', I, y + b * k + 3.01);
            if (opt.shade) part(Tr(H.moundShade, a, b, s), 'none', I, y + b * k + 3.02, true);
        });
    } else if (t === 'wetwood') {
        // Деревья стоят в воде: у края — сырой лес, в глубине — реже, с сухостоем
        LAYOUT.forest[lvl].forEach(([dx, dy, s0], i) => {
            if (lvl === 2 && i % 2) return;
            const s = sz(i, s0) * 0.95, a = fx * dx + jx(i), b = dy + jy(i);
            const dead = lvl >= 1 && rr(i + 3) < (lvl === 2 ? 0.45 : 0.2);
            if (dead) part(Tr(H.snag, a, b, s), 'none', I, y + b * k);
            else {
                // крона поменьше на высоком голом стволе — дерево стоит в воде
                part(Tr(H.crown, a, b - 3 * s, s * 0.85), P, I, y + b * k);
                part(Tr('M0 0.6L0 10.4', a, b, s), 'none', I, y + b * k + 0.01);
            }
            if (lvl >= 1 || rr(i + 7) < 0.5) part(Tr(H.wetLines, a, b, s), 'none', W, y + b * k + 0.02, true);
        });
    } else if (t === 'swamp') {
        if (lvl === 0) part(Tr(H.tuft, jx(1), jy(1) + 2, 1.2), 'none', I, y);
        else {
            part(Tr(H.reeds, jx(1), jy(1), lvl === 2 ? 0.9 : 0.75), 'none', I, y);
            part(Tr(H.head, jx(1), jy(1), lvl === 2 ? 0.9 : 0.75), I, I, y + 0.01);
            if (lvl === 2) part(Tr(H.pool, 0, 0, 1), 'none', W, y + 0.02);
        }
    } else if (t === 'water') {
        if (opt.water === 'none' || (opt.water === 'deep' && (lvl < 2 || rr(9) < 0.45))) return out;
        const rows = opt.water === 'deep' ? [[(rr(11) - 0.5) * 8, (rr(12) - 0.5) * 8, 0.5]]
            : lvl === 0 ? (rr(5) < 0.5 ? [[0, 0, 0.45]] : []) : lvl === 1 ? [[0, 0, 0.55]] : [[-2, -4, 0.55], [3, 4, 0.55]];
        rows.forEach(([dx, dy, s], i) => part(Tr(H.wave, dx + jx(i), dy, s), 'none', W, y + i * 0.01));
    } else if (t === 'plateau') {
        // ровный каменистый верх: невысокий скальный выход или трава
        const v = rr(7), a = (rr(2) - 0.5) * 8, b = (rr(3) - 0.5) * 8;
        if (v < 0.25) { part(Tr(H.peak, a, b + 4, 0.38), P, I, y + b * k + 4); part(Tr(H.peakD, a, b + 4, 0.38), 'none', I, y + b * k + 4.01, true); }
        else if (v < 0.65) part(Tr(H.tuft, a, b, 0.9), 'none', I, y);
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
        tier: '0'.repeat(cols * rows),
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
    let terrain = '', fog = '', tier = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const oc = c - shiftC, or = r - shiftR, inside = oc >= 0 && or >= 0 && oc < def.cols && or < def.rows;
        terrain += inside ? def.terrain[or * def.cols + oc] : (def.terrain.includes('p') ? 'p' : '.');
        fog += inside ? (def.fog ? def.fog[or * def.cols + oc] : '3') : '3';
        tier += inside && def.tier ? (def.tier[or * def.cols + oc] || '0') : '0';
    }
    const inGrid = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
    // Картинка-подложка и показанное игрокам место сдвигаются вместе с клетками
    const dx = shiftC * S, dy = shiftR * S;
    return {
        ...def, cols, rows, terrain, fog, tier,
        image: def.image ? { ...def.image, x: def.image.x + dx, y: def.image.y + dy } : def.image,
        view: def.view ? { ...def.view, x: def.view.x + dx, y: def.view.y + dy } : def.view,
        places: (def.places || []).map(p => ({ ...p, c: p.c + shiftC, r: p.r + shiftR })).filter(p => inGrid(p.c, p.r)),
        roads: (def.roads || []).map(rd => ({ ...rd, cells: rd.cells.map(([c, r]) => [c + shiftC, r + shiftR]).filter(([c, r]) => inGrid(c, r)) })).filter(rd => rd.cells.length > 1)
    };
}

// Уровень «густоты» клетки: 0 у края своей местности, 2 в глубине
// Глубина каждой клетки (сколько клеток до края своей местности, по 8 соседям) и глубина всего массива,
// в который клетка входит. За краем карты местность считается продолжающейся
export function depthMap(def, sameAs) {
    const { cols, rows } = def, n = cols * rows, D = new Float32Array(n), comp = new Int32Array(n).fill(-1), q = [];
    const nb = (c, r, f) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dc && !dr) continue; const nc = c + dc, nr = r + dr; if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) f(nc, nr); } };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let edge = false;
        nb(c, r, (nc, nr) => { if (!sameAs(c, r, nc, nr)) edge = true; });
        D[r * cols + c] = edge ? 1 : Infinity;
        if (edge) q.push(r * cols + c);
    }
    for (let i = 0; i < q.length; i++) {
        const v = q[i], c = v % cols, r = (v / cols) | 0;
        nb(c, r, (nc, nr) => { const u = nr * cols + nc; if (D[u] === Infinity && sameAs(c, r, nc, nr)) { D[u] = D[v] + 1; q.push(u); } });
    }
    for (let i = 0; i < n; i++) if (D[i] === Infinity) D[i] = 6;
    // массивы: связные куски одной местности и их наибольшая глубина
    const maxD = [];
    for (let i = 0; i < n; i++) {
        if (comp[i] >= 0) continue;
        const id = maxD.length, stack = [i];
        comp[i] = id; let m = 0;
        while (stack.length) {
            const v = stack.pop(), c = v % cols, r = (v / cols) | 0;
            m = Math.max(m, D[v]);
            nb(c, r, (nc, nr) => { const u = nr * cols + nc; if (comp[u] < 0 && sameAs(c, r, nc, nr)) { comp[u] = id; stack.push(u); } });
        }
        maxD.push(m);
    }
    return { D, massif: i => maxD[comp[i]] };
}
// Ступень 0..2 по глубине: глубина от края, а в небольшом массиве — ещё и относительно его размера
// (у массива глубиной 2 клетки край — первая ступень, середина — третья)
export function autoTier(d, dmax) {
    const abs = Math.min(2, Math.max(0, d - 1));
    const rel = dmax > 1 ? Math.min(2, 2 * (d - 1) / (dmax - 1)) : 0;
    return Math.max(abs, rel);
}

function levels(def, visible, relative = false) {
    const { cols, rows } = def, out = new Uint8Array(cols * rows);
    let dm = null;
    if (relative) {
        const tv = (c, r) => (visible && !visible(c, r)) ? null : terAt(def, c, r);
        dm = depthMap(def, (c, r, nc, nr) => tv(c, r) === tv(nc, nr));
    }
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
        const set = tierAt(def, c, r), i = r * cols + c;
        out[i] = set ? set - 1 : dm ? Math.round(autoTier(dm.D[i], dm.massif(i))) : ring(1) ? 0 : ring(2) ? 1 : 2;
    }
    return out;
}

// Ступень местности, заданная мастером кистью: 1 — лесок/предгорья, 2 — лес/горы, 3 — чаща/хребет; 0 — сама по глубине
export function tierAt(def, c, r) {
    if (!def.tier || c < 0 || r < 0 || c >= def.cols || r >= def.rows) return 0;
    const v = def.tier.charCodeAt(r * def.cols + c) - 48;
    return v >= 1 && v <= 3 ? v : 0;
}

export function terrainLevels(def, relative = false) { return levels(def, null, relative); }

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

// Насколько местность высока — чтобы знать, где край плато обрывается вниз
export const TER_RANK = { water: 0, swamp: 1, wetwood: 1, plains: 2, forest: 2, conifer: 2, hills: 3, plateau: 4, mountains: 5 };

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
    // Обрыв плато — видом сбоку, как горы: под южным краем клетки плато (если ниже лежит местность ниже) — скальная стена,
    // на остальных краях, где снаружи ниже, — жирная кромка. Стена — в общем порядке значков (по её низу)
    let cliff = '';
    const wallGlyphs = [], wallBelow = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (terAt(def, c, r) !== 'plateau' || (visible && !visible(c, r))) continue;
        const x = M + c * S, y = M + r * S, op = opOf(c, r);
        const low = (nc, nr) => { const nt = terAt(def, nc, nr); return !!nt && !(visible && !visible(nc, nr)) && (TER_RANK[nt] ?? 2) < TER_RANK.plateau; };
        if (low(c + 1, r)) cliff += `M${x + S} ${y}v${S}`;
        if (low(c - 1, r)) cliff += `M${x} ${y}v${S}`;
        if (low(c, r - 1)) cliff += `M${x} ${y}h${S}`;
        if (!low(c, r + 1)) continue;
        wallBelow.add(keyOf(c, r + 1));
        // три контрфорса на клетку: низ фестоном (осыпь), излом посередине, правая половина в тени
        const y0 = y + S, hr = k => rnd(Math.imul(c * 3 + k + 3, 2246822519) ^ Math.imul(r + 7, 3266489917));
        const n = 3, bw = S / n, H = 12 + hr(9) * 3;
        let fillD = `M${x - 0.3} ${y0}h${S + 0.6}`, baseD = '', lines = `M${x} ${y0}h${S}`, hatch = '';
        const pts = [];
        for (let i = 0; i <= n * 4; i++) {
            const u = (i % 4) / 4, bi = Math.floor(i / 4), xx = x + i * bw / 4;
            pts.push([xx, y0 + H * (0.72 + 0.3 * Math.sin(Math.PI * (i === n * 4 ? 1 : u))) * (0.92 + hr(bi) * 0.16)]);
        }
        for (let i = pts.length - 1; i >= 0; i--) fillD += `L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
        fillD += 'Z';
        baseD = 'M' + pts.map(([px, py]) => px.toFixed(1) + ' ' + py.toFixed(1)).join('L');
        for (let bi = 0; bi < n; bi++) {
            const bx = x + bi * bw, mid = bx + bw / 2, hb = pts[bi * 4 + 2][1] - y0;
            if (bi) lines += `M${bx.toFixed(1)} ${y0}L${(bx + 0.4).toFixed(1)} ${(pts[bi * 4][1] - 0.3).toFixed(1)}`;
            lines += `M${mid.toFixed(1)} ${y0 + 0.5}L${(mid - 0.6).toFixed(1)} ${(y0 + hb * 0.45).toFixed(1)}L${(mid + 0.3).toFixed(1)} ${(y0 + hb * 0.8).toFixed(1)}`;
            for (const t of [0.66, 0.84]) hatch += `M${(bx + bw * t).toFixed(1)} ${(y0 + 1.5).toFixed(1)}L${(bx + bw * t + 1.4).toFixed(1)} ${(y0 + hb * (0.55 + hr(bi + 4) * 0.2)).toFixed(1)}`;
        }
        if (low(c - 1, r)) lines += `M${x} ${y0}V${pts[0][1].toFixed(1)}`;
        if (low(c + 1, r)) lines += `M${x + S} ${y0}V${pts[pts.length - 1][1].toFixed(1)}`;
        const yb = y0 + H;
        wallGlyphs.push({ d: fillD, fill: PANEL, stroke: 'none', y: yb, op });
        wallGlyphs.push({ d: lines + baseD, fill: 'none', stroke: INK, y: yb + 0.001, op });
        wallGlyphs.push({ d: hatch, fill: 'none', stroke: INK, thin: true, y: yb + 0.002, op });
    }
    let edges = '';
    if (showArt) {
        if (cliff) edges += `<path d="${cliff}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`;
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
            const [cx, cy0] = cellCenter(c, r), cy = wallBelow.has(keyOf(c, r)) ? cy0 + 5 : cy0; // под стеной плато — чуть ниже
            const k = [1.55, 1.85, 2.25][l];
            const gop = op === 1 ? 1 : op === FOG_OPACITY[2] ? 0.8 : op;
            glyph(t, cx, cy, k, rr, l).forEach(g => glyphs.push({ ...g, op: gop, sw: l === 2 ? 1.15 : 1 }));
        }
        wallGlyphs.forEach(g => glyphs.push({ ...g, op: g.op === 1 ? 1 : g.op, sw: g.thin ? 0.6 : 0.9 }));
        glyphs.sort((a, b) => a.y - b.y);
    }
    const glyphSvg = glyphs.map(g => `<path d="${g.d}" fill="${g.fill}" stroke="${g.stroke}"${g.op < 1 ? ` opacity="${g.op}"` : ''}${g.sw !== 1 ? ` stroke-width="${g.sw}"` : ''}/>`).join('');

    const { roads, places, placeNames } = renderRoadsAndPlaces(def, { player });

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

// Река «как в природе»: извилистая, у истока тонкая, к устью шире. Рисуется лентой переменной ширины.
// Устье — тот конец, что у края карты (сильнее всего), у воды или болота; исток — у гор. Иначе — как провёл мастер
function naturalRiver(def, rd, player, waterAt) {
    const cells = rd.cells;
    if (cells.length < 2) return '';
    const score = ([c, r]) => {
        let s = (c <= 0 || r <= 0 || c >= def.cols - 1 || r >= def.rows - 1) ? 2.5 : 0, w = 0, sw = 0, m = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const t = terAt(def, c + dc, r + dr);
            if (t === 'water') w = 1.5; else if (t === 'swamp' || t === 'wetwood') sw = 0.8; else if (t === 'mountains') m = 1; else if (t === 'hills') m = Math.max(m, 0.5);
        }
        return s + w + sw - m;
    };
    // река, ушедшая за край карты, течёт туда (даже если вытекает из озера)
    // rd.flow — мастер провёл реку от истока к устью, направление не угадываем
    const cs = !rd.flow && score(cells[0]) > score(cells[cells.length - 1]) + 0.3 ? cells.slice().reverse() : cells;
    const P = cs.map(([c, r], i, arr) => {
        const j = (i === 0 || i === arr.length - 1) ? 0 : 1, h = rnd(Math.imul(c + 11, 374761393) ^ Math.imul(r + 5, 668265263));
        return [M + c * S + 14 + j * (h - 0.5) * 9, M + r * S + 14 + j * (rnd(h * 1e9 | 0) - 0.5) * 9];
    });
    // извилины: между точками — смещённая вбок середина, то влево, то вправо
    const Q = [];
    for (let i = 0; i < P.length; i++) {
        Q.push(P[i]);
        if (i === P.length - 1) break;
        const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const h = rnd(Math.imul(cs[i][0] + 3, 2246822519) ^ Math.imul(cs[i][1] + 7, 3266489917));
        const off = (i % 2 ? 1 : -1) * (2.5 + h * 3.5) * Math.min(1, L / S);
        Q.push([(a[0] + b[0]) / 2 - dy / L * off, (a[1] + b[1]) / 2 + dx / L * off]);
    }
    // гладкая линия (квадратичные кривые через середины), частыми точками
    const pts = [Q[0]];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let from = Q[0];
    for (let i = 1; i < Q.length - 1; i++) {
        const ctl = Q[i], to = mid(Q[i], Q[i + 1]);
        for (let k = 1; k <= 6; k++) { const t = k / 6, u = 1 - t; pts.push([u * u * from[0] + 2 * u * t * ctl[0] + t * t * to[0], u * u * from[1] + 2 * u * t * ctl[1] + t * t * to[1]]); }
        from = to;
    }
    pts.push(Q[Q.length - 1]);
    const sAt = [0];
    for (let i = 1; i < pts.length; i++) sAt.push(sAt[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = sAt[sAt.length - 1] || 1, w0 = 1.0, w1 = 1.7 + Math.min(1.7, total / (S * 12) * 1.7);
    const width = i => w0 + (w1 - w0) * Math.pow(sAt[i] / total, 0.7);
    // у игроков — только по известному; по озеру река не рисуется (входит в него и выходит у берега)
    const runs = [];
    let cur = [];
    pts.forEach((p, i) => {
        const c = Math.floor((p[0] - M) / S), r = Math.floor((p[1] - M) / S);
        const ok = (!player || fogAt(def, c, r) > 0) && !(waterAt && waterAt(p[0], p[1]));
        if (ok) cur.push(i); else { if (cur.length > 1) runs.push(cur); cur = []; }
    });
    if (cur.length > 1) runs.push(cur);
    const f = v => v.toFixed(1);
    const ribbon = (idx, extra) => {
        const L = [], R = [];
        idx.forEach((i, k) => {
            const a = pts[idx[Math.max(0, k - 1)]], b = pts[idx[Math.min(idx.length - 1, k + 1)]];
            const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, hw = (width(i) + extra) / 2;
            L.push([pts[i][0] - dy / n * hw, pts[i][1] + dx / n * hw]); R.push([pts[i][0] + dy / n * hw, pts[i][1] - dx / n * hw]);
        });
        const all = L.concat(R.reverse());
        return 'M' + all.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z';
    };
    let out = '';
    for (const idx of runs) {
        const ends = [idx[0], idx[idx.length - 1]].map(i => `<circle cx="${f(pts[i][0])}" cy="${f(pts[i][1])}" r="${f(width(i) / 2)}"/>`).join('');
        out += `<path d="${ribbon(idx, 2.8)}" fill="${PANEL}" opacity="0.8"/><g fill="${WATER_INK}"><path d="${ribbon(idx, 0)}"/>${ends}</g>`;
    }
    return out;
}

// Тропы, дороги, реки и селения — общие для всех стилей местности. natural — реки «как в природе» (не для эскиза)
export function renderRoadsAndPlaces(def, { player = false, natural = false, waterAt = null } = {}) {
    const fogOf = (c, r) => fogAt(def, c, r);
    let roads = '';
    for (const rd of def.roads || []) {
        if (player && rd.hidden) continue;
        if (natural && rd.kind === 'river') {
            const svg = naturalRiver(def, rd, player, waterAt);
            if (svg) roads += `<g${!player && rd.hidden ? ' class="gm-hid"' : ''}${player ? '' : ` data-road="${esc(rd.id)}"`}>${svg}</g>`;
            continue;
        }
        const runs = player ? splitRuns(rd.cells, (c, r) => fogOf(c, r) > 0) : [rd.cells];
        for (const cells of runs) {
            const d = roadPath(cells);
            if (!d) continue;
            // скрытое от игроков мастер видит бледным (класс gm-hid; бледность можно выключить кнопкой «Скрытое»)
            const ghost = !player && rd.hidden ? ' class="gm-hid"' : '';
            const dataAttr = player ? '' : ` data-road="${esc(rd.id)}"`;
            if (rd.kind === 'river') {
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/><path d="${d}" fill="none" stroke="${WATER_INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
            } else if (rd.kind === 'road') {
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${INK}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
            } else {
                // тропа — одна пунктирная линия; узкая светлая подложка только отделяет её от значков
                roads += `<g${ghost}${dataAttr}><path d="${d}" fill="none" stroke="${PANEL}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4" stroke-dasharray="5 3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
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
        places += `<g data-place="${esc(p.id)}"${!player && p.hidden ? ' class="gm-hid"' : op < 1 ? ` opacity="${op}"` : ''}>` + parts.map(pt => `<path d="${pt.d}" fill="${pt.fill}" stroke="${pt.stroke}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>`).join('') + '</g>';
    }
    const placeNames = renderPlaceNames(def, { player });
    return { roads, places, placeNames };
}

function placeOpacity(def, p, player) {
    return player ? Math.max(FOG_OPACITY[fogAt(def, p.c, p.r)], 0.6) : 1;
}
export function renderPlaceNames(def, { player = false } = {}) {
    let out = '';
    for (const p of def.places || []) {
        if (!p.name || (player && (p.hidden || p.nameHidden || fogAt(def, p.c, p.r) === 0))) continue;
        // скрытое от игроков (селение или только название) мастер видит бледным, с ◌
        const [x, y] = cellCenter(p.c, p.r), op = placeOpacity(def, p, player), hid = !player && (p.hidden || p.nameHidden);
        // где подпись: под значком (обычно), или слева / справа / над ним — если внизу тесно
        const at = { left: [x - 17, y + 4, 'end'], right: [x + 17, y + 4, 'start'], above: [x, y - 19, 'middle'] }[p.lp] || [x, y + 30, null];
        out += `<text x="${at[0]}" y="${at[1]}" class="place-name${hid ? ' gm-hid' : ''}"${at[2] ? ` style="text-anchor:${at[2]}"` : ''}${!hid && op < 1 ? ` opacity="${op}"` : ''}>${esc(p.name)}${!player && (p.hidden || p.nameHidden) ? ' ◌' : ''}</text>`;
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
        // заметки к селениям — только мастеру; скрытое название игрокам не уходит
        places: (def.places || []).filter(p => !p.hidden && fogAt(def, p.c, p.r) > 0).map(({ note, ...p }) => p.nameHidden ? { ...p, name: '' } : p),
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
    const cost = (c, r) => ({ plains: 1, plateau: 1.2, forest: 2.2, conifer: 2.4, hills: 2, swamp: 4, wetwood: 3.4, mountains: 9, water: 60 }[terAt(def, c, r)] || 3);
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
