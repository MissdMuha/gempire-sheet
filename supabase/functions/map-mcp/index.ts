// @ts-nocheck
// Коннектор «Карта» для Claude (MCP-сервер) — функция Supabase (Edge Function).
// Claude видит карту целиком (и скрытое от игроков) и может дописывать и править справку мастера по клеткам.
// Доступ — по ключу Claude: он стоит в адресе коннектора (…/functions/v1/map-mcp?key=КЛЮЧ). Без ключа функция
// ничего не отдаёт, а сама работает через функции базы под ключом (supabase/map-setup.sql, раздел 6) —
// служебных прав у неё нет.
//
// Как развернуть — КАРТА.md, раздел «Claude». Коротко: Supabase → Edge Functions → Deploy a new function →
// Via Editor → имя map-mcp → вставить этот файл → Deploy; затем в настройках функции выключить «Verify JWT»
// (или из консоли: supabase functions deploy map-mcp --no-verify-jwt).
// Подключить: claude.ai → Настройки → Коннекторы → Добавить свой → адрес коннектора из окна «Доступ для Claude».

const S = 28, M = 40; // клетка и поля карты, в точках
const LET = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭ';
const colName = i => i < LET.length ? LET[i] : LET[Math.floor(i / LET.length) - 1] + LET[i % LET.length];
const coord = (c, r) => colName(c) + (r + 1);
const LATIN = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
const TER = { '.': 'пусто', w: 'вода', s: 'топь', b: 'заболоченный лес', p: 'равнина', u: 'плато', f: 'лес', c: 'ельник', h: 'холмы', m: 'горы' };
const LV = {
    f: ['лесок', 'лес', 'чаща'], c: ['редкий ельник', 'ельник', 'глухой ельник'], h: ['пригорки', 'холмы', 'взгорье'], m: ['предгорья', 'горы', 'хребет'],
    s: ['сырой луг', 'топь', 'трясина'], b: ['сырой лес', 'заболоченный лес', 'затопленный лес'], w: ['мелководье', 'озеро', 'глубокие воды']
};
const FOG = ['неизвестно игрокам', 'по слухам', 'известно приблизительно', 'разведано'];
const PLACE = { village: 'деревня', town: 'село', city: 'город', castle: 'замок', tower: 'башня', ruin: 'руины', cave: 'пещера', shrine: 'святилище' };
const MARK = { camp: 'лагерь', danger: 'опасность', cache: 'тайник', unknown: 'загадка', note: 'заметка', goal: 'цель', person: 'встреча', battle: 'сражение', treasure: 'сокровище', entrance: 'вход' };
const SHAPE = { line: 'прямая', path: 'маршрут', free: 'линия от руки', circle: 'круг', poly: 'область' };
const ROAD = { trail: 'тропа', road: 'дорога', river: 'река' };

function colIndex(name, cols) {
    const n = name.toUpperCase().replace(/Ё/g, 'Е').replace(/[A-Z]/g, ch => LATIN[ch] || ch);
    for (let i = 0; i < Math.max(cols, 26); i++) if (colName(i) === n) return i;
    return -1;
}
function parseCell(s, def) {
    const m = String(s).trim().match(/^([A-Za-zА-Яа-яЁё]{1,2})\s*(\d{1,3})$/);
    if (!m) return null;
    const c = colIndex(m[1], def.cols), r = Number(m[2]) - 1;
    return c < 0 || c >= def.cols || r < 0 || r >= def.rows ? null : [c, r];
}
// Ключ справки → клетки: «Ж22», «К10:О14», «Е20, Е21»
function keyCells(key, def) {
    const out = [];
    for (const part of String(key).split(/[,;]/)) {
        const p = part.trim();
        if (!p) continue;
        const range = p.split(/\s*(?::|–|—|\.\.|-)\s*/);
        if (range.length === 2) {
            const a = parseCell(range[0], def), b = parseCell(range[1], def);
            if (!a || !b) return null;
            for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++)
                for (let c = Math.min(a[0], b[0]); c <= Math.max(a[0], b[0]); c++) out.push([c, r]);
        } else {
            const a = parseCell(p, def);
            if (!a) return null;
            out.push(a);
        }
    }
    return out.length ? out : null;
}
const cellOfPt = (x, y) => [Math.floor((x - M) / S), Math.floor((y - M) / S)];
const at = (str, def, c, r) => str ? str[r * def.cols + c] : undefined;
const entryText = v => typeof v === 'string' ? { title: '', text: v } : Array.isArray(v) ? { title: '', text: v.join('\n\n') } : { title: String(v?.title || ''), text: String(v?.text ?? '') };
const short = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function terrainName(def, c, r) {
    const t = at(def.terrain, def, c, r) || '.', tier = Number(at(def.tier, def, c, r) || 0);
    if (!TER[t]) return 'пусто';
    return tier && LV[t] ? `${LV[t][tier - 1]} (${TER[t]}, ступень задана)` : TER[t];
}

