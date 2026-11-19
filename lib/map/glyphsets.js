// Значки местности для «Гравюры»: несколько наборов рисунков и несколько правил,
// как значки густеют и растут вглубь массива (леса, гор, холмов, топей).
import { S, M, PANEL, INK, WATER_INK, SH, LAYOUT, T, terAt, tierAt, depthMap, autoTier, rnd, keyOf, cellCenter } from './terrain.js';

// --- Наборы рисунков ---
export const GLYPH_SETS = {
    classic: { label: 'Как сейчас', hint: 'кроны-«леденцы», шатры гор, холмы-булочки' },
    antique: { label: 'Старинные', hint: 'тонкое перо: деревья со штрихованной тенью, острые пики с отрогами, пологие холмы' },
    topo: { label: 'Топографические', hint: 'мелкие условные знаки, горы и холмы — штрихами по склону' }
};
export const SPREADS = {
    grow: { label: 'Крупнее и гуще', hint: 'как сейчас: к середине больше значков и они крупнее' },
    dense: { label: 'Только гуще', hint: 'размер один, к середине значки стоят теснее' },
    range: { label: 'Три ступени', hint: 'лесок → лес → чаща, предгорья → горы → хребет со снежными вершинами: к середине значки крупнее, плотнее и темнее' },
    mass: { label: 'Массивом', hint: 'лес — одной кроной с волнистой опушкой, деревья только по краю' }
};

