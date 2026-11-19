// Стили местности. «Эскиз» — исходный рисунок (terrain.js). Здесь — новые стили:
// области обводятся плавными кривыми, а не по клеткам (field.js), значки разбросаны свободнее,
// у берегов — рябь, горы и котловины оттенены светотенью, туман с мягкими краями.
import {
    S, M, PAPER, PANEL, INK, WATER_INK, TER_CODES, TONES, FOG_OPACITY,
    glyph, terAt, fogAt, terrainLevels, keyOf, cellCenter, rnd, renderTerrain, renderRoadsAndPlaces
} from './terrain.js';
import { GLYPH_SETS, SPREADS, engravingGlyphs, legendParts } from './glyphsets.js';
import { buildField, typeField, tierField, landField, fogField, fieldPath, levelAt, reliefSvg, typeAt, srcAt, sampleAt, wobble, FS } from './field.js';
export { GLYPH_SETS, SPREADS };

export const STYLES = {
    sketch: { label: 'Эскиз', hint: 'Как в исходном макете: тон и значки по клеткам' },
    engraving: { label: 'Гравюра', hint: 'Плавные берега и опушки, рябь у воды, штриховка склонов' },
    wash: { label: 'Акварель', hint: 'Цветные размывы по бумаге, мягкие края' },
    ink: { label: 'Штрих', hint: 'Одна тушь, без цвета — как старая печатная карта' }
};

const ORDER = ['swamp', 'wetwood', 'water', 'forest', 'conifer', 'hills', 'mountains'];

// Палитры стилей: [край, середина, глубина] для каждой местности
const WASH = {
    plains: ['#EFE5C9', '#EFE5C9', '#EFE5C9'],
    water: ['#B9CBCA', '#A4BBBD', '#8FAAAF'],
    swamp: ['#C5C7A4', '#B6BA92', '#A6AD82'],
    wetwood: ['#B2BC97', '#A3B394', '#97AC99'],
    forest: ['#B3BA8F', '#9EA77A', '#8A9566'],
    conifer: ['#A7B496', '#92A283', '#7D8F70'],
    hills: ['#DCC69C', '#D1B888', '#C5A975'],
    mountains: ['#C3B5A0', '#B2A28A', '#A08F76']
};
const WASH_INK = { conifer: '#33402B', forest: '#3E4A2C', wetwood: '#3A4A3A', hills: '#5A4630', mountains: '#4A3B2B', swamp: '#3E4A2C', water: '#3D5A73', plains: '#5A4E3A' };
const ENGR = {
    plains: ['#F4EDDD', '#F4EDDD', '#F4EDDD'],
    water: ['#DCE4E0', '#D0DAD7', '#C3D0CD'],
    swamp: ['#E6E5D0', '#DCDCC4', '#D1D2B6'],
    wetwood: ['#E2E4CF', '#D6DDCC', '#CAD5CB'],
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
                if (t !== 'swamp') {
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
            known, placeAt, field: F, lv, draft, forestMass: loops => forestMassSvg(loops, wob)
        });
    } else if (showArt) {
        // По значку на клетку — той местности, что нарисована в середине клетки
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (!known(c, r) || placeAt.has(keyOf(c, r))) continue;
            const [cx, cy] = cellCenter(c, r);
            const t = typeAt(F, cx, cy);
            if (!t || t === 'plains') continue;
            const si = srcAt(F, cx, cy);
            let l = si >= 0 ? lv[si] : lv[r * cols + c];
            if (t === 'mountains' && l === 2 && (c + r) % 2) l = 1;
            const rr = k => rnd(Math.imul(c + 1, 7919) ^ Math.imul(r + 1, 104729) ^ Math.imul(k + 1, 2654435761));
            const k = [1.55, 1.85, 2.25][l] * (style === 'ink' ? 0.95 : 1);
            const opt = { jitter: t === 'water' ? 3 : 5, flip: rr(41) < 0.5, vary: 0.22, shade: style !== 'wash', water: 'deep' };
            glyph(t, cx, cy, k, rr, l, opt).forEach(g => glyphs.push({ ...recolor(g, t, l, pal), sw: g.thin ? 0.5 : style === 'wash' ? 0.85 : l === 2 ? 1.15 : 1 }));
        }
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
