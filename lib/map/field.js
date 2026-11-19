// Естественные очертания местности.
// Местность хранится по клеткам, но рисуется не клетками. Каждую точку карты берём из слегка сдвинутой
// клетки (плавный шум), поле каждой местности размываем и обводим по середине — берега, опушки и подножия
// идут своими кривыми, а не по сетке. Тем же полем пользуются значки, поэтому они не вылезают за край области.
// Внешний край известного (туман, пустые клетки) не сдвигается — он совпадает с линией тумана.
import { S, M, terAt, fogAt, rnd } from './terrain.js';

export const SUB = 4;           // отсчётов поля на клетку
export const FS = S / SUB;      // шаг поля, px
const PAD = 1;                  // клеток за краем сетки: там местность продолжается (потом обрезается)
export const TYPES = ['plains', 'water', 'swamp', 'wetwood', 'plateau', 'forest', 'conifer', 'hills', 'mountains'];
export const TI = Object.fromEntries(TYPES.map((t, i) => [t, i]));
export const SIG = 1.25;        // размытие границ, в шагах поля

// Плавный шум в [-0.5, 0.5]
export function vnoise(x, y, seed) {
    const gx = Math.floor(x), gy = Math.floor(y), u = x - gx, v = y - gy, sm = t => t * t * (3 - 2 * t);
    const h = (a, b) => rnd(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ seed);
    const a = h(gx, gy), b = h(gx + 1, gy), c = h(gx, gy + 1), d = h(gx + 1, gy + 1), su = sm(u), sv = sm(v);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv - 0.5;
}

// Сдвиг: из какой точки (в клетках) брать местность для точки (u, v). Не больше ~0.7 клетки
export function warpUV(u, v) {
    return [
        u + 1.0 * vnoise(u / 2.4, v / 2.4, 101) + 0.34 * vnoise(u / 0.9, v / 0.9, 211),
        v + 1.0 * vnoise(u / 2.4, v / 2.4, 307) + 0.34 * vnoise(u / 0.9, v / 0.9, 401)
    ];
}
export function warpPx(x, y) {
    const [u, v] = warpUV((x - M) / S, (y - M) / S);
    return [M + u * S, M + v * S];
}

// Сдвиги зависят только от размера сетки — считаем один раз
const warpCache = new Map();
function warpGrid(cols, rows) {
    const key = cols + 'x' + rows;
    let g = warpCache.get(key);
    if (g) return g;
    const W = (cols + 2 * PAD) * SUB, H = (rows + 2 * PAD) * SUB, n = W * H;
    const cl = (v, hi) => v < 0 ? 0 : v > hi ? hi : v;
    const cell0 = new Int32Array(n), cell1 = new Int32Array(n), du = new Float32Array(n), dv = new Float32Array(n);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / SUB - PAD, v = (j + 0.5) / SUB - PAD, k = j * W + i;
        cell0[k] = cl(Math.floor(v), rows - 1) * cols + cl(Math.floor(u), cols - 1);
        const [wu, wv] = warpUV(u, v);
        du[k] = wu - u; dv[k] = wv - v;
        cell1[k] = cl(Math.floor(wv), rows - 1) * cols + cl(Math.floor(wu), cols - 1);
    }
    g = { W, H, cell0, cell1, du, dv };
    if (warpCache.size > 6) warpCache.clear();
    warpCache.set(key, g);
    return g;
}

// Поле местности: для каждого отсчёта — местность (индекс в TYPES или -1) и клетка, из которой она взята
export function buildField(def, known = () => true) {
    const { cols, rows } = def, g = warpGrid(cols, rows), { W, H } = g, n = W * H;
    const cellT = new Int8Array(cols * rows).fill(-1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!known(c, r)) continue;
        const t = terAt(def, c, r);
        if (t && TI[t] !== undefined) cellT[r * cols + c] = TI[t];
    }
    const lab = new Int8Array(n).fill(-1), src = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
        const i0 = g.cell0[k];
        if (cellT[i0] < 0) continue;
        const i1 = g.cell1[k], s = cellT[i1] >= 0 ? i1 : i0;
        lab[k] = cellT[s]; src[k] = s;
    }
    const x0 = M - PAD * S, y0 = M - PAD * S, { du, dv } = g;
    // Сдвиг точки карты (px) — по готовой сетке сдвигов, билинейно (в узлах — точно как у поля).
    // Возвращает один и тот же массив (разбирать сразу); одну и ту же точку часто спрашивают подряд — помним последнюю
    const out = [0, 0];
    let lx = NaN, ly = NaN;
    const warp = (x, y) => {
        if (x === lx && y === ly) return out;
        lx = x; ly = y;
        let fx = (x - x0) / FS - 0.5, fy = (y - y0) / FS - 0.5;
        fx = fx < 0 ? 0 : fx > W - 1.001 ? W - 1.001 : fx; fy = fy < 0 ? 0 : fy > H - 1.001 ? H - 1.001 : fy;
        const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * W + i;
        const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
        out[0] = x + S * (du[k] * a + du[k + 1] * b + du[k + W] * c + du[k + W + 1] * d);
        out[1] = y + S * (dv[k] * a + dv[k + 1] * b + dv[k + W] * c + dv[k + W + 1] * d);
        return out;
    };
    return { def, cols, rows, W, H, n, lab, src, cell0: g.cell0, x0, y0, warp, cache: new Map() };
}