// Формы «старинного» набора: основание в (0, 0), рисунок вверх
const ANT = {
    tree: 'M-4.6 -4.2C-6.6 -4.6 -6.8 -7.6 -4.8 -8.6C-5 -11.4 -2 -12.8 0 -11.6C1.6 -13.4 4.8 -12.4 4.9 -9.8C6.8 -9 6.9 -5.6 4.9 -4.6C4 -3 -3.4 -2.8 -4.6 -4.2Z',
    treeD: 'M0 -3.6L0 0',
    treeS: 'M2.6 -9.6C3.6 -8.8 3.9 -7.4 3.5 -6.2M0.4 -5.4C1.8 -4.9 3 -5 3.8 -5.6M1.2 -8.2C1.9 -7.6 2.1 -6.9 2 -6.3M-2.2 0.2L2.6 0.2',
    fir: 'M0 -16L2.6 -11L1.4 -11L3.6 -6.6L2.2 -6.6L4.6 -2L-4.6 -2L-2.2 -6.6L-3.6 -6.6L-1.4 -11L-2.6 -11Z',
    firD: 'M0 -2L0 0.4',
    firS: 'M0.6 -11.8L1.8 -10.4M1 -7.4L2.6 -5.6M1.2 -3.4L3.4 -2.4',
    peak: 'M-12 0L-7.4 -7L-5.6 -5.8L-0.6 -17L3.8 -10.2L5.2 -11.4L12 0Z',
    peakD: 'M-0.6 -17L0.4 -12.6L-0.4 -9.4L1.2 -5.4L0.6 0M5.2 -11.4L6 -7.6L5.4 -4',
    peakS: 'M1.2 -13L2.6 -10.8M1.2 -10L3.2 -7.2M2.2 -6.6L4.8 -3.2M2.4 -3L5.2 -0.3M6.8 -8.4L8.6 -5.2M6.6 -4.4L9.4 -1M4.2 -1.2L5 -0.2',
    snow: 'M-2.4 -12.4L-1 -13.6L0.4 -12.2L1.8 -13.2',
    hill: 'M-11 0C-8.6 -5 -4.4 -7.8 0 -7.8C4.6 -7.8 8.8 -5 11 0Z',
    hillS: 'M3.6 -7L4.4 -4.2M5.8 -6.2L6.8 -3.2M7.8 -4.8L8.8 -2M9.4 -3L10.2 -1M1.8 -7.6L2.2 -5.6M-12 0.2L-9 0.2M9.6 0.2L12.4 0.2',
    reeds: 'M-3 0L-4.2 -4.6M-1.6 0L-1.8 -6M0 0L0.8 -5.2M1.4 0L2.8 -3.8',
    pools: 'M-7 1.6L-3.6 1.6M2.6 1.6L6.4 1.6M-2 3.4L2.4 3.4',
    tuft: 'M-2 0L-2.6 -2.4M0 0L0 -3M2 0L2.6 -2.2',
    // Чаща: крона гуще заштрихована
    treeS2: 'M2.6 -9.6C3.6 -8.8 3.9 -7.4 3.5 -6.2M0.4 -5.4C1.8 -4.9 3 -5 3.8 -5.6M1.2 -8.2C1.9 -7.6 2.1 -6.9 2 -6.3M3.6 -11C4.6 -10.2 5 -8.8 4.8 -7.6M-1.4 -6.8C-0.6 -6.1 0.3 -6 1 -6.3M-3.6 -5.6C-2.6 -5 -1.6 -5 -0.8 -5.3M-2.2 0.2L2.6 0.2',
    firS2: 'M0.6 -11.8L1.8 -10.4M1 -7.4L2.6 -5.6M1.2 -3.4L3.4 -2.4M-0.2 -9.2L1.4 -7.4M0.2 -5L2 -3.2M-0.4 -13.4L0.6 -12.2',
    // Предгорья: низкая вершина
    lowPeak: 'M-12 0L-6.4 -5L-4.8 -4.2L-0.6 -10L4.4 -4.6L5.8 -5.4L12 0Z',
    lowPeakD: 'M-0.6 -10L0.2 -6.8L-0.4 -3.6L0.4 0',
    lowPeakS: 'M0.8 -7.2L2.6 -4.6M1 -3.6L3.6 -0.8M6.4 -3.8L8.6 -1',
    // Хребет: та же гора, но тень гуще и снег
    peakS2: 'M1.2 -13L2.6 -10.8M1.2 -10L3.2 -7.2M2.2 -6.6L4.8 -3.2M2.4 -3L5.2 -0.3M6.8 -8.4L8.6 -5.2M6.6 -4.4L9.4 -1M4.2 -1.2L5 -0.2M0.8 -15.2L1.8 -13.6M1.8 -8.6L4 -5.4M3 -4.6L6.6 -0.6M7.6 -6.6L10.2 -2.6M8.8 -2.6L10.4 -0.4',
    // Исполин: многоглавая вершина с ледником
    bigPeak: 'M-12 0L-9 -4.6L-7.2 -3.6L-4.2 -11L-2.6 -9.6L0 -20L3.2 -12.6L4.8 -14L8 -6.6L9.4 -7.4L12 0Z',
    bigPeakD: 'M0 -20L1 -15.4L0.2 -11.6L1.6 -6.8L0.8 0M4.8 -14L5.6 -10L5 -6M-4.2 -11L-3.6 -7L-4.4 -3',
    bigPeakS: 'M1.4 -16L2.6 -13.8M1.2 -12.8L3 -10.2M2 -9.6L4.2 -6.4M2.2 -5.8L5 -2.4M2.4 -2.4L4.6 -0.2M5.8 -11.4L7.2 -8.6M5.8 -7.2L8.2 -3.8M6.4 -3.4L8.8 -0.6M9 -6L10.6 -2.4M-3.2 -7.8L-2.2 -5.8M-3.4 -4.2L-2 -2M3.4 -11.2L5 -8.6',
    bigSnow: 'M-2.4 -15.4L-1 -16.8L0.2 -15.2L1.4 -16.4L2.4 -14.8M3.6 -11.6L4.8 -12.7L5.8 -11.4M-5.2 -8.6L-4.2 -9.6L-3.4 -8.6',
    // Взгорье: гуще тень
    hillS2: 'M3.6 -7L4.4 -4.2M5.8 -6.2L6.8 -3.2M7.8 -4.8L8.8 -2M9.4 -3L10.2 -1M1.8 -7.6L2.2 -5.6M2.6 -5.4L3.2 -2.6M4.6 -3.6L5.4 -0.8M6.8 -2L7.4 -0.2M-12 0.2L-9 0.2M9.6 0.2L12.4 0.2',
    // Трясина: больше «окон» воды
    pools2: 'M-7 1.6L-3.6 1.6M2.6 1.6L6.4 1.6M-2 3.4L2.4 3.4M-8 4.6L-4.6 4.6M4.4 4.4L8 4.4M-5.4 -1.6L-3.2 -1.6M3.8 -1L6 -1',
    canopy: 'M-3.2 0C-2.4 -2.2 2.4 -2.2 3.2 0'
};
// Топографические знаки
const TOPO = {
    tree: 'M0 -5.2C1.7 -5.2 2.6 -4 2.6 -2.9C2.6 -1.6 1.5 -0.8 0 -0.8C-1.5 -0.8 -2.6 -1.6 -2.6 -2.9C-2.6 -4 -1.7 -5.2 0 -5.2Z',
    treeD: 'M0 -0.8L0 0.8',
    fir: 'M0 -6L2.2 -1L-2.2 -1Z',
    firD: 'M0 -1L0 0.8',
    marsh: 'M-4.5 0L-1 0M1 0L4.5 0M-3 -2.4L3 -2.4',
    marshD: 'M-0.6 -2.4L-1.2 -4.6M0.6 -2.4L1.2 -4.4',
    summit: 'M-2.4 0L0 -4.2L2.4 0Z'
};

