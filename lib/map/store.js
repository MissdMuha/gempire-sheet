// Хранилище карт: Supabase (общая база, как у листов персонажей) или локальный демо-режим
// (?demo в адресе — всё хранится в этом браузере, вкладки видят друг друга).
import { createClient } from '../supabase.js';

const SUPABASE_URL = 'https://fzfijdsjgxoympldpwyq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6ZmlqZHNqZ3hveW1wbGRwd3lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDY2NzAsImV4cCI6MjA5NDcyMjY3MH0.iAADzjFKSLEr1DHdQPq3j4Ji6tdh-NZhrTfIsvdxUgA';

const POLL_MS = 5000;          // опрос, когда мгновенной связи нет
const SAFETY_POLL_MS = 30000;  // редкая сверка, даже когда связь есть

export function uid(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Таблиц ещё нет — значит, SQL из supabase/map-setup.sql не выполнен
export function isMissingTable(error) {
    if (!error) return false;
    return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204' ||
        /does not exist|schema cache|Could not find the table/i.test(error.message || '');
}

// Картинка → уменьшенная копия (длинная сторона не больше maxSide), чтобы не грузить огромные файлы
export async function shrinkImage(file, maxSide = 4096, quality = 0.88) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('Не удалось прочитать картинку'));
            im.src = url;
        });
        const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, maxSide / Math.max(w, h));
        if (k === 1 && file.size < 3e6) return { blob: file, w, h, type: file.type || 'image/png' };
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const type = file.type === 'image/png' && file.size < 8e6 ? 'image/png' : 'image/jpeg';
        const blob = await new Promise(res => canvas.toBlob(res, type, quality));
        return { blob, w: canvas.width, h: canvas.height, type };
    } finally {
        URL.revokeObjectURL(url);
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

const MAP_COLS_LIST = 'id,name,is_current,updated_at,created_at';
const MAP_COLS_PLAYER = 'id,name,is_current,updated_at,data';
const MAP_COLS_GM = 'id,name,is_current,updated_at,created_at,data,gm_data';

// ---------------- Supabase ----------------
class SupabaseStore {
    constructor() {
        this.kind = 'supabase';
        this.sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    // Только список (без содержимого карт): его можно часто перезапрашивать
    async listMaps({ gm = false } = {}) {
        let q = this.sb.from('maps').select(MAP_COLS_LIST);
        if (!gm) q = q.eq('is_current', true);
        const { data, error } = await q.order('created_at', { ascending: true });
        return { data: data || [], error };
    }

    async getMap(id, { gm = false } = {}) {
        const { data, error } = await this.sb.from('maps').select(gm ? MAP_COLS_GM : MAP_COLS_PLAYER).eq('id', id).limit(1);
        return { data: data && data[0] || null, error };
    }

    async saveMap(row) {
        const { data, error } = await this.sb.from('maps').upsert({ ...row, updated_at: new Date().toISOString() }).select('updated_at');
        return { error, updated_at: data && data[0] ? data[0].updated_at : null };
    }

    async setCurrent(id) {
        const off = await this.sb.from('maps').update({ is_current: false }).eq('is_current', true).neq('id', id);
        if (off.error) return { error: off.error };
        const { error } = await this.sb.from('maps').update({ is_current: true }).eq('id', id);
        return { error };
    }

    async deleteMap(id) {
        const { error } = await this.sb.from('maps').delete().eq('id', id);
        return { error };
    }

    async listMarks(mapId, { gm = false } = {}) {
        let q = this.sb.from('map_marks').select('*').eq('map_id', mapId).eq('deleted', false);
        if (!gm) q = q.eq('hidden', false);
        const { data, error } = await q.order('created_at', { ascending: true });
        return { data: data || [], error };
    }

    // Новая пометка — целиком; дальше меняем только изменившиеся поля,
    // чтобы правка заметки игроком не перетёрла, например, «скрыто», выставленное мастером
    async saveMark(row) {
        const { error } = await this.sb.from('map_marks').upsert({ ...row, updated_at: new Date().toISOString() });
        return { error };
    }

    async updateMark(id, patch) {
        const { error } = await this.sb.from('map_marks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
        return { error };
    }

    async getMarks(ids, { gm = false } = {}) {
        let q = this.sb.from('map_marks').select('*').in('id', ids);
        if (!gm) q = q.eq('hidden', false);
        const { data, error } = await q;
        return { data: data || [], error };
    }

    async charName(id) {
        const { data } = await this.sb.from('characters').select('char_name').eq('id', id).limit(1);
        return data && data[0] ? data[0].char_name : null;
    }

    async uploadImage(file) {
        const { blob, w, h, type } = await shrinkImage(file);
        const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await this.sb.storage.from('maps').upload(path, blob, { contentType: type, upsert: false });
        if (error) return { error };
        const { data } = this.sb.storage.from('maps').getPublicUrl(path);
        return { url: data.publicUrl, w, h };
    }

    // Мгновенные обновления + опрос раз в 5 секунд, если realtime не поднялся, и сверка раз в 30 секунд.
    // Канал общий для всех страниц карты: через него идут сигналы «смотрите сюда», «карта изменилась»,
    // «эти пометки изменились» и список тех, кто на карте.
    // Изменения строк из базы (postgres_changes) получает только мастер: они приходят целиком, со скрытым.
    // Игроки по сигналу сами перезапрашивают нужные строки — уже без скрытого.
    subscribe({ gm = false, onMaps, onMarks, onBroadcast, onStatus, onPoll, onPresence, me }) {
        let realtimeOk = false, closed = false, meta = me || {}, lastPoll = Date.now(), everPolled = false;
        const status = () => onStatus && onStatus({ realtime: realtimeOk, polling: !realtimeOk && everPolled });
        const tick = setInterval(() => {
            if (closed) return;
            const now = Date.now();
            if (!realtimeOk || now - lastPoll >= SAFETY_POLL_MS) {
                lastPoll = now;
                if (!realtimeOk && !everPolled) { everPolled = true; status(); }
                onPoll && onPoll();
            }
        }, POLL_MS);
        let channel = this.sb.channel('gempire-map', { config: { broadcast: { self: false }, presence: { key: uid('u') } } });
        if (gm) {
            channel = channel
                .on('postgres_changes', { event: '*', schema: 'public', table: 'maps' }, p => onMaps && onMaps(p))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'map_marks' }, p => onMarks && onMarks(p));
        }
        channel
            .on('broadcast', { event: 'map' }, ({ payload }) => onBroadcast && onBroadcast(payload))
            .on('presence', { event: 'sync' }, () => {
                if (!onPresence) return;
                const state = channel.presenceState();
                onPresence(Object.values(state).map(list => list[0]).filter(Boolean));
            })
            .subscribe(st => {
                if (st === 'SUBSCRIBED') {
                    realtimeOk = true;
                    channel.track(meta).catch(() => {});
                    lastPoll = Date.now();
                    onPoll && onPoll(); // подтягиваем пропущенное
                } else {
                    realtimeOk = false;
                    everPolled = true;
                }
                status();
            });
        return {
            send: (payload) => { if (realtimeOk) channel.send({ type: 'broadcast', event: 'map', payload }); },
            track: (m) => { meta = m; if (realtimeOk) channel.track(meta).catch(() => {}); },
            close: () => { closed = true; clearInterval(tick); this.sb.removeChannel(channel); },
            get live() { return realtimeOk; }
        };
    }
}

// ---------------- Демо: всё в этом браузере ----------------
class LocalStore {
    constructor() {
        this.kind = 'local';
        this.bc = 'BroadcastChannel' in window ? new BroadcastChannel('gempire-map-demo') : null;
    }
    read(key) { try { return JSON.parse(localStorage.getItem('gempire-map-demo.' + key) || '[]'); } catch { return []; } }
    write(key, rows) {
        try { localStorage.setItem('gempire-map-demo.' + key, JSON.stringify(rows)); return null; }
        catch (e) { return { message: 'Не хватает места в браузере: ' + e.message }; }
    }
    emit(table, eventType, row) { this.bc && this.bc.postMessage({ table, payload: { eventType, new: row, old: row } }); }

    async listMaps({ gm = false } = {}) {
        let rows = this.read('maps');
        if (!gm) rows = rows.filter(m => m.is_current);
        return { data: rows.map(({ id, name, is_current, updated_at, created_at }) => ({ id, name, is_current, updated_at, created_at })), error: null };
    }
    async getMap(id, { gm = false } = {}) {
        const m = this.read('maps').find(x => x.id === id) || null;
        if (m && !gm) { const { gm_data, ...rest } = m; return { data: rest, error: null }; }
        return { data: m, error: null };
    }
    async saveMap(row) {
        const rows = this.read('maps'), now = new Date().toISOString();
        const i = rows.findIndex(m => m.id === row.id);
        const full = i >= 0 ? { ...rows[i], ...row, updated_at: now } : { is_current: false, created_at: now, ...row, updated_at: now };
        if (i >= 0) rows[i] = full; else rows.push(full);
        const error = this.write('maps', rows);
        if (!error) this.emit('maps', i >= 0 ? 'UPDATE' : 'INSERT', full);
        return { error, updated_at: now };
    }
    async setCurrent(id) {
        const rows = this.read('maps').map(m => ({ ...m, is_current: m.id === id }));
        const error = this.write('maps', rows);
        if (!error) rows.forEach(m => this.emit('maps', 'UPDATE', m));
        return { error };
    }
    async deleteMap(id) {
        const rows = this.read('maps'), old = rows.find(m => m.id === id);
        const error = this.write('maps', rows.filter(m => m.id !== id));
        this.write('marks', this.read('marks').filter(m => m.map_id !== id));
        if (!error && old) this.emit('maps', 'DELETE', old);
        return { error };
    }
    async listMarks(mapId, { gm = false } = {}) {
        return { data: this.read('marks').filter(m => m.map_id === mapId && !m.deleted && (gm || !m.hidden)), error: null };
    }
    async saveMark(row) {
        const rows = this.read('marks'), now = new Date().toISOString();
        const i = rows.findIndex(m => m.id === row.id);
        const full = i >= 0 ? { ...rows[i], ...row, updated_at: now } : { created_at: now, hidden: false, deleted: false, ...row, updated_at: now };
        if (i >= 0) rows[i] = full; else rows.push(full);
        const error = this.write('marks', rows);
        if (!error) this.emit('map_marks', i >= 0 ? 'UPDATE' : 'INSERT', full);
        return { error };
    }
    async updateMark(id, patch) {
        const rows = this.read('marks'), i = rows.findIndex(m => m.id === id);
        if (i < 0) return { error: null };
        rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
        const error = this.write('marks', rows);
        if (!error) this.emit('map_marks', 'UPDATE', rows[i]);
        return { error };
    }
    async getMarks(ids, { gm = false } = {}) {
        const set = new Set(ids);
        return { data: this.read('marks').filter(m => set.has(m.id) && (gm || !m.hidden)), error: null };
    }
    async charName() { return null; }
    async uploadImage(file) {
        const { blob, w, h } = await shrinkImage(file, 2048, 0.82);
        return { url: await blobToDataUrl(blob), w, h };
    }
    subscribe({ gm = false, onMaps, onMarks, onBroadcast, onStatus, onPresence, me }) {
        const myKey = uid('u'), peers = new Map();
        let meta = me || {};
        const report = () => {
            const now = Date.now();
            for (const [k, p] of peers) if (now - p.at > 12000) peers.delete(k);
            onPresence && onPresence([meta, ...[...peers.values()].map(p => p.meta)]);
        };
        const beat = () => { this.bc && this.bc.postMessage({ table: 'presence', key: myKey, meta }); report(); };
        const handler = (e) => {
            const m = e.data;
            // Как и в базе: строки целиком получает только мастер
            if (m.table === 'maps') gm && onMaps && onMaps(m.payload);
            else if (m.table === 'map_marks') gm && onMarks && onMarks(m.payload);
            else if (m.table === 'broadcast') onBroadcast && onBroadcast(m.payload);
            else if (m.table === 'presence') { const known = peers.has(m.key); peers.set(m.key, { meta: m.meta, at: Date.now() }); if (!known) beat(); else report(); }
        };
        this.bc && this.bc.addEventListener('message', handler);
        const timer = setInterval(beat, 5000);
        setTimeout(() => { onStatus && onStatus({ realtime: true, polling: false, local: true }); beat(); }, 0);
        return {
            send: (payload) => this.bc && this.bc.postMessage({ table: 'broadcast', payload }),
            track: (m) => { meta = m; beat(); },
            close: () => { clearInterval(timer); this.bc && this.bc.removeEventListener('message', handler); },
            live: true
        };
    }
}

export function createStore({ demo = false } = {}) {
    return demo ? new LocalStore() : new SupabaseStore();
}
