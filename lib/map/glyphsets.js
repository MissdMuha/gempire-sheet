// Значки местности для «Гравюры»: несколько наборов рисунков и несколько правил,
// как значки густеют и растут вглубь массива (леса, гор, холмов, топей).
import { S, M, PANEL, INK, WATER_INK, SH, LAYOUT, T, terAt, rnd, keyOf, cellCenter } from './terrain.js';

// --- Наборы рисунков ---
export const GLYPH_SETS = {
    classic: { label: 'Как сейчас', hint: 'кроны-«леденцы», шатры гор, холмы-булочки' },
    antique: { label: 'Старинные', hint: 'тонкое перо: деревья со штрихованной тенью, острые пики с отрогами, пологие холмы' },
    topo: { label: 'Топографические', hint: 'мелкие условные знаки, горы и холмы — штрихами по склону' }
};
export const SPREADS = {
    grow: { label: 'Крупнее и гуще', hint: 'как сейчас: к середине больше значков и они крупнее' },
    dense: { label: 'Только гуще', hint: 'размер один, к середине значки стоят теснее' },
    range: { label: 'Крупнее, но реже', hint: 'по краю мелкие, к середине крупные, но реже — горы складываются в хребты' },
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

// Один значок с центром в (x, y) и шириной w. Возвращает части рисунка и «основание» для порядка
export function drawOne(set, t, x, y, w, rr) {
    const parts = [];
    const add = (d, fill, stroke, thin) => parts.push({ d, fill, stroke, thin });
    const k = w / WIDTH[set][t];
    if (set === 'classic') {
        const Tr = p => T(p, x, y, k);
        if (t === 'forest') { const fir = rr(3) < 0.4; add(Tr(fir ? SH.fir : SH.crown), PANEL, INK); add(Tr(fir ? SH.firD : SH.crownD), 'none', INK); return { parts, base: y + 8 * k }; }
        if (t === 'mountains') { add(Tr(SH.peak), PANEL, INK); add(Tr(SH.peakD), 'none', INK); add(Tr(SH.peakShade), 'none', INK, true); if (w > 30) add(Tr(SH.snow), 'none', INK); return { parts, base: y + 9 * k }; }
        if (t === 'hills') { add(Tr(SH.mound), PANEL, INK); add(Tr(SH.moundD), 'none', INK); add(Tr(SH.moundShade), 'none', INK, true); return { parts, base: y + 6 * k }; }
        if (t === 'swamp') { add(Tr(SH.reeds), 'none', INK); add(Tr(SH.head), INK, INK); return { parts, base: y + 9 * k }; }
    }
    if (set === 'antique') {
        // рисунок стоит на основании — сдвигаем, чтобы центр значка пришёлся в точку
        const h = { forest: 12, mountains: 17, hills: 8, swamp: 5 }[t];
        const by = y + h * k / 2, Tr = p => T(p, x, by, k);
        if (t === 'forest') {
            const fir = rr(3) < 0.38;
            if (fir) { const kf = k * 0.9; const Tf = p => T(p, x, y + 8 * kf, kf); add(Tf(ANT.fir), PANEL, INK); add(Tf(ANT.firD), 'none', INK); add(Tf(ANT.firS), 'none', INK, true); return { parts, base: y + 8 * kf }; }
            add(Tr(ANT.tree), PANEL, INK); add(Tr(ANT.treeD), 'none', INK); add(Tr(ANT.treeS), 'none', INK, true);
            return { parts, base: by };
        }
        if (t === 'mountains') { add(Tr(ANT.peak), PANEL, INK); add(Tr(ANT.peakD), 'none', INK); add(Tr(ANT.peakS), 'none', INK, true); if (w > 30) add(Tr(ANT.snow), 'none', INK, true); return { parts, base: by }; }
        if (t === 'hills') { add(Tr(ANT.hill), PANEL, INK); parts.push({ d: Tr(ANT.hillS), fill: 'none', stroke: INK, w: 0.7 }); return { parts, base: by }; }
        if (t === 'swamp') { add(Tr(ANT.reeds), 'none', INK); add(Tr(ANT.pools), 'none', WATER_INK, true); return { parts, base: by }; }
    }
    if (set === 'topo') {
        const Tr = p => T(p, x, y + 3 * k, k);
        if (t === 'forest') { const fir = rr(3) < 0.4; add(Tr(fir ? TOPO.fir : TOPO.tree), PANEL, INK); add(Tr(fir ? TOPO.firD : TOPO.treeD), 'none', INK); return { parts, base: y + 3 * k }; }
        if (t === 'swamp') { add(Tr(TOPO.marsh), 'none', WATER_INK); add(Tr(TOPO.marshD), 'none', INK, true); return { parts, base: y }; }
    }
    return { parts, base: y };
}

// Глубина: сколько клеток до края своей местности (по 8 соседям), за краем карты местность продолжается
function depthField(def, t, known) {
    const { cols, rows } = def, D = new Float32Array(cols * rows);
    const q = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const inside = terAt(def, c, r) === t && known(c, r);
        if (!inside) { D[r * cols + c] = 0; continue; }
        D[r * cols + c] = Infinity;
        let edge = false;
        for (let dr = -1; dr <= 1 && !edge; dr++) for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            if (!(terAt(def, nc, nr) === t && known(nc, nr))) { edge = true; break; }
        }
        if (edge) { D[r * cols + c] = 1; q.push(r * cols + c); }
    }
    for (let i = 0; i < q.length; i++) {
        const v = q[i], c = v % cols, r = (v / cols) | 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const u = nr * cols + nc;
            if (D[u] === Infinity) { D[u] = D[v] + 1; q.push(u); }
        }
    }
    for (let i = 0; i < D.length; i++) if (D[i] === Infinity) D[i] = 6; // область без краёв (вся карта)
    // Плавная глубина в любой точке: по центрам клеток
    const at = (x, y) => {
        const fx = (x - M) / S - 0.5, fy = (y - M) / S - 0.5;
        const c0 = Math.floor(fx), r0 = Math.floor(fy), u = fx - c0, v = fy - r0;
        const g = (c, r) => { c = Math.max(0, Math.min(cols - 1, c)); r = Math.max(0, Math.min(rows - 1, r)); return D[r * cols + c]; };
        return g(c0, r0) * (1 - u) * (1 - v) + g(c0 + 1, r0) * u * (1 - v) + g(c0, r0 + 1) * (1 - u) * v + g(c0 + 1, r0 + 1) * u * v;
    };
    return { D, at, cell: (c, r) => D[r * cols + c] };
}