// ---------- Обзор карты и клетки — текстом для Claude ----------
function mapOverview(map, { fog = false } = {}) {
    const def = map.def || {}, cols = def.cols || 0, rows = def.rows || 0, out = [];
    out.push(`Карта «${map.name}» (id ${map.id})${map.is_current ? ' — сейчас у игроков' : ''}. ${cols} × ${rows} клеток` +
        (def.scale && def.scale.unit ? `, 1 клетка = ${def.scale.n} ${def.scale.unit}` : '') + (def.subtitle ? `. ${def.subtitle}` : '') + '.');
    out.push('Клетка называется буквой столбца и номером строки сверху: «Ж22».');
    const head = '     ' + Array.from({ length: cols }, (_, c) => colName(c).padEnd(3)).join('');
    out.push('\nМестность (символ — вид, цифра — ступень, если задана мастером: 1 край массива … 3 глубина):');
    out.push('. пусто, w вода, s топь, b заболоченный лес, p равнина, u плато, f лес, c ельник, h холмы, m горы.');
    out.push(head);
    for (let r = 0; r < rows; r++) {
        let line = String(r + 1).padStart(3) + '  ';
        for (let c = 0; c < cols; c++) { const t = at(def.terrain, def, c, r) || '.', tr = at(def.tier, def, c, r); line += (t + (tr && tr !== '0' ? tr : ' ')).padEnd(3); }
        out.push(line.trimEnd());
    }
    if (fog && def.fog) {
        out.push('\nЧто знают игроки (0 не знают, 1 по слухам, 2 приблизительно, 3 разведано):');
        out.push(head);
        for (let r = 0; r < rows; r++) out.push((String(r + 1).padStart(3) + '  ' + Array.from({ length: cols }, (_, c) => (at(def.fog, def, c, r) || '3').padEnd(3)).join('')).trimEnd());
    }
    const places = def.places || [];
    if (places.length) {
        out.push('\nСеления:');
        places.forEach(p => out.push(`- ${coord(p.c, p.r)} ${p.name || '(без названия)'} — ${PLACE[p.type] || p.type}` +
            (p.hidden ? ', скрыто от игроков' : p.nameHidden ? ', игроки видят без названия' : '') + (p.note ? `. Заметка мастера: ${short(p.note, 300)}` : '')));
    }
    const roads = def.roads || [];
    if (roads.length) {
        out.push('\nТропы, дороги, реки:');
        roads.forEach(rd => out.push(`- ${ROAD[rd.kind] || rd.kind}${rd.hidden ? ' (скрыта от игроков)' : ''}: ${rd.cells.map(([c, r]) => coord(c, r)).join(' → ')}`));
    }
    const marks = map.marks || [];
    if (marks.length) {
        out.push('\nПометки (◌ — скрыта от игроков):');
        for (const k of marks) {
            const d = k.data || {}, h = k.hidden ? ' ◌' : '';
            if (k.kind === 'marker') { const [c, r] = cellOfPt(d.x, d.y); out.push(`- ${coord(c, r)} метка «${d.name || ''}» (${MARK[d.type] || d.type})${h}${d.note ? ': ' + short(d.note, 400) : ''}`); }
            else if (k.kind === 'label') { const [c, r] = cellOfPt(d.x, d.y); out.push(`- ${coord(c, r)} подпись «${d.text || ''}»${h}`); }
            else if (k.kind === 'zone') out.push(`- зона «${d.name || ''}»${h}: ${(d.cells || []).map(s => { const [c, r] = s.split(',').map(Number); return coord(c, r); }).join(', ')}${d.note ? '. ' + short(d.note, 300) : ''}`);
            else if (k.kind === 'shape' && d.pts && d.pts.length) { const [c, r] = cellOfPt(d.pts[0][0], d.pts[0][1]); out.push(`- ${SHAPE[d.shape] || d.shape} от ${coord(c, r)}${d.name ? ` «${d.name}»` : ''}${h}${d.note ? ': ' + short(d.note, 300) : ''}`); }
        }
    }
    const ref = map.ref || {};
    const keys = Object.keys(ref).filter(k => !k.startsWith('_'));
    out.push(keys.length ? `\nСправка мастера: ${keys.length} записей — ${keys.map(k => { const e = entryText(ref[k]); return e.title ? `${k} «${e.title}»` : k; }).join(', ')}. Полный текст — get_reference или view_cell.`
        : '\nСправки мастера по клеткам пока нет.');
    return out.join('\n');
}

