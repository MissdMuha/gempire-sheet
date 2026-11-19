// Сборка карты модуля «Никтонавты» по наброску мастера.
// Все фигуры заданы в координатах фото наброска (повёрнутого так, чтобы надписи читались),
// скрипт пересчитывает их в клетки. Запуск: node maps/nyctonauts.build.mjs → maps/nyctonauts.json
import { writeFileSync } from 'node:fs';
import { emptyDef, cellLine, rnd, S, M } from '../lib/map/terrain.js';

const COLS = 36, ROWS = 34;
// Котловина — круг: на наброске это шестиугольник с центром (930, 725) и «радиусами» 660 × 575
const C = [18, 16.6], R = 16.2;
const toCell = (x, y) => [C[0] + (x - 930) / 660 * R, C[1] + (y - 725) / 575 * R];
const toSketch = (c, r) => [930 + (c - C[0]) * 660 / R, 725 + (r - C[1]) * 575 / R];

// --- Фигуры наброска ---
// Внутренний край горного кольца (всё, что снаружи этого контура и внутри круга, — горы).
// На юге гор нет: контур уходит за край круга
const BASIN = [[405, 560], [410, 470], [500, 445], [620, 450], [720, 460], [750, 410], [900, 375], [1050, 368], [1200, 385], [1320, 425], [1400, 500],
    [1440, 580], [1445, 700], [1450, 850], [1470, 980], [1540, 1010], [1700, 1010], [1700, 1450], [450, 1450], [540, 1250], [480, 1100], [430, 950], [400, 800], [390, 650]];
// Нагорье с деревнями Гряда и Рыгиа: сверху холмы, снизу редкий ельник
const PLATEAU = [[410, 470], [460, 452], [540, 446], [620, 455], [690, 462], [735, 490], [758, 545], [765, 600], [740, 640], [690, 655], [620, 668], [560, 684], [500, 688], [455, 660], [420, 615], [405, 560]];
const SWAMP = [[555, 690], [700, 665], [880, 650], [1000, 660], [1090, 700], [1130, 800], [1140, 950], [1150, 1060], [1120, 1140], [1040, 1170],
    [900, 1172], [760, 1172], [670, 1165], [640, 1090], [625, 1000], [610, 920], [590, 860], [565, 790]];
// Чаща — наклонный овал поперёк восточного края болот
const THICKET = { c: [1085, 782], a: [865, 690], b: [1305, 876], w: 118 };
// Окна воды в болотах (центр ниже краёв — вода стоит посередине)
// окна — неправильной формы: каждое из нескольких кругов
const POOLS = [[880, 1015, 54], [845, 1058, 34], [930, 985, 26], [760, 1085, 30], [1010, 905, 30], [1052, 893, 22]];

const PLACES = [
    ['tower', 462, 420, 'Старая Кельча'],
    ['village', 412, 548, 'Гряда'],
    ['village', 688, 518, 'Рыгиа'],
    ['village', 603, 848, 'Мокрядь'],
    ['village', 978, 1296, 'Расторжье']
];
const ROADS = [
    // Большак: по южному краю котловины, на востоке уходит за горы
    ['road', [[590, 1296], [700, 1300], [850, 1300], [978, 1298], [1150, 1292], [1300, 1270], [1400, 1215], [1480, 1150], [1560, 1060], [1640, 980]]],
    // Тропа через ельник: с нагорья на Большак (к крестику на наброске)
    ['trail', [[600, 562], [640, 660], [600, 720], [560, 800], [540, 900], [550, 1000], [570, 1100], [590, 1200], [590, 1296]]],
    // Тропа вдоль болот: от Мокряди на Большак
    ['trail', [[560, 800], [603, 848], [650, 900], [690, 960], [700, 1060], [690, 1150], [700, 1298]]],
    // По нагорью: Гряда — Рыгиа, и вверх к Старой Кельче
    ['trail', [[412, 548], [520, 575], [600, 562], [688, 518]]],
    ['trail', [[412, 548], [440, 480], [462, 420]]],
    // Ручьи с гор стекают в котловину
    ['river', [[930, 330], [945, 450], [925, 560], [905, 655]]],
    ['river', [[1510, 560], [1420, 630], [1330, 700], [1250, 760]]]
];
const LABELS = [
    ['Болота', 880, 940, 'l'], ['Чаща', 1110, 800, 'l'], ['Лес', 1250, 520, 'l'],
    ['Большак', 790, 1270, 'm']
];

// --- Геометрия ---
function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
function distToPoly(x, y, poly) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
}
function inThicket(x, y) {
    const { c, a, b, w } = THICKET, ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy), half = L / 2;
    const px = x - c[0], py = y - c[1], along = (px * ux + py * uy) / L, across = (-px * uy + py * ux) / L;
    return (along / half) ** 2 + (across / w) ** 2 <= 1;
}
// Плавный шум, чтобы края областей не были циркульными
function noise(x, y, seed) {
    const gx = Math.floor(x), gy = Math.floor(y), u = x - gx, v = y - gy, s = t => t * t * (3 - 2 * t);
    const h = (a, b) => rnd(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ seed);
    const A = h(gx, gy), B = h(gx + 1, gy), Cc = h(gx, gy + 1), D = h(gx + 1, gy + 1);
    return A + (B - A) * s(u) + (Cc - A) * s(v) + (A - B - Cc + D) * s(u) * s(v) - 0.5;
}

// --- Клетки ---
const def = emptyDef(COLS, ROWS);
def.title = 'Никтонавты';
def.subtitle = '';
def.look = { ...def.look, style: 'engraving', glyphs: 'antique', spread: 'range' };
const T = new Array(COLS * ROWS).fill('.'), TIER = new Array(COLS * ROWS).fill('0'), FOG = new Array(COLS * ROWS).fill('0');
const kind = new Array(COLS * ROWS).fill(null);