// Разброс точек «синим шумом»: случайно, но без скучиваний; радиус может меняться от места к месту
function scatter(def, cellOk, step, radiusAt, accept, seed) {
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
    const cellSize = S, grid = new Map(), out = [];
    const keyG = (x, y) => Math.floor(x / cellSize) + ':' + Math.floor(y / cellSize);
    for (const p of cand) {
        if (accept && !accept(p)) continue;
        const rp = radiusAt(p.x, p.y);
        let ok = true;
        const gx = Math.floor(p.x / cellSize), gy = Math.floor(p.y / cellSize), span = Math.ceil(rp / cellSize) + 1;
        for (let dy = -span; dy <= span && ok; dy++) for (let dx = -span; dx <= span && ok; dx++) {
            const list = grid.get((gx + dx) + ':' + (gy + dy));
            if (!list) continue;
            for (const q of list) if (Math.hypot(q.x - p.x, q.y - p.y) < (rp + q.r) / 2) { ok = false; break; }
        }
        if (!ok) continue;
        p.r = rp;
        const k = keyG(p.x, p.y);
        (grid.get(k) || grid.set(k, []).get(k)).push(p);
        out.push(p);
    }
    return out;
}

// Штрихи по склону (как на старых топографических картах): линии вдоль уклона, на теневых склонах гуще
function hachures(def, t, known, depth) {
    const pts = scatter(def, (c, r) => terAt(def, c, r) === t && known(c, r), t === 'mountains' ? 3.5 : 4.7, () => (t === 'mountains' ? 3.9 : 5.4), null, t === 'mountains' ? 41 : 43);
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
    for (const t of ['swamp', 'forest', 'hills', 'mountains']) {
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
        const W0 = BASE[set][t];
        if (spread === 'grow') {
            // Как в эскизе: раскладка на клетку, к середине — больше и крупнее
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                if (!inT(c, r)) continue;
                let l = Math.min(2, depth.cell(c, r) - 1);
                if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
                const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
                const [cx, cy] = cellCenter(c, r);
                const kk = [1.55, 1.85, 2.25][l], fx = rr(41) < 0.5 ? -1 : 1;
                const layout = t === 'swamp' ? [[[0, 0, 0.7]], [[0, 0, 0.8]], [[0, 0, 0.9]]][l] : LAYOUT[t][l];
                // ширина как в эскизе (у других наборов — с поправкой на их обычный размер)
                const scaleW = WIDTH.classic[t] * BASE[set][t] / BASE.classic[t];
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
            const tex = scatter(def, inT, 6, () => 9.5, p => depth.at(p.x, p.y) > 1.1, 61);
            for (const p of tex) items.push({ d: T(ANT.canopy, p.x, p.y, 1.35 + rnd(p.h * 1e9 | 0) * 0.4), fill: 'none', stroke: INK, w: 0.7, y: p.y - 100000 });
            const front = scatter(def, (c, r) => inT(c, r) && !(terAt(def, c, r + 1) === 'forest' && known(c, r + 1)) && r + 1 < rows, 6, () => W0 * 0.78, null, 67);
            for (const p of front) push(drawOne(set, t, p.x, p.y + S * 0.18, W0 * (0.9 + rnd(p.h * 1e9 | 0) * 0.2), j => rnd((p.h * 1e9 | 0) + j)));
            continue;
        }
        // «Только гуще» и «Крупнее, но реже»: точки синим шумом по всей области
        const dense = spread === 'dense';
        const sizeAt = (x, y) => {
            const d = Math.min(Math.max(depth.at(x, y), 1), 4);
            return dense ? W0 : W0 * (0.68 + 0.22 * (d - 1));
        };
        const step = Math.max(3.5, W0 * (dense ? 0.32 : 0.3));
        const radiusAt = (x, y) => {
            const d = Math.min(Math.max(depth.at(x, y), 1), 4);
            const k = t === 'swamp' ? 1.15 : t === 'forest' ? 0.82 : 0.72;
            return dense ? W0 * k * (1.3 - 0.15 * (d - 1)) : sizeAt(x, y) * k * 1.18;
        };
        const pts = scatter(def, inT, step, radiusAt, p => depth.at(p.x, p.y) > 0.75 && (depth.cell(p.c, p.r) > 1 || rnd(p.h * 7919 | 0) < 0.8), { forest: 11, mountains: 13, hills: 17, swamp: 19 }[t]);
        for (const p of pts) {
            const w = sizeAt(p.x, p.y) * (0.9 + rnd(p.h * 1e9 | 0) * 0.2);
            push(drawOne(set, t, p.x, p.y, w, j => rnd((p.h * 1e9 | 0) + j * 31)));
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
export function legendParts(set, spread, t, l) {
    const out = [];
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
    if (spread === 'range') { push(drawOne(set, t, 0, 0, W0 * [0.75, 0.95, 1.2][l], rr)); return out; }
    const pos = [[[0, 0]], [[-5, -3], [5, 3]], [[-6, -5], [5, -4], [0, 4]]][spread === 'dense' || spread === 'mass' ? Math.max(l, 0) : l];
    const wf = spread === 'grow' ? [0.75, 0.85, 1][l] : 0.8;
    pos.forEach(([x, y], i) => push(drawOne(set, t, x, y, W0 * wf * (t === 'forest' && set !== 'topo' ? 0.85 : 0.7), j => (i * 0.37 + j * 0.13) % 1)));
    return out;
}