function cellInfo(map, cell) {
    const def = map.def || {}, p = parseCell(cell, def);
    if (!p) throw new Error(`нет такой клетки: «${cell}» (на карте столбцы ${colName(0)}…${colName(def.cols - 1)}, строки 1…${def.rows})`);
    const [c, r] = p, out = [];
    out.push(`Клетка ${coord(c, r)} на карте «${map.name}»: ${terrainName(def, c, r)}. Игрокам: ${FOG[Number(at(def.fog, def, c, r) ?? 3)] || FOG[3]}.`);
    (def.places || []).filter(q => q.c === c && q.r === r).forEach(q => out.push(`Селение: ${q.name || '(без названия)'} — ${PLACE[q.type] || q.type}${q.hidden ? ', скрыто от игроков' : q.nameHidden ? ', игроки видят без названия' : ''}.${q.note ? ' Заметка мастера: ' + q.note : ''}`));
    (def.roads || []).filter(rd => rd.cells.some(q => q[0] === c && q[1] === r)).forEach(rd => out.push(`Через клетку: ${ROAD[rd.kind] || rd.kind}${rd.hidden ? ' (скрыта от игроков)' : ''}.`));
    for (const k of map.marks || []) {
        const d = k.data || {}, h = k.hidden ? ' (скрыта от игроков)' : '';
        if ((k.kind === 'marker' || k.kind === 'label') && cellOfPt(d.x, d.y).join() === c + ',' + r)
            out.push(k.kind === 'marker' ? `Метка «${d.name || ''}» (${MARK[d.type] || d.type})${h}${d.note ? ': ' + d.note : ''}` : `Подпись «${d.text || ''}»${h}`);
        if (k.kind === 'zone' && (d.cells || []).includes(c + ',' + r)) out.push(`Зона «${d.name || ''}»${h}${d.note ? ': ' + d.note : ''}`);
    }
    const ref = map.ref || {}, hits = [];
    for (const [key, val] of Object.entries(ref)) {
        if (key.startsWith('_')) continue;
        const cells = keyCells(key, def);
        if (cells && cells.some(q => q[0] === c && q[1] === r)) hits.push([key, val, cells.length]);
    }
    hits.sort((a, b) => a[2] - b[2]);
    if (hits.length) {
        out.push('\nСправка мастера:');
        hits.forEach(([key, val, n]) => { const e = entryText(val); out.push(`[${key}${n > 1 ? `, ${n} кл.` : ''}]${e.title ? ' ' + e.title : ''}\n${e.text}`); });
    } else out.push('Справки по этой клетке нет.');
    return out.join('\n');
}