// Ширина рисунка в единицах формы — чтобы задавать размер значка его шириной на карте
const WIDTH = {
    classic: { forest: 14, mountains: 22, hills: 22, swamp: 20 },
    antique: { forest: 11, mountains: 24, hills: 22, swamp: 14 },
    topo: { forest: 5.2, mountains: 0, hills: 0, swamp: 9 }
};
// Обычная ширина значка на карте (клетка — 28)
const BASE = {
    classic: { forest: 14, mountains: 27, hills: 23, swamp: 17 },
    antique: { forest: 12.5, mountains: 26, hills: 22, swamp: 15 },
    topo: { forest: 6.8, mountains: 0, hills: 0, swamp: 11 }
};

// Заливка значков в третьей ступени (чуть темнее бумаги)
const DEEP = { forest: '#E3DCC0', hills: '#EADFC4' };

// Три ступени: размер значка (доля обычного) и расстояние между значками (доля размера);
// чем меньше расстояние — тем плотнее и «массивнее». edgeKeep — сколько значков оставлять у самого края
// Подобрано под число значков на клетку: лесок ~2–3 дерева, лес ~5, чаща ~9 вплотную;
// предгорья ~1 низкая вершина, горы ~1,3 сомкнутых пика, хребет — крупные снежные пики внахлёст
const TIERS = {
    forest: { size: [0.85, 1.0, 1.2], gap: [1.33, 0.8, 0.49], edgeKeep: 0.85 },      // лесок, лес, чаща
    mountains: { size: [0.7, 1.05, 1.55], gap: [1.08, 0.72, 0.44], edgeKeep: 0.85 }, // предгорья, горы, хребет
    hills: { size: [0.65, 1.0, 1.35], gap: [1.27, 0.83, 0.5], edgeKeep: 0.85 },      // пригорки, холмы, взгорье
    swamp: { size: [0.85, 1.0, 1.15], gap: [1.23, 1.17, 0.72], edgeKeep: 0.85 }      // сырой луг, топь, трясина
};