function kernel(sig) {
    const R = Math.max(1, Math.ceil(sig * 2.6)), K = [];
    let s = 0;
    for (let i = -R; i <= R; i++) { const v = Math.exp(-i * i / (2 * sig * sig)); K.push(v); s += v; }
    return K.map(v => v / s);
}
// Размытие по Гауссу (раздельно по строкам и столбцам), только в рамке box = [x0, y0, x1, y1] (с запасом на ядро)
function blur(W, H, a, sig, box = [0, 0, W - 1, H - 1]) {
    const K = kernel(sig), R = (K.length - 1) / 2, tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    const bx0 = Math.max(0, box[0] - R), by0 = Math.max(0, box[1] - R), bx1 = Math.min(W - 1, box[2] + R), by1 = Math.min(H - 1, box[3] + R);
    for (let y = box[1]; y <= box[3]; y++) {
        const row = y * W;
        for (let x = bx0; x <= bx1; x++) {
            let s = 0;
            const lo = Math.max(-R, -x), hi = Math.min(R, W - 1 - x);
            for (let j = lo; j <= hi; j++) s += a[row + x + j] * K[j + R];
            tmp[row + x] = s;
        }
    }
    for (let y = by0; y <= by1; y++) {
        const lo = Math.max(-R, -y), hi = Math.min(R, H - 1 - y);
        for (let x = bx0; x <= bx1; x++) {
            let s = 0;
            for (let j = lo; j <= hi; j++) s += tmp[(y + j) * W + x] * K[j + R];
            out[y * W + x] = s;
        }
    }
    return out;
}

// Размытое «да/нет» по отсчётам: pred(k) → bool. null, если ни одного «да»
export function smooth(F, key, pred, sig = SIG) {
    const ck = key + '|' + sig;
    if (F.cache.has(ck)) return F.cache.get(ck);
    const a = new Float32Array(F.n), W = F.W, H = F.H;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0, k = 0; y < H; y++) {
        let rowAny = false;
        for (let x = 0; x < W; x++, k++) if (pred(k)) {
            a[k] = 1; rowAny = true;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
        }
        if (rowAny) { if (y < y0) y0 = y; y1 = y; }
    }
    const out = x1 >= 0 ? blur(W, F.H, a, sig, [x0, y0, x1, y1]) : null;
    F.cache.set(ck, out);
    return out;
}
// Готовые поля: местность t; местность t не ниже ступени l (lv — ступени клеток); вся известная суша
export const typeField = (F, t, sig = SIG) => { const i = TI[t], lab = F.lab; return smooth(F, 'T' + t, k => lab[k] === i, sig); };
export const tierField = (F, t, l, lv, sig = SIG) => smooth(F, 'L' + t + l, k => F.lab[k] === TI[t] && lv[F.src[k]] >= l, sig);
export const landField = (F, sig = SIG) => smooth(F, 'land', k => F.lab[k] >= 0, sig);
// Туман — по самим клеткам, без сдвига
export const fogField = (F, test, key) => smooth(F, 'F' + key, k => { const i = F.cell0[k]; return test(fogAt(F.def, i % F.cols, (i / F.cols) | 0)); });

// Значение поля в точке карты (px), билинейно
export function sampleAt(F, f, x, y) {
    if (!f) return 0;
    const fx = (x - F.x0) / FS - 0.5, fy = (y - F.y0) / FS - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, W = F.W, H = F.H;
    const g = (ii, jj) => (ii < 0 || jj < 0 || ii >= W || jj >= H) ? 0 : f[jj * W + ii];
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
}
// Какая местность нарисована в точке (по полям местностей); null — пусто
export function typeAt(F, x, y) {
    let best = null, bv = 0.5;
    for (const t of TYPES) {
        const v = sampleAt(F, typeField(F, t), x, y);
        if (v >= bv) { bv = v; best = t; }
    }
    return best;
}
// Клетка, из которой взята местность в точке (px)
export function srcAt(F, x, y) {
    const i = Math.floor((x - F.x0) / FS), j = Math.floor((y - F.y0) / FS);
    if (i < 0 || j < 0 || i >= F.W || j >= F.H) return -1;
    return F.src[j * F.W + i];
}