// ---------- Инструменты ----------
const MAP_ARG = { type: 'string', description: 'id или название карты; если не указать — карта, которая сейчас у игроков' };
const TOOLS = [
    { name: 'list_maps', description: 'Список карт кампании: id, название, какая сейчас у игроков, сколько записей в справке мастера.', inputSchema: { type: 'object', properties: {} } },
    { name: 'view_map', description: 'Карта целиком, как её видит мастер (и скрытое от игроков): сетка местности, селения, тропы и реки, пометки, список записей справки. fog: true — ещё и что знают игроки по клеткам.', inputSchema: { type: 'object', properties: { map: MAP_ARG, fog: { type: 'boolean' } } } },
    { name: 'view_cell', description: 'Всё об одной клетке: местность, селение, дороги, пометки и полный текст справки мастера (своей и областей, куда клетка входит).', inputSchema: { type: 'object', properties: { cell: { type: 'string', description: 'клетка, как на сетке: «Ж22», «АВ18»' }, map: MAP_ARG }, required: ['cell'] } },
    { name: 'get_reference', description: 'Справка мастера по клеткам целиком, в исходном виде: объект «клетка или область → запись».', inputSchema: { type: 'object', properties: { map: MAP_ARG } } },
    {
        name: 'set_reference_entries', description: 'Дописать или заменить записи справки мастера. Остальные записи не трогаются. Ключ — клетка («Ж22»), прямоугольник («К10:О14») или несколько клеток через запятую («Е20, Е21»). Значение — текст или {title, text}; в тексте пустая строка — абзац, «- » — пункт списка, **жирный**, *курсив*. Чтобы поправить запись, сначала прочтите её (view_cell или get_reference) и пришлите целиком.',
        inputSchema: { type: 'object', properties: { map: MAP_ARG, entries: { type: 'object', description: '{ "Ж22": { "title": "…", "text": "…" }, "К10:О14": "…" }', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } } }] } } }, required: ['entries'] }
    },
    { name: 'remove_reference_entries', description: 'Убрать записи справки мастера по их ключам (как они записаны в справке).', inputSchema: { type: 'object', properties: { map: MAP_ARG, keys: { type: 'array', items: { type: 'string' } } }, required: ['keys'] } }
];