// Один значок с центром в (x, y) и шириной w. Возвращает части рисунка и «основание» для порядка
// tier — ступень: 0 — край (лесок, предгорья), 1 — середина, 2 — глубина (чаща, хребет), 3 — исполин
export function drawOne(set, t, x, y, w, rr, tier = 1) {
    const parts = [];
    // ельник рисуется как лес, но только елями
    const firOnly = t === 'conifer';
    if (firOnly) t = 'forest';
    const add = (d, fill, stroke, thin) => parts.push({ d, fill, stroke, thin });
    const k = w / WIDTH[set][t];
    if (set === 'classic') {
        const Tr = p => T(p, x, y, k);
        if (t === 'forest') { const fir = firOnly || rr(3) < 0.4; add(Tr(fir ? SH.fir : SH.crown), PANEL, INK); add(Tr(fir ? SH.firD : SH.crownD), 'none', INK); return { parts, base: y + 8 * k }; }
        if (t === 'mountains') { add(Tr(SH.peak), PANEL, INK); add(Tr(SH.peakD), 'none', INK); add(Tr(SH.peakShade), 'none', INK, true); if (w > 30) add(Tr(SH.snow), 'none', INK); return { parts, base: y + 9 * k }; }
        if (t === 'hills') { add(Tr(SH.mound), PANEL, INK); add(Tr(SH.moundD), 'none', INK); add(Tr(SH.moundShade), 'none', INK, true); return { parts, base: y + 6 * k }; }
        if (t === 'swamp') { add(Tr(SH.reeds), 'none', INK); add(Tr(SH.head), INK, INK); return { parts, base: y + 9 * k }; }
    }
    if (set === 'antique') {
        // рисунок стоит на основании — сдвигаем, чтобы центр значка пришёлся в точку
        const h = t === 'mountains' ? [10, 17, 17, 20][tier] : { forest: 12, hills: 8, swamp: 5 }[t];
        const by = y + h * k / 2, Tr = p => T(p, x, by, k);
        const shade = (d, wd = 0.5) => parts.push({ d, fill: 'none', stroke: INK, w: wd });
        if (t === 'forest') {
            // в чаще больше ельника и тени гуще
            const fir = firOnly || rr(3) < [0.22, 0.38, 0.58][Math.min(tier, 2)];
            // в чаще кроны темнее бумаги — глубина читается тоном, а не только числом деревьев
            const crown = tier >= 2 ? DEEP.forest : PANEL;
            if (fir) {
                const kf = k * 0.9, Tf = p => T(p, x, y + 8 * kf, kf);
                add(Tf(ANT.fir), crown, INK); add(Tf(ANT.firD), 'none', INK); shade(Tf(tier >= 2 ? ANT.firS2 : ANT.firS), tier >= 2 ? 0.6 : 0.5);
                return { parts, base: y + 8 * kf };
            }
            add(Tr(ANT.tree), crown, INK); add(Tr(ANT.treeD), 'none', INK); shade(Tr(tier >= 2 ? ANT.treeS2 : ANT.treeS), tier >= 2 ? 0.6 : 0.5);
            return { parts, base: by };
        }
        if (t === 'mountains') {
            if (tier === 0) { add(Tr(ANT.lowPeak), PANEL, INK); add(Tr(ANT.lowPeakD), 'none', INK); shade(Tr(ANT.lowPeakS)); return { parts, base: by }; }
            if (tier >= 3) { add(Tr(ANT.bigPeak), PANEL, INK); add(Tr(ANT.bigPeakD), 'none', INK); shade(Tr(ANT.bigPeakS), 0.65); shade(Tr(ANT.bigSnow), 0.7); return { parts, base: by }; }
            add(Tr(ANT.peak), PANEL, INK); add(Tr(ANT.peakD), 'none', INK);
            shade(Tr(tier >= 2 ? ANT.peakS2 : ANT.peakS), tier >= 2 ? 0.6 : 0.5);
            if (tier >= 2) shade(Tr(ANT.snow), 0.6);
            return { parts, base: by };
        }
        if (t === 'hills') { add(Tr(ANT.hill), tier >= 2 ? DEEP.hills : PANEL, INK); shade(Tr(tier >= 2 ? ANT.hillS2 : ANT.hillS), 0.7); return { parts, base: by }; }
        if (t === 'swamp') {
            if (tier === 0) { add(Tr(ANT.tuft), 'none', INK); parts.push({ d: Tr('M-4 1.6L-1 1.6M1.6 2.8L4.4 2.8'), fill: 'none', stroke: WATER_INK, thin: true }); return { parts, base: by }; }
            add(Tr(ANT.reeds), 'none', INK); add(Tr(tier >= 2 ? ANT.pools2 : ANT.pools), 'none', WATER_INK, true);
            return { parts, base: by };
        }
    }
    if (set === 'topo') {
        const Tr = p => T(p, x, y + 3 * k, k);
        if (t === 'forest') { const fir = firOnly || rr(3) < 0.4; add(Tr(fir ? TOPO.fir : TOPO.tree), PANEL, INK); add(Tr(fir ? TOPO.firD : TOPO.treeD), 'none', INK); return { parts, base: y + 3 * k }; }
        if (t === 'swamp') { add(Tr(TOPO.marsh), 'none', WATER_INK); add(Tr(TOPO.marshD), 'none', INK, true); return { parts, base: y }; }
    }
    return { parts, base: y };
}

// Глубина для местности t: по клеткам и плавно в любой точке; plus глубина массива, в который входит клетка
function depthField(def, t, known) {
    const { cols, rows } = def;
    const isT = (c, r) => terAt(def, c, r) === t && known(c, r);
    const dm = depthMap(def, (c, r, nc, nr) => isT(c, r) === isT(nc, nr));
    const D = new Float32Array(cols * rows);
    for (let i = 0; i < D.length; i++) D[i] = isT(i % cols, (i / cols) | 0) ? dm.D[i] : 0;
    const at = (x, y) => {
        const fx = (x - M) / S - 0.5, fy = (y - M) / S - 0.5;
        const c0 = Math.floor(fx), r0 = Math.floor(fy), u = fx - c0, v = fy - r0;
        const g = (c, r) => { c = Math.max(0, Math.min(cols - 1, c)); r = Math.max(0, Math.min(rows - 1, r)); return D[r * cols + c]; };
        return g(c0, r0) * (1 - u) * (1 - v) + g(c0 + 1, r0) * u * (1 - v) + g(c0, r0 + 1) * (1 - u) * v + g(c0 + 1, r0 + 1) * u * v;
    };
    const massifAt = (x, y) => {
        const c = Math.max(0, Math.min(cols - 1, Math.floor((x - M) / S))), r = Math.max(0, Math.min(rows - 1, Math.floor((y - M) / S)));
        return dm.massif(r * cols + c);
    };
    return { D, at, cell: (c, r) => D[r * cols + c], massif: (c, r) => dm.massif(r * cols + c), massifAt };
}

