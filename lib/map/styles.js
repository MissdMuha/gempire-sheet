// Стили местности. «Эскиз» — исходный рисунок (terrain.js). Здесь — новые стили:
// области обводятся плавными контурами вместо клеточных «лесенок», значки разбросаны свободнее,
// у берегов — рябь, туман с мягкими краями.
import {
    S, M, PAPER, PANEL, INK, WATER_INK, TER_CODES, TONES, FOG_OPACITY,
    glyph, terAt, fogAt, terrainLevels, keyOf, cellCenter, rnd, renderTerrain, renderRoadsAndPlaces
} from './terrain.js';
import { GLYPH_SETS, SPREADS, engravingGlyphs, legendParts } from './glyphsets.js';
export { GLYPH_SETS, SPREADS };

export const STYLES = {
    sketch: { label: 'Эскиз', hint: 'Как в исходном макете: тон и значки по клеткам' },
    engraving: { label: 'Гравюра', hint: 'Плавные берега и опушки, рябь у воды, штриховка склонов' },
    wash: { label: 'Акварель', hint: 'Цветные размывы по бумаге, мягкие края' },
    ink: { label: 'Штрих', hint: 'Одна тушь, без цвета — как старая печатная карта' }
};

const ORDER = ['swamp', 'water', 'forest', 'conifer', 'hills', 'mountains'];

// Палитры стилей: [край, середина, глубина] для каждой местности
const WASH = {
    plains: ['#EFE5C9', '#EFE5C9', '#EFE5C9'],
    water: ['#B9CBCA', '#A4BBBD', '#8FAAAF'],
    swamp: ['#C5C7A4', '#B6BA92', '#A6AD82'],
    forest: ['#B3BA8F', '#9EA77A', '#8A9566'],
    conifer: ['#A7B496', '#92A283', '#7D8F70'],
    hills: ['#DCC69C', '#D1B888', '#C5A975'],
    mountains: ['#C3B5A0', '#B2A28A', '#A08F76']
};
const WASH_INK = { conifer: '#33402B', forest: '#3E4A2C', hills: '#5A4630', mountains: '#4A3B2B', swamp: '#3E4A2C', water: '#3D5A73', plains: '#5A4E3A' };
const ENGR = {
    plains: ['#F4EDDD', '#F4EDDD', '#F4EDDD'],
    water: ['#DCE4E0', '#D0DAD7', '#C3D0CD'],
    swamp: ['#E6E5D0', '#DCDCC4', '#D1D2B6'],
    forest: ['#E8E3CA', '#DDD7BA', '#CCC5A3'],
    conifer: ['#E4E3CB', '#D8D7BB', '#C6C5A5'],
    hills: ['#F1E6CC', '#E8DABD', '#DBCBA8'],
    mountains: ['#E8DEC8', '#DCCFB6', '#CBBC9F']
};

