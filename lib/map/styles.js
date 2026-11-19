// Стили местности. «Эскиз» — исходный рисунок (terrain.js). Здесь — новые стили:
// области обводятся плавными кривыми, а не по клеткам (field.js), значки разбросаны свободнее,
// у берегов — рябь, горы и котловины оттенены светотенью, туман с мягкими краями.
import {
    S, M, PAPER, PANEL, INK, WATER_INK, TER_CODES, TER_RANK, TONES, FOG_OPACITY,
    glyph, terAt, fogAt, terrainLevels, keyOf, cellCenter, rnd, renderTerrain, renderRoadsAndPlaces
} from './terrain.js';
import { GLYPH_SETS, SPREADS, engravingGlyphs, legendParts } from './glyphsets.js';
import { buildField, typeField, tierField, landField, fogField, fieldPath, contours, levelAt, reliefSvg, typeAt, srcAt, sampleAt, wobble, vnoise, FS } from './field.js';
export { GLYPH_SETS, SPREADS };

export const STYLES = {
    sketch: { label: 'Эскиз', hint: 'Как в исходном макете: тон и значки по клеткам' },
    engraving: { label: 'Гравюра', hint: 'Плавные берега и опушки, рябь у воды, штриховка склонов' },
    wash: { label: 'Акварель', hint: 'Цветные размывы по бумаге, мягкие края' },
    ink: { label: 'Штрих', hint: 'Одна тушь, без цвета — как старая печатная карта' }
};

const ORDER = ['swamp', 'wetwood', 'water', 'forest', 'conifer', 'plateau', 'hills', 'mountains'];

// Палитры стилей: [край, середина, глубина] для каждой местности
const WASH = {
    plains: ['#EFE5C9', '#EFE5C9', '#EFE5C9'],
    water: ['#B9CBCA', '#A4BBBD', '#8FAAAF'],
    swamp: ['#C5C7A4', '#B6BA92', '#A6AD82'],
    wetwood: ['#B2BC97', '#A3B394', '#97AC99'],
    plateau: ['#CFC2AA', '#CFC2AA', '#CFC2AA'],
    forest: ['#B3BA8F', '#9EA77A', '#8A9566'],
    conifer: ['#A7B496', '#92A283', '#7D8F70'],
    hills: ['#DCC69C', '#D1B888', '#C5A975'],
    mountains: ['#C3B5A0', '#B2A28A', '#A08F76']
};
const WASH_INK = { conifer: '#33402B', forest: '#3E4A2C', wetwood: '#3A4A3A', plateau: '#4A3B2B', hills: '#5A4630', mountains: '#4A3B2B', swamp: '#3E4A2C', water: '#3D5A73', plains: '#5A4E3A' };
const ENGR = {
    plains: ['#F4EDDD', '#F4EDDD', '#F4EDDD'],
    water: ['#DCE4E0', '#D0DAD7', '#C3D0CD'],
    swamp: ['#E6E5D0', '#DCDCC4', '#D1D2B6'],
    wetwood: ['#E2E4CF', '#D6DDCC', '#CAD5CB'],
    plateau: ['#E8DEC8', '#E8DEC8', '#E8DEC8'],
    forest: ['#E8E3CA', '#DDD7BA', '#CCC5A3'],
    conifer: ['#E4E3CB', '#D8D7BB', '#C6C5A5'],
    hills: ['#F1E6CC', '#E8DABD', '#DBCBA8'],
    mountains: ['#E8DEC8', '#DCCFB6', '#CBBC9F']
};