// Разброс точек «синим шумом»: случайно, но без скучиваний; радиус может меняться от места к месту
// maxR — наибольшее расстояние между значками (по нему строится сетка поиска соседей)
function scatter(def, cellOk, step, radiusAt, accept, seed, preset = [], maxR = S) {
    const { cols, rows } = def, n = Math.max(1, Math.round(S / step)), cand = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!cellOk(c, r)) continue;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const h = rnd(Math.imul(c * n + i + 7, 73856093) ^ Math.imul(r * n + j + 3, 19349663) ^ seed);
            const h2 = rnd(Math.imul(h * 1e9 | 0, 2654435761) ^ seed);
            const x = M + c * S + (i + 0.15 + 0.7 * h) * S / n, y = M + r * S + (j + 0.15 + 0.7 * h2) * S / n;
            cand.push({ x, y, h: rnd((h * 4294967296) ^ 0x5bd1e995), c, r });
        }
    }
    cand.sort((a, b) => a.h - b.h);
    let B = maxR;
    for (const p of preset) B = Math.max(B, p.r);
    const grid = new Map(), out = [], key = (gx, gy) => gx * 100003 + gy;
    const put = p => { const k = key(Math.floor(p.x / B), Math.floor(p.y / B)); const l = grid.get(k); if (l) l.push(p); else grid.set(k, [p]); out.push(p); };
    preset.forEach(put);
    for (const p of cand) {
        if (accept && !accept(p)) continue;
        const rp = radiusAt(p.x, p.y);
        const gx = Math.floor(p.x / B), gy = Math.floor(p.y / B);
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
            const list = grid.get(key(gx + dx, gy + dy));
            if (!list) continue;
            for (let i = 0; i < list.length; i++) {
                const q = list[i], lim = (rp + q.r) / 2, ddx = q.x - p.x, ddy = q.y - p.y;
                if (ddx * ddx + ddy * ddy < lim * lim) { ok = false; break; }
            }
        }
        if (!ok) continue;
        p.r = rp;
        put(p);
    }
    return out;
}

// Штрихи по склону (как на старых топографических картах): линии вдоль уклона, на теневых склонах гуще
function hachures(def, t, known, depth) {
    const pts = scatter(def, (c, r) => terAt(def, c, r) === t && known(c, r), t === 'mountains' ? 3.5 : 4.7, () => (t === 'mountains' ? 3.9 : 5.4), null, t === 'mountains' ? 41 : 43, [], 6);
    const len = t === 'mountains' ? 6.4 : 4.2, groups = ['', '', ''];
    for (const p of pts) {
        const gx = depth.at(p.x + 1.5, p.y) - depth.at(p.x - 1.5, p.y), gy = depth.at(p.x, p.y + 1.5) - depth.at(p.x, p.y - 1.5);
        const g = Math.hypot(gx, gy);
        if (g < 0.02) continue;
        const ux = -gx / g, uy = -gy / g; // вниз по склону
        const shade = Math.max(0, (ux + uy) / Math.SQRT2); // склоны на юго-восток — в тени
        const b = shade > 0.55 ? 2 : shade > 0.1 ? 1 : 0;
        groups[b] += `M${(p.x - ux * len / 2).toFixed(1)} ${(p.y - uy * len / 2).toFixed(1)}L${(p.x + ux * len / 2).toFixed(1)} ${(p.y + uy * len / 2).toFixed(1)}`;
    }
    const w = t === 'mountains' ? [0.5, 0.85, 1.3] : [0.4, 0.6, 0.9];
    return groups.map((d, i) => d ? `<path d="${d}" stroke="${INK}" stroke-width="${w[i]}" stroke-opacity="${t === 'mountains' ? 0.85 : 0.6}" stroke-linecap="round" fill="none"/>` : '').join('');
}