// Линии уровня поля (marching squares): замкнутые петли [[x, y], …], область — справа по ходу обхода
export function contours(F, f, level = 0.5) {
    if (!f) return [];
    const { W, H, x0, y0 } = F, W2 = W + 2;
    const val = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 0 : f[j * W + i];
    const hKey = (i, j) => ((j + 1) * W2 + (i + 1)) * 2, vKey = (i, j) => ((j + 1) * W2 + (i + 1)) * 2 + 1;
    const px = i => x0 + (i + 0.5) * FS, py = j => y0 + (j + 0.5) * FS;
    const next = new Map(), pt = new Map();
    for (let j = -1; j < H; j++) for (let i = -1; i < W; i++) {
        const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
        const ia = a >= level, ib = b >= level, ic = c >= level, id = d >= level;
        if (ia === ib && ib === ic && ic === id) continue;
        // пересечения по часовой стрелке: верх, право, низ, лево; exit — выходим из области
        const cr = [];
        if (ia !== ib) cr.push({ k: hKey(i, j), x: px(i) + (level - a) / (b - a) * FS, y: py(j), exit: ia });
        if (ib !== ic) cr.push({ k: vKey(i + 1, j), x: px(i + 1), y: py(j) + (level - b) / (c - b) * FS, exit: ib });
        if (ic !== id) cr.push({ k: hKey(i, j + 1), x: px(i) + (level - d) / (c - d) * FS, y: py(j + 1), exit: ic });
        if (id !== ia) cr.push({ k: vKey(i, j), x: px(i), y: py(j) + (level - a) / (d - a) * FS, exit: id });
        const centerIn = (a + b + c + d) / 4 >= level, m = cr.length;
        for (let e = 0; e < m; e++) {
            if (!cr[e].exit) continue;
            const en = m === 2 ? cr[1 - e] : cr[(e + (centerIn ? 1 : 3)) % 4];
            next.set(cr[e].k, en.k);
            pt.set(cr[e].k, [cr[e].x, cr[e].y]);
        }
    }
    const loops = [], seen = new Set();
    for (const k0 of next.keys()) {
        if (seen.has(k0)) continue;
        const loop = [];
        let k = k0;
        while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(pt.get(k)); k = next.get(k); }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

// Лёгкая «дрожь пера»: сдвиг зависит только от места, поэтому общие границы дрожат одинаково
export function wobble(x, y, amp) {
    const f = 1 / 13;
    return [x + amp * vnoise(x * f, y * f, 911), y + amp * vnoise(x * f, y * f, 1931)];
}
// Петли → гладкий путь SVG (квадратичные кривые через середины отрезков). minArea отбрасывает соринки
export function loopsPath(loops, { wob = 1.6, minArea = 6 } = {}) {
    let d = '';
    const f = v => (Math.round(v * 10) / 10).toString();
    for (const loop of loops) {
        const pts = [];
        for (const p of loop) { const q = pts[pts.length - 1]; if (!q || Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1.4) pts.push(p); }
        const n = pts.length;
        if (n < 3) continue;
        let area = 0;
        for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
        if (Math.abs(area / 2) < minArea) continue;
        const P = wob ? pts.map(([x, y]) => wobble(x, y, wob)) : pts;
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const m0 = mid(P[n - 1], P[0]);
        d += `M${f(m0[0])} ${f(m0[1])}`;
        for (let i = 0; i < n; i++) { const p = P[i], q = mid(p, P[(i + 1) % n]); d += `Q${f(p[0])} ${f(p[1])} ${f(q[0])} ${f(q[1])}`; }
        d += 'Z';
    }
    return d;
}
// Петли поля сразу путём
export const fieldPath = (F, f, level = 0.5, opt) => f ? loopsPath(contours(F, f, level), opt) : '';

// Нормальное распределение: на каком уровне размытого поля лежит линия в d px от края
function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
}
export const levelAt = (d, sigPx) => 0.5 * (1 + erf(d / (sigPx * Math.SQRT2)));