// --- Контуры областей ---
// Обходим границу множества клеток по их сторонам; за краем сетки область продолжаем (потом обрежем),
// чтобы у края карты не появлялись скругления
function traceLoops(cols, rows, inside) {
    const ins = (c, r) => {
        if (c < -1 || r < -1 || c > cols || r > rows) return false;
        return inside(Math.min(cols - 1, Math.max(0, c)), Math.min(rows - 1, Math.max(0, r)));
    };
    const out = new Map(); // вершина → исходящие рёбра
    const add = (x0, y0, x1, y1) => {
        const k = x0 + ',' + y0;
        (out.get(k) || out.set(k, []).get(k)).push([x1, y1]);
    };
    for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
        if (!ins(c, r)) continue;
        // по часовой стрелке вокруг клетки (ось y вниз)
        if (!ins(c, r - 1)) add(c, r, c + 1, r);
        if (!ins(c + 1, r)) add(c + 1, r, c + 1, r + 1);
        if (!ins(c, r + 1)) add(c + 1, r + 1, c, r + 1);
        if (!ins(c - 1, r)) add(c, r + 1, c, r);
    }
    const loops = [];
    for (const [startKey, list] of out) {
        while (list.length) {
            const [sx, sy] = startKey.split(',').map(Number);
            let [nx, ny] = list.pop();
            let px = sx, py = sy;
            const loop = [[sx, sy]];
            for (let guard = 0; guard < 200000 && !(nx === sx && ny === sy); guard++) {
                loop.push([nx, ny]);
                const dx = nx - px, dy = ny - py;
                const cand = out.get(nx + ',' + ny);
                if (!cand || !cand.length) break;
                // На «перекрёстке» (клетки касаются углами) сворачиваем направо — так петли не перепутываются
                let idx = -1;
                for (const [qx, qy] of [[-dy, dx], [dx, dy], [dy, -dx]]) {
                    idx = cand.findIndex(([ex, ey]) => ex - nx === qx && ey - ny === qy);
                    if (idx >= 0) break;
                }
                if (idx < 0) idx = 0;
                const [ex, ey] = cand.splice(idx, 1)[0];
                px = nx; py = ny; nx = ex; ny = ey;
            }
            // убираем точки посреди прямых участков
            const simple = loop.filter((p, i) => {
                const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length];
                return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
            });
            if (simple.length >= 3) loops.push(simple.map(([cx, cy]) => [M + cx * S, M + cy * S]));
        }
    }
    return loops;
}

// Плавный шум: им «изгибаем» все контуры. Сдвиг зависит только от места на карте,
// поэтому граница двух соседних областей изгибается одинаково и щелей не появляется
function smoothNoise(x, y, seed) {
    const gx = Math.floor(x), gy = Math.floor(y), u = x - gx, v = y - gy, sm = t => t * t * (3 - 2 * t);
    const h = (a, b) => rnd(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ seed);
    const a = h(gx, gy), b = h(gx + 1, gy), c = h(gx, gy + 1), d = h(gx + 1, gy + 1), su = sm(u), sv = sm(v);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv - 0.5;
}
function warp(x, y, amp) {
    if (!amp) return [x, y];
    const f = 1 / 30, f2 = 1 / 11;
    return [
        x + amp * (smoothNoise(x * f, y * f, 911) * 2 + smoothNoise(x * f2, y * f2, 377) * 0.6),
        y + amp * (smoothNoise(x * f, y * f, 1931) * 2 + smoothNoise(x * f2, y * f2, 5021) * 0.6)
    ];
}

// Углы скругляем (ступенька в одну клетку превращается в волну), затем контур слегка изгибаем.
// Прямые участки дробим в одних и тех же точках карты — у соседних областей они совпадут
function roundPath(loops, radius = S * 0.5, amp = 0) {
    const STEP = S / 4;
    let d = '';
    for (const loop of loops) {
        const n = loop.length, pts = [];
        const corners = loop.map((v, i) => {
            const p = loop[(i - 1 + n) % n], q = loop[(i + 1) % n];
            const lp = Math.hypot(p[0] - v[0], p[1] - v[1]), lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
            const ra = Math.min(radius, lp / 2), rb = Math.min(radius, lq / 2);
            return { a: [v[0] + (p[0] - v[0]) * ra / lp, v[1] + (p[1] - v[1]) * ra / lp], v, b: [v[0] + (q[0] - v[0]) * rb / lq, v[1] + (q[1] - v[1]) * rb / lq] };
        });
        for (let i = 0; i < n; i++) {
            const { a, v, b } = corners[i];
            const steps = amp ? 4 : 1;
            if (!amp) { pts.push({ q: [a, v, b] }); continue; }
            for (let j = 0; j <= steps; j++) {
                const t = j / steps, u = 1 - t;
                pts.push([u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1]]);
            }
            // прямой участок до следующего угла — точки на «круглых» координатах карты
            const nx = corners[(i + 1) % n].a;
            const horiz = Math.abs(nx[1] - b[1]) < 0.01, from = horiz ? b[0] : b[1], to = horiz ? nx[0] : nx[1];
            const lo = Math.min(from, to), hi = Math.max(from, to), mids = [];
            for (let s = Math.ceil(lo / STEP) * STEP; s < hi; s += STEP) if (s - lo > 1 && hi - s > 1) mids.push(s);
            if (to < from) mids.reverse();
            mids.forEach(s => pts.push(horiz ? [s, b[1]] : [b[0], s]));
        }
        const f = x => x.toFixed(1);
        if (!amp) {
            // без изгиба — обычные квадратичные кривые (компактнее)
            d += `M${f(pts[0].q[0][0])} ${f(pts[0].q[0][1])}`;
            pts.forEach(({ q: [a, v, b] }, i) => { if (i) d += `L${f(a[0])} ${f(a[1])}`; d += `Q${f(v[0])} ${f(v[1])} ${f(b[0])} ${f(b[1])}`; });
            d += 'Z';
        } else {
            d += 'M' + pts.map(([x, y]) => { const [wx, wy] = warp(x, y, amp); return f(wx) + ' ' + f(wy); }).join('L') + 'Z';
        }
    }
    return d;
}