// Лес одной кроной: опушка из полукруглых «облачков» по контуру леса (loops — петли поля, px)
export function forestMassSvg(loops, amp = 1.6) {
    if (!loops.length) return '';
    let d = '';
    for (const raw of loops) {
        const pts = raw.map(([x, y]) => wobble(x, y, amp));
        // перестраиваем контур в шаги по ~7 единиц
        const res = [pts[0]];
        let acc = 0;
        for (let i = 1; i <= pts.length; i++) {
            const a = pts[i - 1], b = pts[i % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (!L) continue;
            let t = 0;
            while (acc + L * (1 - t) >= 7) { t += (7 - acc) / L; acc = 0; res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
            acc += L * (1 - t);
        }
        if (res.length < 4) continue;
        d += `M${res[0][0].toFixed(1)} ${res[0][1].toFixed(1)}`;
        for (let i = 0; i < res.length; i++) {
            const a = res[i], b = res[(i + 1) % res.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
            // наружу — влево по ходу обхода (область справа)
            const cx = (a[0] + b[0]) / 2 + dy / L * 3.4, cy = (a[1] + b[1]) / 2 - dx / L * 3.4;
            d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
        }
        d += 'Z';
    }
    return `<path d="${d}" fill="${ENGR.forest[1]}" fill-opacity="0.55" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"/>`;
}

// --- Узоры для стилей ---
function patterns(style) {
    if (style === 'ink') {
        return `<pattern id="ts-sea" width="8" height="4" patternUnits="userSpaceOnUse"><path d="M0 2H8" stroke="${INK}" stroke-width="0.55" stroke-opacity="0.55"/></pattern>` +
            `<pattern id="ts-swamp" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M1 6h4M8 2h3" stroke="${INK}" stroke-width="0.7" stroke-linecap="round" stroke-opacity="0.7"/></pattern>` +
            `<pattern id="ts-hills" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="${INK}" stroke-width="0.35" stroke-opacity="0.35"/></pattern>` +
            `<pattern id="ts-mount" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.45"/></pattern>` +
            `<pattern id="ts-forest" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.6" fill="${INK}" fill-opacity="0.45"/><circle cx="5.5" cy="5.5" r="0.6" fill="${INK}" fill-opacity="0.45"/></pattern>` +
            `<pattern id="ts-wet" width="17" height="11" patternUnits="userSpaceOnUse"><path d="M2 8h5M11 3h4" stroke="${INK}" stroke-width="0.6" stroke-linecap="round" stroke-opacity="0.5"/></pattern>`;
    }
    if (style === 'engraving') {
        return `<pattern id="ts-sea" width="9" height="4.5" patternUnits="userSpaceOnUse"><path d="M0 2.2H9" stroke="${WATER_INK}" stroke-width="0.45" stroke-opacity="0.32"/></pattern>` +
            `<pattern id="ts-swamp" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M1 6h4M8 2h3" stroke="${WATER_INK}" stroke-width="0.7" stroke-linecap="round" stroke-opacity="0.45"/></pattern>` +
            `<pattern id="ts-wet" width="15" height="10" patternUnits="userSpaceOnUse"><path d="M2 7.5h5M10 2.5h4" stroke="${WATER_INK}" stroke-width="0.65" stroke-linecap="round" stroke-opacity="0.42"/></pattern>`;
    }
    if (style === 'wash') {
        return `<pattern id="ts-sea" width="9" height="5" patternUnits="userSpaceOnUse"><path d="M0 2.5H9" stroke="#FFFFFF" stroke-width="0.6" stroke-opacity="0.25"/></pattern>`;
    }
    return '';
}

// Цвет заливки и цвета значков для стиля
function palette(style) {
    if (style === 'wash') return { fills: WASH, ink: t => WASH_INK[t] || INK, paperFor: (t, l) => mix(WASH[t][l], PANEL, 0.55), shore: '#3D5A73', outline: null };
    if (style === 'ink') return { fills: null, ink: () => INK, paperFor: () => PANEL, shore: INK, outline: INK };
    return { fills: ENGR, ink: () => INK, paperFor: () => PANEL, shore: WATER_INK, outline: INK };
}
function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

// Плитка для легенды в нужном стиле
export function legendTile(style, t, l, look = {}) {
    if (!STYLES[style] || style === 'sketch') return { fill: TONES[t][l], parts: glyph(t, 0, 0, [0.95, 0.85, 0.75][l], () => 0.5, l) };
    if (t === 'plateau') {
        // столовая гора: ровный верх и скальная стена под кромкой, как горы — видом сбоку
        const fill = style === 'ink' ? PANEL : style === 'wash' ? WASH.plateau[0] : ENGR.plateau[0];
        const ink = style === 'wash' ? WASH_INK.mountains : INK, wall = style === 'wash' ? mix(WASH.mountains[0], PANEL, 0.55) : PANEL;
        return { fill, parts: [
            { d: 'M-2 -6.5L-0.4 -9L1.6 -6.5Z', fill: wall, stroke: ink, thin: true },
            { d: 'M-8 -4L-8.6 -6.2M-6.6 -4L-6.6 -6.6M-5.2 -4L-4.6 -6M5 -5L4.4 -7M6.4 -5L6.4 -7.4', fill: 'none', stroke: ink, thin: true },
            { d: 'M-14 0.5L14 0.5L14 9.2L10 9.8L6 9.2L1 10L-4 9.3L-9 9.9L-14 9.2Z', fill: wall, stroke: ink },
            { d: 'M-10 0.5L-10.4 6M-5.5 0.5L-5.3 7.5M-1 0.5L-1.4 5.5M3.5 0.5L3.8 7.8M7.5 0.5L7.2 6.5M10 0.5L10.4 8M12 0.5L12.3 6.5M8.6 2L11.6 5M10.8 1.6L13.4 4.2', fill: 'none', stroke: ink, thin: true }
        ] };
    }
    if (style === 'engraving' && t !== 'water' && t !== 'plains') {
        return { fill: ENGR[t][l], parts: legendParts(GLYPH_SETS[look.glyphs] ? look.glyphs : 'antique', SPREADS[look.spread] ? look.spread : 'range', t, l) };
    }
    const pal = palette(style);
    const opt = { shade: style !== 'wash', water: style === 'wash' ? 'none' : undefined };
    const parts = glyph(t, 0, 0, [0.95, 0.85, 0.75][l], () => 0.5, l, opt).map(p => recolor(p, t, l, pal));
    return { fill: pal.fills ? pal.fills[t][l] : PANEL, parts };
}
function recolor(p, t, l, pal) {
    const ink = pal.ink(t);
    return {
        ...p,
        fill: p.fill === PANEL ? pal.paperFor(t, l) : p.fill === INK ? ink : p.fill,
        stroke: p.stroke === INK ? ink : p.stroke === WATER_INK ? (pal.shore || WATER_INK) : p.stroke
    };
}

// Обрыв плато — как горы на этой карте, видом сбоку. Под кромкой, обращённой к зрителю (на юг), стоит скальная стена
// высотой ~15 px: ряд скальных контрфорсов — светлая заливка, тушевый контур, излом посередине, правая половина в тени;
// низ фестонами (осыпи), между контрфорсами — промоины; грани к юго-востоку — в тени гуще.
// Где кромка смотрит на север, стену закрывает сам верх — там только кромка. Где плато упирается в горы — обрыва нет.
// Стена делится на куски: у каждого свой «низ» (y), чтобы то, что стоит перед стеной, рисовалось поверх, как у значков
function resample(pts, step) {
    const res = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!L) continue;
        let t = 0;
        while (acc + L * (1 - t) >= step) { t += (step - acc) / L; acc = 0; res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
        acc += L * (1 - t);
    }
    return res;
}
export function plateauWalls(F, { ink = INK, fill = PANEL, wob = 0 } = {}) {
    const pf = typeField(F, 'plateau');
    if (!pf) return { items: [], rim: '' };
    const lower = (x, y) => { const t = typeAt(F, x, y); return !!t && (TER_RANK[t] ?? 2) < TER_RANK.plateau; };
    const f = v => v.toFixed(1);
    const hash = (x, y, k = 0) => rnd(Math.imul(Math.round(x * 5) + k, 2246822519) ^ Math.imul(Math.round(y * 5) - k, 3266489917));
    const items = [];
    let rim = '';
    for (const raw of contours(F, pf)) {
        const P = resample(raw.map(([x, y]) => wobble(x, y, wob)), 2.4), n = P.length;
        if (n < 6) continue;
        const nrm = P.map((p, i) => {
            const a = P[(i - 2 + n) % n], b = P[(i + 2) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]; // наружу — влево по ходу обхода
        });
        const cliff = P.map((p, i) => lower(p[0] + nrm[i][0] * 10, p[1] + nrm[i][1] * 10));
        const wallAt = i => cliff[i] && cliff[(i + 1) % n] && (nrm[i][1] + nrm[(i + 1) % n][1]) / 2 > 0.12;
        // Начинаем обход с куска без стены, чтобы ряды стены не рвались на стыке петли
        let i0 = 0;
        while (i0 < n && wallAt(i0)) i0++;
        if (i0 === n) i0 = 0;
        // Контрфорсы: вдоль ряда стены — куски по 9–14 px; у каждого низ выпуклый (осыпь), между ними — промоина
        const U = new Float32Array(n), Bk = new Int32Array(n).fill(-1);
        let s0 = 0, bStart = 0, bLen = 11, bId = 0, inRun = false;
        for (let k = 0; k <= n; k++) {
            const i = (i0 + k) % n;
            if (!wallAt((i - 1 + n) % n) && !wallAt(i)) { inRun = false; continue; }
            if (!inRun) { inRun = true; s0 = 0; bStart = 0; bLen = 9 + hash(P[i][0], P[i][1], 3) * 5; bId++; }
            else s0 += Math.hypot(P[i][0] - P[(i - 1 + n) % n][0], P[i][1] - P[(i - 1 + n) % n][1]);
            if (s0 - bStart >= bLen) { bStart = s0; bLen = 9 + hash(P[i][0], P[i][1], 3) * 5; bId++; }
            U[i] = (s0 - bStart) / bLen; Bk[i] = bId;
        }
        const Hb = P.map(([x, y]) => 15 * (0.85 + 0.3 * (vnoise(x / 34, y / 34, 77) + 0.5)));
        const base = P.map(([x, y], i) => y + Hb[i] * (0.74 + 0.3 * Math.sin(Math.PI * Math.min(1, U[i] * 1.05))) + (hash(x, y, 9) - 0.5) * 0.8);
        for (let k = 0; k < n; k++) {
            const i = (i0 + k) % n, j = (i + 1) % n, a = P[i], b = P[j];
            if (!cliff[i] || !cliff[j]) continue;
            if (!wallAt(i)) { rim += `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`; continue; }
            const tx = (b[0] - a[0]) * 0.12, ty = (b[1] - a[1]) * 0.12;
            const y = Math.max(base[i], base[j]), shadeFace = ((nrm[i][0] + nrm[i][1]) / Math.SQRT2 + 1) / 2; // 0 — к свету, 1 — в тени
            items.push({ d: `M${f(a[0] - tx)} ${f(a[1] - ty)}L${f(b[0] + tx)} ${f(b[1] + ty)}L${f(b[0] + tx)} ${f(base[j])}L${f(a[0] - tx)} ${f(base[i])}Z`, fill, stroke: 'none', y });
            let lines = `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}M${f(a[0])} ${f(base[i])}L${f(b[0])} ${f(base[j])}`;
            if (!wallAt((i - 1 + n) % n)) lines += `M${f(a[0])} ${f(a[1])}L${f(a[0])} ${f(base[i])}`; // торец стены
            if (!wallAt(j)) lines += `M${f(b[0])} ${f(b[1])}L${f(b[0])} ${f(base[j])}`;
            // промоина между контрфорсами — во всю высоту; излом посередине контрфорса — чуть короче
            if (Bk[j] !== Bk[i]) lines += `M${f(b[0])} ${f(b[1] + 0.5)}L${f(b[0] + 0.5)} ${f(base[j] - 0.3)}`;
            else if (U[i] < 0.5 && U[j] >= 0.5) lines += `M${f(b[0])} ${f(b[1] + 0.5)}L${f(b[0] - 0.6)} ${f(b[1] + (base[j] - b[1]) * 0.45)}L${f(b[0] + 0.3)} ${f(base[j] - (base[j] - b[1]) * 0.2)}`;
            items.push({ d: lines, fill: 'none', stroke: ink, w: 0.85, y: y + 0.001 });
            // тень: правая половина каждого контрфорса — косыми штрихами (как тень на пиках); грани к юго-востоку — гуще
            const u = U[i], H = base[i] - a[1], h = hash(a[0], a[1], 5);
            let hatch = '';
            if ((u > 0.55 && u < 0.97) || (shadeFace > 0.68 && k % 2 === 0)) {
                const top = a[1] + 1.5 + h * 2.5, len = H * (0.35 + 0.3 * h + (u > 0.55 ? 0.15 : 0));
                hatch += `M${f(a[0] + 0.2)} ${f(top)}L${f(a[0] + 1.6)} ${f(Math.min(top + len, base[i] - 1))}`;
            }
            if (hatch) items.push({ d: hatch, fill: 'none', stroke: ink, w: 0.55, y: y + 0.002 });
        }
    }
    return { items, rim: rim ? `<path d="${rim}" fill="none" stroke="${ink}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>` : '' };
}
// Под стеной (в полосе высотой со стену сразу под плато) значки не ставим — там стена
export function underWall(F, x, y) {
    const pf = typeField(F, 'plateau');
    if (!pf) return false;
    for (const d of [2, 6, 10, 14, 17]) if (sampleAt(F, pf, x, y - d) >= 0.5) return true;
    return false;
}

// --- Главная функция: то же, что renderTerrain, но в выбранном стиле ---
export function renderStyled(def, { player = false, style = 'sketch', draft = false } = {}) {
    if (!STYLES[style] || style === 'sketch') return renderTerrain(def, { player });
    const { cols, rows } = def;
    const showArt = def.look?.art !== false;
    const pal = palette(style);
    const lv = terrainLevels(def, true);
    const known = (c, r) => !player || fogAt(def, c, r) > 0;
    // Поле местности: области — плавными кривыми, а не по клеткам (см. field.js)
    const F = buildField(def, known);
    // «Дрожь пера»: акварель — свободнее всего, штрих — аккуратнее
    const wob = style === 'wash' ? 2.6 : style === 'engraving' ? 1.6 : 1.1;
    const path = f => fieldPath(F, f, 0.5, { wob });
    // Заливка области; у акварели — подтёк за край и более тёмная кромка пигмента
    const fillReg = (d, color) => style === 'wash'
        ? `<path d="${d}" fill="${color}"/><path d="${d}" fill="none" stroke="${mix(color, '#2B2620', 0.25)}" stroke-width="1.2" stroke-opacity="0.5" stroke-linejoin="round"/>`
        : `<path d="${d}" fill="${color}"/>`;

    let defs = patterns(style);
    let tones = '', edges = '';
    const regions = {};
    // Стены плато — общие для всех стилей (значки перед стеной рисуются поверх неё)
    const walls = showArt ? plateauWalls(F, style === 'wash' ? { ink: WASH_INK.mountains, fill: mix(WASH.mountains[0], PANEL, 0.55), wob } : { wob }) : { items: [], rim: '' };
    if (showArt) {
        // Подложка суши (равнина) и области местностей, от краёв к глубине
        const landD = path(landField(F));
        if (pal.fills && landD) tones += fillReg(landD, pal.fills.plains[0]);
        for (const t of ORDER) {
            const d0 = path(typeField(F, t));
            if (!d0) continue;
            regions[t] = d0;
            if (pal.fills) {
                tones += fillReg(d0, pal.fills[t][0]);
                if (t !== 'swamp' && t !== 'plateau') {
                    const d1 = path(tierField(F, t, 1, lv)), d2 = path(tierField(F, t, 2, lv));
                    if (d1) tones += fillReg(d1, pal.fills[t][1]);
                    if (d2) tones += fillReg(d2, pal.fills[t][2]);
                }
            }
            // Узоры поверх заливки
            if (t === 'water') {
                const deep = path(tierField(F, t, 1, lv));
                if (deep) tones += `<path d="${deep}" fill="url(#ts-sea)"/>`;
            }
            if (t === 'swamp' && style !== 'wash') tones += `<path d="${d0}" fill="url(#ts-swamp)"/>`;
            // заболоченный лес: в глубине между деревьями — стоячая вода
            if (t === 'wetwood' && style !== 'wash') {
                const d2 = path(tierField(F, t, 2, lv));
                tones += `<path d="${d0}" fill="url(#ts-wet)"/>`;
                if (d2) tones += `<path d="${d2}" fill="url(#ts-swamp)"/>`;
            }
        }
        // Светотень: котловины ниже, горы выше, свет с северо-запада
        if (!draft) tones += reliefSvg(F, style === 'ink' ? { dark: '#1F1B16', light: null, strength: 0.9 } : style === 'wash' ? { dark: '#3E3428', strength: 1.1 } : {});
        // Рябь вдоль берега: линии уровня сильнее размытого поля воды — на равных расстояниях от берега
        if (regions.water) {
            const SW = 2.1, wide = typeField(F, 'water', SW);
            const lines = style === 'ink' ? [[3.5, 0.8], [7, 0.55], [10.5, 0.35]] : style === 'wash' ? [[3, 0.4], [6, 0.25]] : [[3.3, 0.6], [6.5, 0.38], [10, 0.22]];
            for (const [dd, op] of lines) {
                const d = fieldPath(F, wide, levelAt(dd, SW * FS), { wob, minArea: 30 });
                if (d) tones += `<path d="${d}" fill="none" stroke="${pal.shore}" stroke-opacity="${op}" stroke-width="0.7" stroke-linejoin="round"/>`;
            }
        }
        // Кромка плато там, где стену не видно (обращена от зрителя)
        if (regions.plateau) edges += walls.rim;
        // Обводка областей
        for (const t of ORDER) {
            if (!regions[t]) continue;
            if (t === 'water') edges += `<path d="${regions.water}" fill="none" stroke="${pal.shore}" stroke-width="${style === 'wash' ? 1 : 1.3}" stroke-opacity="${style === 'wash' ? 0.55 : 0.9}" stroke-linejoin="round"/>`;
            else if (pal.outline) edges += `<path d="${regions[t]}" fill="none" stroke="${pal.outline}" stroke-width="${style === 'ink' ? 0.8 : 0.7}" stroke-opacity="${style === 'ink' ? 0.75 : 0.45}" stroke-linejoin="round"${(t === 'forest' || t === 'conifer') && style === 'ink' ? ' stroke-dasharray="1.5 2"' : ''}/>`;
        }
    }

    // Значки: свободнее разбросаны, раскладка зеркалится, размер чуть гуляет
    const placeAt = new Set((def.places || []).filter(p => !(player && p.hidden)).map(p => keyOf(p.c, p.r)));
    const glyphs = [];
    let engr = '';
    if (showArt && style === 'engraving') {
        engr = engravingGlyphs(def, {
            set: GLYPH_SETS[def.look?.glyphs] ? def.look.glyphs : 'antique',
            spread: SPREADS[def.look?.spread] ? def.look.spread : 'range',
            known, placeAt, field: F, lv, draft, forestMass: loops => forestMassSvg(loops, wob),
            extra: walls.items, blocked: (x, y) => underWall(F, x, y)
        });
    } else if (showArt) {
        // По значку на клетку — той местности, что нарисована в середине клетки
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (!known(c, r) || placeAt.has(keyOf(c, r))) continue;
            const [cx, cy] = cellCenter(c, r);
            const t = typeAt(F, cx, cy);
            if (!t || t === 'plains' || (t !== 'plateau' && underWall(F, cx, cy - 8))) continue;
            const si = srcAt(F, cx, cy);
            let l = si >= 0 ? lv[si] : lv[r * cols + c];
            if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
            const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
            const k = [1.55, 1.85, 2.25][l] * (style === 'ink' ? 0.95 : 1);
            const opt = { jitter: t === 'water' ? 3 : 5, flip: rr(41) < 0.5, vary: 0.22, shade: style !== 'wash', water: 'deep' };
            glyph(t, cx, cy, k, rr, l, opt).forEach(g => glyphs.push({ ...recolor(g, t, l, pal), sw: g.thin ? 0.5 : style === 'wash' ? 0.85 : l === 2 ? 1.15 : 1 }));
        }
        walls.items.forEach(g => glyphs.push({ d: g.d, fill: g.fill, stroke: g.stroke, sw: g.w || 1, y: g.y }));
        glyphs.sort((a, b) => a.y - b.y);
    }
    const glyphSvg = engr + glyphs.map(g => `<path d="${g.d}" fill="${g.fill}" stroke="${g.stroke}"${g.sw !== 1 ? ` stroke-width="${g.sw}"` : ''}/>`).join('');

    // Туман — по тем же правилам, что и края местности (без сдвига), поэтому граница известного совпадает
    let fogEdge = '', fogShade = '';
    const fp = (test, key) => fieldPath(F, fogField(F, test, key), 0.5, { wob });
    if (def.fog && def.fog.includes('0')) {
        const d = fp(v => v > 0, 'k');
        if (d) fogEdge = `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="6 4" clip-path="url(#grid-clip)"/>`;
    }
    // У игроков «по слухам» и «приблизительно» прикрываем полупрозрачной бумагой
    // (маска дала бы то же, но заметно тормозит при сдвиге карты)
    let veil = '';
    if (player && /[12]/.test(def.fog || '')) {
        const d1 = fp(v => v === 1, '1'), d2 = fp(v => v === 2, '2');
        if (d1) veil += `<path d="${d1}" fill="${PAPER}" opacity="${(1 - FOG_OPACITY[1]).toFixed(2)}"/>`;
        if (d2) veil += `<path d="${d2}" fill="${PAPER}" opacity="${(1 - FOG_OPACITY[2]).toFixed(2)}"/>`;
    }
    if (!player && def.fog) {
        const d0 = fp(v => v === 0, '0'), d1 = fp(v => v === 1, '1'), d2 = fp(v => v === 2, '2');
        if (d0) fogShade += `<path d="${d0}" fill="url(#fog-hatch)"/>`;
        if (d1) fogShade += `<path d="${d1}" fill="${PAPER}" opacity="0.42"/>`;
        if (d2) fogShade += `<path d="${d2}" fill="${PAPER}" opacity="0.2"/>`;
        if (fogShade) fogShade = `<g clip-path="url(#grid-clip)">${fogShade}</g>`;
    }

    const wrap = s => s ? `<g clip-path="url(#grid-clip)">${s}</g>` : '';
    const waterF = typeField(F, 'water');
    const { roads, places, placeNames } = renderRoadsAndPlaces(def, { player, natural: true, waterAt: waterF ? (x, y) => sampleAt(F, waterF, x, y) >= 0.5 : null });
    return {
        tones: `<defs>${defs}</defs>` + wrap(tones),
        edges: wrap(edges),
        glyphs: glyphSvg + (veil ? wrap(veil) : ''),
        roads, places, placeNames, fogEdge, fogShade
    };
}