// Главная функция: значки для «Гравюры». Возвращает SVG-строку (уже по порядку сверху вниз).
// forestMass(def) — функция из styles.js, рисует лес одной кроной (нужна для варианта «Массивом»)
export function engravingGlyphs(def, { set = 'classic', spread = 'grow', known, placeAt, forestMass }) {
    const { cols, rows } = def;
    const items = [];
    let pre = '';
    const push = ({ parts, base }) => parts.forEach((p, i) => items.push({ ...p, y: base + i * 0.001 }));
    void S;
    for (const t of ['swamp', 'forest', 'conifer', 'hills', 'mountains']) {
        const tk = t === 'conifer' ? 'forest' : t; // таблицы размеров общие с лесом
        const inT = (c, r) => terAt(def, c, r) === t && known(c, r) && !placeAt.has(keyOf(c, r));
        let any = false;
        for (let r = 0; r < rows && !any; r++) for (let c = 0; c < cols; c++) if (inT(c, r)) { any = true; break; }
        if (!any) continue;
        const depth = depthField(def, t, known);
        // Топографические горы и холмы — штрихами по склону и знаком вершины
        if (set === 'topo' && (t === 'mountains' || t === 'hills')) {
            pre += hachures(def, t, (c, r) => known(c, r), depth);
            if (t === 'mountains') {
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                    if (!inT(c, r)) continue;
                    const d = depth.cell(c, r);
                    let top = d >= 2;
                    for (let dr = -1; dr <= 1 && top; dr++) for (let dc = -1; dc <= 1; dc++) {
                        const nc = c + dc, nr = r + dr;
                        if ((dc || dr) && nc >= 0 && nr >= 0 && nc < cols && nr < rows && depth.cell(nc, nr) > d) { top = false; break; }
                    }
                    if (top && (c * 7 + r * 3) % 2 === 0) { const [x, y] = cellCenter(c, r); items.push({ d: T(TOPO.summit, x, y + 2, 1), fill: INK, stroke: INK, y: y + 2 }); }
                }
            }
            continue;
        }
        const W0 = BASE[set][tk];
        if (spread === 'grow') {
            // Как в эскизе: раскладка на клетку, к середине — больше и крупнее
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                if (!inT(c, r)) continue;
                let l = tierAt(def, c, r) ? tierAt(def, c, r) - 1 : Math.round(autoTier(depth.cell(c, r), depth.massif(c, r)));
                if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
                const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
                const [cx, cy] = cellCenter(c, r);
                const kk = [1.55, 1.85, 2.25][l], fx = rr(41) < 0.5 ? -1 : 1;
                const layout = t === 'swamp' ? [[[0, 0, 0.7]], [[0, 0, 0.8]], [[0, 0, 0.9]]][l] : LAYOUT[tk][l];
                // ширина как в эскизе (у других наборов — с поправкой на их обычный размер)
                const scaleW = WIDTH.classic[tk] * BASE[set][tk] / BASE.classic[tk];
                layout.forEach(([dx, dy, s], i) => {
                    const w = scaleW * s * kk * (1 + (rr(i + 50) - 0.5) * 0.22);
                    push(drawOne(set, t, cx + (fx * dx + (rr(i + 20) - 0.5) * 7) * kk, cy + (dy + (rr(i + 30) - 0.5) * 7) * kk, w, j => rr(i + j)));
                });
            }
            continue;
        }
        if (spread === 'mass' && t === 'forest') {
            // Лес одной кроной: волнистая опушка, внутри — фактура крон, по южному краю — передний ряд деревьев
            pre += forestMass(def, (c, r) => terAt(def, c, r) === 'forest' && known(c, r));
            const tex = scatter(def, inT, 6, () => 9.5, p => depth.at(p.x, p.y) > 1.1, 61, [], 10);
            for (const p of tex) items.push({ d: T(ANT.canopy, p.x, p.y, 1.35 + rnd(p.h * 1e9 | 0) * 0.4), fill: 'none', stroke: INK, w: 0.7, y: p.y - 100000 });
            const front = scatter(def, (c, r) => inT(c, r) && !(terAt(def, c, r + 1) === 'forest' && known(c, r + 1)) && r + 1 < rows, 6, () => W0 * 0.78, null, 67, [], W0);
            for (const p of front) push(drawOne(set, t, p.x, p.y + S * 0.18, W0 * (0.9 + rnd(p.h * 1e9 | 0) * 0.2), j => rnd((p.h * 1e9 | 0) + j)));
            continue;
        }
        // «Только гуще» и «Три ступени»: точки синим шумом по всей области
        const dense = spread === 'dense';
        // Ступень по глубине: 0 — край, 1 — середина, 2 — глубина; переход между ними короткий
        const tierF = (x, y) => {
            const c = Math.floor((x - M) / S), r = Math.floor((y - M) / S), set = tierAt(def, c, r);
            if (set) return set - 1;
            const f = autoTier(depth.at(x, y), depth.massifAt(x, y)), i = Math.round(f);
            return i + (f - i) * 0.35;
        };
        const tierCell = (c, r) => tierAt(def, c, r) ? tierAt(def, c, r) - 1 : Math.round(autoTier(depth.cell(c, r), depth.massif(c, r)));
        const lerp3 = (a, f) => f <= 1 ? a[0] + (a[1] - a[0]) * f : a[1] + (a[2] - a[1]) * (f - 1);
        const TT = TIERS[tk];
        const sizeAt = (x, y) => dense ? W0 : W0 * lerp3(TT.size, tierF(x, y));
        const radiusAt = (x, y) => {
            if (dense) {
                const d = Math.min(Math.max(depth.at(x, y), 1), 4);
                const k = t === 'swamp' ? 1.15 : tk === 'forest' ? 0.82 : 0.72;
                return W0 * k * (1.3 - 0.15 * (d - 1));
            }
            // ели уже лиственных крон — ставим их чуть теснее
            return sizeAt(x, y) * lerp3(TT.gap, tierF(x, y)) * (t === 'conifer' ? 0.82 : 1);
        };
        // Шаг кандидатов — по самой плотной ступени; наибольшее расстояние — для поиска соседей
        const minR = dense ? W0 * 0.5 : W0 * Math.min(...TT.size.map((v, i) => v * TT.gap[i]));
        const maxR = dense ? W0 * 1.5 : W0 * Math.max(...TT.size.map((v, i) => v * TT.gap[i]));
        const step = Math.max(3, minR * 0.62);
        // Исполины: на самых глубоких местах хребта — отдельные крупные снежные вершины
        const preset = [];
        if (!dense && t === 'mountains' && set === 'antique') {
            // Исполины — в третьей ступени (хребет): там, где массив глубже всего, или где мастер нарисовал «хребет»
            const tops = [];
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const d = depth.cell(c, r);
                // исполину нужен простор: только там, где хребет шире одной клетки
                if (!inT(c, r) || tierCell(c, r) < 2 || d < 2) continue;
                let top = true;
                for (let dr = -1; dr <= 1 && top; dr++) for (let dc = -1; dc <= 1; dc++) {
                    const nc = c + dc, nr = r + dr;
                    if ((dc || dr) && nc >= 0 && nr >= 0 && nc < cols && nr < rows && depth.cell(nc, nr) > d && tierCell(nc, nr) >= 2) { top = false; break; }
                }
                if (top) tops.push({ c, r, d, h: rnd(Math.imul(c + 5, 2246822519) ^ Math.imul(r + 9, 3266489917)) });
            }
            tops.sort((a, b) => b.d - a.d || a.h - b.h);
            for (const tp of tops) {
                if (preset.some(q => Math.max(Math.abs(q.c - tp.c), Math.abs(q.r - tp.r)) < 3)) continue;
                const [x, y] = cellCenter(tp.c, tp.r), w = W0 * (tp.d >= 4 ? 2.3 : 2.0);
                preset.push({ x: x + (tp.h - 0.5) * 8, y, r: w * 0.62, c: tp.c, r0: tp.r, giant: w, h: tp.h });
            }
        }
        const pts = scatter(def, inT, step, radiusAt, p => depth.at(p.x, p.y) > 0.75 && (depth.cell(p.c, p.r) > 1 || tierAt(def, p.c, p.r) > 1 || rnd(p.h * 7919 | 0) < (dense ? 0.8 : TT.edgeKeep)), { forest: 11, conifer: 23, mountains: 13, hills: 17, swamp: 19 }[t], preset, maxR);
        for (const p of pts) {
            if (p.giant) { push(drawOne(set, t, p.x, p.y, p.giant, j => rnd((p.h * 1e9 | 0) + j * 31), 3)); continue; }
            const tier = dense ? 1 : Math.round(tierF(p.x, p.y));
            const w = sizeAt(p.x, p.y) * (0.9 + rnd(p.h * 1e9 | 0) * 0.2);
            push(drawOne(set, t, p.x, p.y, w, j => rnd((p.h * 1e9 | 0) + j * 31), tier));
        }
    }
    // Равнина: редкая трава
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (terAt(def, c, r) !== 'plains' || !known(c, r) || placeAt.has(keyOf(c, r))) continue;
        const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
        if (rr(7) > 0.22) continue;
        const [cx, cy] = cellCenter(c, r), x = cx + (rr(2) - 0.5) * 14, y = cy + (rr(3) - 0.5) * 14;
        items.push({ d: T(set === 'classic' ? SH.tuft : ANT.tuft, x, y, set === 'classic' ? 0.9 : 1.1), fill: 'none', stroke: INK, thin: set !== 'classic', y });
    }
    // Вода: изредка волна на глубине (только в наборе «как сейчас»)
    if (set === 'classic') {
        const deep = depthField(def, 'water', known);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (terAt(def, c, r) !== 'water' || !known(c, r) || deep.cell(c, r) < 3) continue;
            const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
            if (rr(9) < 0.5) continue;
            const [cx, cy] = cellCenter(c, r);
            items.push({ d: T(SH.wave, cx + (rr(11) - 0.5) * 8, cy + (rr(12) - 0.5) * 8, 0.95), fill: 'none', stroke: WATER_INK, y: cy });
        }
    }
    items.sort((a, b) => a.y - b.y);
    const sw = set === 'classic' ? 1 : 0.85;
    return pre + items.map(g => `<path d="${g.d}" fill="${g.fill}" stroke="${g.stroke}" stroke-width="${g.w || (g.thin ? 0.5 : sw)}" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
}

// Образцы для легенды: уровень l (0 — край, 2 — глубина) в плитке 30×30 с центром в (0, 0)
export function legendParts(set, spread, t0, l) {
    const out = [], t = t0 === 'conifer' ? 'forest' : t0;
    const push = ({ parts }) => parts.forEach(p => out.push(p));
    if (set === 'topo' && (t === 'mountains' || t === 'hills')) {
        const n = [3, 5, 7][l], len = t === 'mountains' ? 5 : 3.5;
        let d = '';
        for (let i = 0; i < n; i++) { const a = -Math.PI * 0.85 + i * Math.PI * 0.7 / Math.max(1, n - 1), x = Math.cos(a) * 7, y = -Math.sin(a) * 7 + 3; d += `M${(x * 0.6).toFixed(1)} ${(y * 0.6).toFixed(1)}L${(x * 0.6 + Math.cos(a) * len).toFixed(1)} ${(y * 0.6 - Math.sin(a) * len).toFixed(1)}`; }
        out.push({ d, fill: 'none', stroke: INK, thin: l < 2 });
        if (t === 'mountains' && l === 2) out.push({ d: T(TOPO.summit, 0, 2, 1), fill: INK, stroke: INK });
        return out;
    }
    if (!WIDTH[set][t]) return out;
    const W0 = BASE[set][t] * 0.62;
    const rr = j => 0.5 + 0.1 * j % 0.3;
    if (spread === 'range') {
        // Три ступени: редко и мелко → обычно → тесно и крупно
        const lay = {
            forest: [[[-5, 2, 0.8], [6, -3, 0.75]], [[-6, 0, 0.95], [1, -5, 0.95], [6, 3, 0.95]], [[-7, -5, 1.05], [0, -7, 1.1], [7, -4, 1.05], [-4, 3, 1.15], [4, 4, 1.15]]],
            mountains: [[[-5, 2, 0.6], [6, 0, 0.55]], [[-4, 2, 0.95], [5, -1, 0.85]], [[-6, 3, 0.95], [6, 2, 0.9], [0, -1, 1.3, 3]]],
            hills: [[[-5, 2, 0.6], [5, -1, 0.55]], [[-4, 1, 0.95], [5, -3, 0.85]], [[-6, -3, 1.0], [6, -4, 0.95], [0, 3, 1.2]]],
            swamp: [[[0, 0, 0.9]], [[-3, -2, 0.9], [4, 3, 0.9]], [[-5, -4, 1], [5, -3, 1], [0, 4, 1]]]
        }[t][l];
        lay.forEach(([x, y, k, tier], i) => push(drawOne(set, t0, x, y, W0 * k * (t === 'forest' ? 0.85 : 0.8), j => (i * 0.37 + j * 0.13) % 1, tier ?? l)));
        return out;
    }
    const pos = [[[0, 0]], [[-5, -3], [5, 3]], [[-6, -5], [5, -4], [0, 4]]][spread === 'dense' || spread === 'mass' ? Math.max(l, 0) : l];
    const wf = spread === 'grow' ? [0.75, 0.85, 1][l] : 0.8;
    pos.forEach(([x, y], i) => push(drawOne(set, t0, x, y, W0 * wf * (t === 'forest' && set !== 'topo' ? 0.85 : 0.7), j => (i * 0.37 + j * 0.13) % 1)));
    return out;
}