for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c, cx = c + 0.5, cy = r + 0.5;
    const d = Math.hypot(cx - C[0], cy - C[1]);
    if (d > R) continue; // за кругом — неизвестные земли
    FOG[i] = '3';
    // точка наброска, чуть сдвинутая шумом — края областей становятся живыми
    const [sx0, sy0] = toSketch(cx, cy);
    const sx = sx0 + noise(cx / 2.4, cy / 2.4, 11) * 62 + noise(cx / 0.9, cy / 0.9, 13) * 26;
    const sy = sy0 + noise(cx / 2.4, cy / 2.4, 29) * 54 + noise(cx / 0.9, cy / 0.9, 31) * 22;
    if (!inPoly(sx, sy, BASIN)) { kind[i] = 'm'; continue; }
    if (inPoly(sx, sy, PLATEAU)) { kind[i] = sy < 600 ? 'h' : 'c'; continue; }
    if (POOLS.some(([px, py, pr]) => Math.hypot(sx0 - px, sy0 - py) < pr)) { kind[i] = 'w'; continue; }
    if (inThicket(sx, sy)) { kind[i] = 'thicket'; continue; }
    if (inPoly(sx, sy, SWAMP)) { kind[i] = 's'; continue; }
    // ельник — на западе, между горами и болотом, до самого Большака
    if (sx < 625 + noise(cx / 1.6, cy / 1.6, 47) * 40 && sy > 640) { kind[i] = 'c'; continue; }
    kind[i] = 'f';
}

const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? null : kind[r * COLS + c];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c, k = kind[i];
    if (!k) continue;
    const [sx, sy] = toSketch(c + 0.5, r + 0.5);
    if (k === 'm') {
        T[i] = 'm';
        // Горы: у внешнего края — хребет, к котловине — предгорья. На северо-востоке и востоке — самые высокие пики
        const dRim = R - Math.hypot(c + 0.5 - C[0], r + 0.5 - C[1]);
        const dIn = distToPoly(sx, sy, BASIN) / 40;
        const u = dRim / (dRim + dIn + 0.001);
        // «Самые высокие пики» — только на востоке и северо-востоке; север и запад — горы и предгорья
        const high = sx > 1250 && sy < 1000;
        TIER[i] = high ? (u < 0.8 ? '3' : '2') : (u < 0.22 ? '3' : u < 0.6 ? '2' : '1');
    } else if (k === 'thicket') { T[i] = 'f'; TIER[i] = '3'; }
    else if (k === 'f') {
        T[i] = 'f';
        // Лес: у болот и ельника — редкий, дальше — обычный лес
        let edge = false;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const n = at(c + dc, r + dr); if (n === 's' || n === 'c' || n === 'w') edge = true; }
        TIER[i] = edge ? '1' : '2';
    } else T[i] = k; // h, c, s, w — ступень сама по глубине
}
def.terrain = T.join('');
def.tier = TIER.join('');
def.fog = FOG.join('');

// --- Селения, дороги, подписи ---
// Набросок — шестиугольник с плоским югом, карта — круг: точки у самого края подтягиваем внутрь круга
function pullIn(c, r, margin = 0.95) {
    const dx = c - C[0], dy = r - C[1], d = Math.hypot(dx, dy), lim = R - margin;
    return d > lim ? [C[0] + dx * lim / d, C[1] + dy * lim / d] : [c, r];
}
const cellOf = (x, y, keepOut = false) => {
    let [c, r] = toCell(x, y);
    if (!keepOut) [c, r] = pullIn(c, r);
    return [Math.min(COLS - 1, Math.max(0, Math.floor(c))), Math.min(ROWS - 1, Math.max(0, Math.floor(r)))];
};
def.places = PLACES.map(([type, x, y, name], i) => { const [c, r] = cellOf(x, y); return { id: 'nk-p' + i, c, r, type, name, hidden: false }; });
def.roads = ROADS.map(([kind, pts], i) => {
    let cells = [];
    // последние точки Большака уходят за горы — их не подтягиваем
    pts.map(([x, y], j) => cellOf(x, y, kind === 'road' && j >= pts.length - 2)).forEach((cr, j, arr) => {
        if (!j) { cells.push(cr); return; }
        cellLine(arr[j - 1][0], arr[j - 1][1], cr[0], cr[1]).slice(1).forEach(p => cells.push(p));
    });
    cells = cells.filter((p, j) => !j || p[0] !== cells[j - 1][0] || p[1] !== cells[j - 1][1]);
    return { id: 'nk-r' + i, kind, cells, hidden: false };
});
const marks = LABELS.map(([text, x, y, size], i) => {
    const [c, r] = pullIn(...toCell(x, y), 1.6);
    return { id: 'nk-l' + i, kind: 'label', hidden: false, deleted: false, author: 'Мастер', data: { x: +(M + c * S).toFixed(1), y: +(M + r * S).toFixed(1), text, size, t: i + 1, gm: true } };
});

const out = { kind: 'gempire-map', def, marks };
writeFileSync(new URL('./nyctonauts.json', import.meta.url), JSON.stringify(out));
const count = ch => T.filter(x => x === ch).length;
console.log(`Никтонавты: ${COLS}×${ROWS}, горы ${count('m')}, лес ${count('f')}, ельник ${count('c')}, холмы ${count('h')}, топь ${count('s')}, вода ${count('w')}; селений ${def.places.length}, дорог ${def.roads.length}`);