// ---------------- Светотень рельефа ----------------
// Высота — плавный купол над каждым массивом: чем дальше вглубь гор (или холмов), тем выше; вода и топь — ниже.
// Купол считается по размытым полям местности, поэтому склоны пологие и не повторяют ни клеток, ни ступеней.
// Свет с северо-запада. Рисуется полупрозрачной картинкой под значками (только в браузере)
export function reliefSvg(F, { dark = '#5C4A35', light = '#FFFBF0', strength = 1 } = {}) {
    if (typeof document === 'undefined') return '';
    const { W, H, n, lab } = F;
    // Купол считаем на сетке клеток (он всё равно плавный), потом переносим на отсчёты поля
    const CW = W / SUB, CH = H / SUB, cn = CW * CH;
    const frac = (test) => {
        const a = new Float32Array(cn);
        let any = false;
        for (let k = 0; k < n; k++) if (test(lab[k])) { a[((((k / W) | 0) / SUB) | 0) * CW + (((k % W) / SUB) | 0)] += 1 / (SUB * SUB); any = true; }
        return any ? a : null;
    };
    const fm = frac(t => t === TI.mountains), fh = frac(t => t === TI.hills), fw = frac(t => t === TI.water), fsw = frac(t => t === TI.swamp || t === TI.wetwood);
    const fp = frac(t => t === TI.plateau);
    if (!fm && !fh && !fw && !fp) return '';
    const fl = frac(t => t >= 0);
    const share = (f, sig) => {
        if (!f) return null;
        const b = blur(CW, CH, f, sig), l = blur(CW, CH, fl, sig), out = new Float32Array(cn);
        for (let i = 0; i < cn; i++) out[i] = l[i] > 0.03 ? b[i] / l[i] : 0;
        return out;
    };
    // плато — ровный стол с крутым краем: размытие маленькое, чтобы склон был узким
    const terms = [[fm, 1, 1.6], [fm, 2.5, 1.5], [fh, 1, 0.55], [fh, 2.2, 0.3], [fw, 0.8, -0.45], [fsw, 1.3, -0.2], [fp, 0.45, 1.8]];
    const zc = new Float32Array(cn);
    for (const [f, sig, w] of terms) { const sh = share(f, sig); if (sh) for (let i = 0; i < cn; i++) zc[i] += w * sh[i]; }
    const mc = share(fm, 0.5);
    // на отсчёты поля — билинейно; в горах — лёгкие гребни
    const z = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let cx = (x + 0.5) / SUB - 0.5, cy = (y + 0.5) / SUB - 0.5;
        cx = cx < 0 ? 0 : cx > CW - 1.001 ? CW - 1.001 : cx; cy = cy < 0 ? 0 : cy > CH - 1.001 ? CH - 1.001 : cy;
        const i = cx | 0, j = cy | 0, u = cx - i, v = cy - j, c = j * CW + i;
        const bl = f => f[c] * (1 - u) * (1 - v) + f[c + 1] * u * (1 - v) + f[c + CW] * (1 - u) * v + f[c + CW + 1] * u * v;
        let zz = bl(zc);
        if (mc) { const m = bl(mc); if (m > 0.05) zz += m * 0.35 * (0.5 - Math.abs(vnoise(x / SUB / 1.4, y / SUB / 1.4, 1201)) * 2); }
        z[y * W + x] = zz;
    }
    const land = landField(F);
    const Z = 11 * strength, L = [-1, -1, 1.5], ln = Math.hypot(...L), lx = L[0] / ln, ly = L[1] / ln, lz = L[2] / ln;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), px = img.data;
    const rgb = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const D = rgb(dark), Lc = light ? rgb(light) : null;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x, a0 = land ? land[k] : 0;
        if (a0 < 0.02) continue;
        const gx = (z[k + 1] - z[k - 1]) / (2 * FS), gy = (z[k + W] - z[k - W]) / (2 * FS);
        const nx = -Z * gx, ny = -Z * gy, nl = Math.hypot(nx, ny, 1);
        const dd = (nx * lx + ny * ly + lz) / nl - lz;
        const o = k * 4, cov = Math.min(1, a0 * 1.6);
        if (dd < 0) { px[o] = D[0]; px[o + 1] = D[1]; px[o + 2] = D[2]; px[o + 3] = Math.min(88, -dd * 1.2 * 255) * cov; }
        else if (Lc) { px[o] = Lc[0]; px[o + 1] = Lc[1]; px[o + 2] = Lc[2]; px[o + 3] = Math.min(64, dd * 0.9 * 255) * cov; }
    }
    ctx.putImageData(img, 0, 0);
    return `<image href="${cv.toDataURL('image/png')}" x="${F.x0}" y="${F.y0}" width="${W * FS}" height="${H * FS}" preserveAspectRatio="none" style="image-rendering:auto"/>`;
}