// Те же точки контура, что и в roundPath (с изгибом), — для волнистой опушки
function loopPoints(loops, radius, amp) {
    return roundPath(loops, radius, amp).split('Z').filter(Boolean).map(seg => seg.replace(/^M/, '').split('L').map(p => p.trim().split(' ').map(Number)));
}
// Лес одной кроной: опушка из полукруглых «облачков» по контуру леса
export function forestMassSvg(def, inside, amp = 3.2) {
    const loops = traceLoops(def.cols, def.rows, inside);
    if (!loops.length) return '';
    let d = '';
    for (const pts of loopPoints(loops, S * 0.5, amp)) {
        // перестраиваем контур в шаги по ~7 единиц
        const res = [pts[0]];
        let acc = 0;
        for (let i = 1; i <= pts.length; i++) {
            const a = pts[i - 1], b = pts[i % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            let t = 0;
            while (acc + L * (1 - t) >= 7) { t += (7 - acc) / L; acc = 0; res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
            acc += L * (1 - t);
        }
        if (res.length < 3) continue;
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

const regionPath = (def, inside, radius, wobble) => roundPath(traceLoops(def.cols, def.rows, inside), radius, wobble);

// Контур, сдвинутый внутрь области на d (стороны клеток — только горизонтали и вертикали, так что это просто)
function offsetLoop(loop, d) {
    const n = loop.length;
    return loop.map((v, i) => {
        const p = loop[(i - 1 + n) % n], q = loop[(i + 1) % n];
        const e1 = [Math.sign(v[0] - p[0]), Math.sign(v[1] - p[1])], e2 = [Math.sign(q[0] - v[0]), Math.sign(q[1] - v[1])];
        // область — справа по ходу обхода
        return [v[0] + d * (-e1[1] - e2[1]), v[1] + d * (e1[0] + e2[0])];
    });
}

// --- Узоры для стилей ---
function patterns(style) {
    if (style === 'ink') {
        return `<pattern id="ts-sea" width="8" height="4" patternUnits="userSpaceOnUse"><path d="M0 2H8" stroke="${INK}" stroke-width="0.55" stroke-opacity="0.55"/></pattern>` +
            `<pattern id="ts-swamp" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M1 6h4M8 2h3" stroke="${INK}" stroke-width="0.7" stroke-linecap="round" stroke-opacity="0.7"/></pattern>` +
            `<pattern id="ts-hills" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="${INK}" stroke-width="0.35" stroke-opacity="0.35"/></pattern>` +
            `<pattern id="ts-mount" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4" stroke="${INK}" stroke-width="0.45" stroke-opacity="0.45"/></pattern>` +
            `<pattern id="ts-forest" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.6" fill="${INK}" fill-opacity="0.45"/><circle cx="5.5" cy="5.5" r="0.6" fill="${INK}" fill-opacity="0.45"/></pattern>`;
    }
    if (style === 'engraving') {
        return `<pattern id="ts-sea" width="9" height="4.5" patternUnits="userSpaceOnUse"><path d="M0 2.2H9" stroke="${WATER_INK}" stroke-width="0.45" stroke-opacity="0.32"/></pattern>` +
            `<pattern id="ts-swamp" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M1 6h4M8 2h3" stroke="${WATER_INK}" stroke-width="0.7" stroke-linecap="round" stroke-opacity="0.45"/></pattern>`;
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

// --- Главная функция: то же, что renderTerrain, но в выбранном стиле ---
export function renderStyled(def, { player = false, style = 'sketch' } = {}) {
    if (!STYLES[style] || style === 'sketch') return renderTerrain(def, { player });
    const { cols, rows } = def;
    const showArt = def.look?.art !== false;
    const pal = palette(style);
    const lv = terrainLevels(def, true);
    const tAt = (c, r) => terAt(def, c, r);
    const lvl = (c, r) => lv[r * cols + c];
    const known = (c, r) => !player || fogAt(def, c, r) > 0;
    // Насколько изгибать контуры: акварель — свободнее всего, штрих — аккуратнее
    const wob = style === 'wash' ? 4.5 : style === 'engraving' ? 3.2 : 2.4, fogAmp = 2.5;
    // Заливка области; у акварели — подтёк за край и более тёмная кромка пигмента
    const fillReg = (d, color) => style === 'wash'
        ? `<path d="${d}" fill="${color}"/><path d="${d}" fill="none" stroke="${mix(color, '#2B2620', 0.25)}" stroke-width="1.2" stroke-opacity="0.5" stroke-linejoin="round"/>`
        : `<path d="${d}" fill="${color}"/>`;
    const R = S * 0.5;

    let defs = patterns(style);
    let tones = '', edges = '';
    if (showArt) {
        // Подложка суши (равнина) и области местностей, от краёв к глубине
        const land = (c, r) => !!tAt(c, r) && known(c, r);
        const landD = regionPath(def, land, R, wob);
        if (pal.fills && landD) tones += fillReg(landD, pal.fills.plains[0]);
        const regions = {};
        for (const t of ORDER) {
            const has = (c, r) => tAt(c, r) === t && known(c, r);
            const d0 = regionPath(def, has, R, wob);
            if (!d0) continue;
            regions[t] = d0;
            if (pal.fills) {
                tones += fillReg(d0, pal.fills[t][0]);
                if (t !== 'swamp') {
                    const d1 = regionPath(def, (c, r) => has(c, r) && lvl(c, r) >= 1, R, wob);
                    const d2 = regionPath(def, (c, r) => has(c, r) && lvl(c, r) >= 2, R, wob);
                    if (d1) tones += fillReg(d1, pal.fills[t][1]);
                    if (d2) tones += fillReg(d2, pal.fills[t][2]);
                }
            }
            // Узоры поверх заливки
            if (t === 'water' && (style === 'ink' || style === 'engraving' || style === 'wash')) {
                const deep = regionPath(def, (c, r) => has(c, r) && lvl(c, r) >= 1, R, wob);
                if (deep) tones += `<path d="${deep}" fill="url(#ts-sea)"/>`;
            }
            if (t === 'swamp' && style !== 'wash') tones += `<path d="${d0}" fill="url(#ts-swamp)"/>`;
        }
        // Рябь вдоль берега: береговая линия, повторённая внутри воды на нескольких расстояниях
        if (regions.water) {
            const loops = traceLoops(cols, rows, (c, r) => tAt(c, r) === 'water' && known(c, r));
            const lines = style === 'ink' ? [[3.5, 0.8], [7, 0.55], [10.5, 0.35]] : style === 'wash' ? [[3, 0.4], [6, 0.25]] : [[3.3, 0.6], [6.5, 0.38], [10, 0.22]];
            for (const [dd, op] of lines) {
                const d = roundPath(loops.map(l => offsetLoop(l, dd)), R, wob);
                if (d) tones += `<path d="${d}" fill="none" stroke="${pal.shore}" stroke-opacity="${op}" stroke-width="0.7" stroke-linejoin="round"/>`;
            }
        }
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
            known, placeAt, forestMass: (d, inside) => forestMassSvg(d, inside, wob)
        });
    } else if (showArt) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const t = tAt(c, r);
            if (!t || !known(c, r) || placeAt.has(keyOf(c, r))) continue;
            let l = lvl(c, r);
            if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
            const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
            const [cx, cy] = cellCenter(c, r);
            const k = [1.55, 1.85, 2.25][l] * (style === 'ink' ? 0.95 : 1);
            const opt = {
                jitter: t === 'water' ? 3 : 7, flip: rr(41) < 0.5, vary: 0.22,
                shade: style !== 'wash', water: style === 'wash' ? 'deep' : 'deep'
            };
            glyph(t, cx, cy, k, rr, l, opt).forEach(g => glyphs.push({ ...recolor(g, t, l, pal), sw: g.thin ? 0.5 : style === 'wash' ? 0.85 : l === 2 ? 1.15 : 1 }));
        }
        glyphs.sort((a, b) => a.y - b.y);
    }
    const glyphSvg = engr + glyphs.map(g => `<path d="${g.d}" fill="${g.fill}" stroke="${g.stroke}"${g.sw !== 1 ? ` stroke-width="${g.sw}"` : ''}/>`).join('');

    // Туман: у игроков «по слухам» и «приблизительно» — бледнее; края скруглены
    let fogEdge = '', fogShade = '';
    const fogLv = (c, r) => fogAt(def, c, r);
    if (def.fog && def.fog.includes('0')) {
        const d = regionPath(def, (c, r) => fogLv(c, r) > 0, R, fogAmp);
        if (d) fogEdge = `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="6 4" clip-path="url(#grid-clip)"/>`;
    }
    // У игроков «по слухам» и «приблизительно» прикрываем полупрозрачной бумагой
    // (маска дала бы то же, но заметно тормозит при сдвиге карты)
    let veil = '';
    if (player && /[12]/.test(def.fog || '')) {
        const d1 = regionPath(def, (c, r) => fogLv(c, r) === 1, R, fogAmp), d2 = regionPath(def, (c, r) => fogLv(c, r) === 2, R, fogAmp);
        if (d1) veil += `<path d="${d1}" fill="${PAPER}" opacity="${(1 - FOG_OPACITY[1]).toFixed(2)}"/>`;
        if (d2) veil += `<path d="${d2}" fill="${PAPER}" opacity="${(1 - FOG_OPACITY[2]).toFixed(2)}"/>`;
    }
    if (!player && def.fog) {
        const d0 = regionPath(def, (c, r) => fogLv(c, r) === 0, R, fogAmp);
        const d1 = regionPath(def, (c, r) => fogLv(c, r) === 1, R, fogAmp);
        const d2 = regionPath(def, (c, r) => fogLv(c, r) === 2, R, fogAmp);
        if (d0) fogShade += `<path d="${d0}" fill="url(#fog-hatch)"/>`;
        if (d1) fogShade += `<path d="${d1}" fill="${PAPER}" opacity="0.42"/>`;
        if (d2) fogShade += `<path d="${d2}" fill="${PAPER}" opacity="0.2"/>`;
        if (fogShade) fogShade = `<g clip-path="url(#grid-clip)">${fogShade}</g>`;
    }

    const wrap = s => s ? `<g clip-path="url(#grid-clip)">${s}</g>` : '';
    const { roads, places, placeNames } = renderRoadsAndPlaces(def, { player });
    return {
        tones: `<defs>${defs}</defs>` + wrap(tones),
        edges: wrap(edges),
        glyphs: glyphSvg + veil,
        roads, places, placeNames, fogEdge, fogShade
    };
}