export function createHandler({ url, anon, fetchImpl = fetch }) {
    async function rpc(fn, args) {
        const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!res.ok) {
            const e = new Error(data && data.message ? data.message : `база ответила ${res.status}`);
            e.code = data && data.code;
            throw e;
        }
        return data;
    }
    async function resolveMap(key, map) {
        if (!map) return null;
        const list = await rpc('map_list', { p_key: key });
        const q = String(map).toLowerCase();
        const hit = list.find(m => m.id === map) || list.find(m => String(m.name).toLowerCase() === q) || list.find(m => String(m.name).toLowerCase().includes(q));
        if (!hit) throw new Error(`нет карты «${map}». Есть: ${list.map(m => `«${m.name}» (${m.id})`).join(', ')}`);
        return hit.id;
    }
    async function call(key, name, a = {}) {
        if (name === 'list_maps') {
            const list = await rpc('map_list', { p_key: key });
            return list.length ? list.map(m => `- «${m.name}» — id ${m.id}${m.is_current ? ', сейчас у игроков' : ''}; записей в справке: ${m.ref_entries}`).join('\n') : 'Карт пока нет.';
        }
        const map = await rpc('map_get', { p_key: key, p_map: await resolveMap(key, a.map) });
        if (name === 'view_map') return mapOverview(map, { fog: !!a.fog });
        if (name === 'view_cell') return cellInfo(map, a.cell);
        if (name === 'get_reference') return map.ref && Object.keys(map.ref).length ? JSON.stringify(map.ref, null, 2) : `Справки по карте «${map.name}» пока нет.`;
        if (name === 'set_reference_entries') {
            const entries = a.entries && typeof a.entries === 'object' && !Array.isArray(a.entries) ? a.entries : null;
            if (!entries || !Object.keys(entries).length) throw new Error('entries — объект вида { "Ж22": "текст" }');
            const bad = Object.keys(entries).filter(k => !k.startsWith('_') && !keyCells(k, map.def));
            if (bad.length) throw new Error(`не понял клетки: ${bad.join(', ')}. Клетка пишется буквой столбца и номером строки (столбцы ${colName(0)}…${colName(map.def.cols - 1)}, строки 1…${map.def.rows}), область — «К10:О14»`);
            const r = await rpc('map_ref_patch', { p_key: key, p_map: map.id, p_set: entries, p_remove: [] });
            return `Готово: записано ${Object.keys(entries).length} (${Object.keys(entries).join(', ')}). Всего в справке карты «${map.name}» — ${r.count}.`;
        }
        if (name === 'remove_reference_entries') {
            const keys = Array.isArray(a.keys) ? a.keys.map(String) : [];
            if (!keys.length) throw new Error('keys — список ключей справки');
            const missing = keys.filter(k => !(map.ref && k in map.ref));
            const r = await rpc('map_ref_patch', { p_key: key, p_map: map.id, p_set: {}, p_remove: keys });
            return `Готово: убрано ${keys.length - missing.length}${missing.length ? `; таких записей не было: ${missing.join(', ')}` : ''}. Осталось в справке — ${r.count}.`;
        }
        throw new Error('нет такого инструмента: ' + name);
    }

    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version, mcp-session-id, authorization', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

    async function one(msg, key) {
        const { id, method, params } = msg || {};
        const isNote = id === undefined || id === null;
        const reply = result => isNote ? null : { jsonrpc: '2.0', id, result };
        const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id, error: { code, message } };
        try {
            if (method === 'initialize') {
                await rpc('map_whoami', { p_key: key });
                return reply({
                    protocolVersion: VERSIONS.includes(params && params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'gempire-map', title: 'Карта кампании', version: '1.0.0' },
                    instructions: 'Карта настольной кампании и справка мастера по клеткам. Начните с list_maps или view_map; подробности о клетке — view_cell. Справку можно дописывать и править (set_reference_entries, remove_reference_entries). Всё это — знание мастера: не пересказывайте его как то, что видят игроки.'
                });
            }
            if (method === 'ping') return reply({});
            if (method === 'tools/list') return reply({ tools: TOOLS });
            if (method === 'tools/call') {
                try {
                    const text = await call(key, params && params.name, (params && params.arguments) || {});
                    return reply({ content: [{ type: 'text', text }] });
                } catch (e) {
                    return reply({ content: [{ type: 'text', text: 'Ошибка: ' + (e.message || e) }], isError: true });
                }
            }
            if (method && method.startsWith('notifications/')) return null;
            return fail(-32601, 'нет такого метода: ' + method);
        } catch (e) {
            return fail(e.code === '28000' ? -32001 : -32603, e.code === '28000' ? 'ключ доступа не подходит' : 'ошибка: ' + (e.message || e));
        }
    }

    return async function handle(req) {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (req.method !== 'POST') return new Response('Коннектор «Карта»: MCP по HTTP, запросы — POST', { status: 405, headers: { Allow: 'POST, OPTIONS', ...cors } });
        const u = new URL(req.url);
        const key = (u.searchParams.get('key') || req.headers.get('x-map-key') || '').trim();
        if (key.length < 16) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'нужен ключ доступа: …/map-mcp?key=КЛЮЧ' } }, 401);
        let msg;
        try { msg = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'это не JSON' } }, 400); }
        const batch = Array.isArray(msg), out = [];
        for (const m of batch ? msg : [msg]) { const r = await one(m, key); if (r) out.push(r); }
        if (!out.length) return new Response(null, { status: 202, headers: cors });
        const bad = out.length === 1 && out[0].error && out[0].error.code === -32001;
        return json(batch ? out : out[0], bad ? 401 : 200);
    };
}

if (typeof Deno !== 'undefined' && Deno.serve) {
    Deno.serve(createHandler({ url: Deno.env.get('SUPABASE_URL'), anon: Deno.env.get('SUPABASE_ANON_KEY') }));
}
