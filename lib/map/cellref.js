// Справка мастера по клеткам: текст к любой клетке или области, загружается из JSON-файла.
// Хранится только в браузере мастера (localStorage) — ни в базу, ни игрокам не уходит.
//
// Формат файла (ключи — клетки как на сетке карты):
// {
//   "Ж22": "Брод у Кобыльего Лога…",
//   "АВ18": { "title": "Корабль", "text": "Первый абзац.\n\nВторой абзац." },
//   "К10:О14": { "title": "Плато Рыгны", "text": "…" },     ← прямоугольник клеток (через : или тире)
//   "Е20, Е21": "…"                                           ← несколько клеток через запятую
// }
// Можно обернуть в { "cells": { … } }. Текст: пустая строка — новый абзац, «- » в начале строки — список,
// **жирный**, *курсив*. Вместо строки можно дать массив строк — это абзацы.
import { colName, coordName } from './terrain.js';

const LATIN = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };

// Номер столбца по его букве(ам) с сетки; -1, если такого нет
export function colIndex(name, cols = 60) {
    const n = name.toUpperCase().replace(/Ё/g, 'Е').replace(/[A-Z]/g, ch => LATIN[ch] || ch);
    for (let i = 0; i < Math.max(cols, 26); i++) if (colName(i) === n) return i;
    return -1;
}
// «Ж22» → [c, r] (с нуля) или null
export function parseCell(s, def) {
    const m = String(s).trim().match(/^([A-Za-zА-Яа-яЁё]{1,2})\s*(\d{1,3})$/);
    if (!m) return null;
    const c = colIndex(m[1], def.cols), r = Number(m[2]) - 1;
    if (c < 0 || c >= def.cols || r < 0 || r >= def.rows) return null;
    return [c, r];
}
// Ключ записи → список клеток: «Ж22», «К10:О14», «К10–О14», «Е20, Е21»
export function parseKeyCells(key, def) {
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

// Разбор файла. Возвращает { entries: [{ key, title, text, cells: ['c,r', …] }], skipped: [ключи, которые не поняли] }
export function parseRef(json, def) {
    const src = json && typeof json === 'object' && !Array.isArray(json) && json.cells && typeof json.cells === 'object' ? json.cells : json;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('ожидался объект вида { "Ж22": "текст" }');
    const entries = [], skipped = [];
    for (const [key, val] of Object.entries(src)) {
        if (key.startsWith('_') || key === 'map' || key === 'title') continue; // служебные поля
        const cells = parseKeyCells(key, def);
        let title = '', text = '';
        if (typeof val === 'string') text = val;
        else if (Array.isArray(val)) text = val.map(String).join('\n\n');
        else if (val && typeof val === 'object') {
            title = String(val.title || val.name || '');
            text = Array.isArray(val.text) ? val.text.map(String).join('\n\n') : String(val.text ?? val.note ?? '');
        }
        if (!cells || (!title && !text.trim())) { skipped.push(key); continue; }
        entries.push({ key: key.trim(), title, text, cells: cells.map(([c, r]) => c + ',' + r) });
    }
    return { entries, skipped };
}

// Записи для клетки: сначала про саму клетку, потом области (меньшие — раньше)
export function refAt(ref, c, r) {
    if (!ref) return [];
    const k = c + ',' + r;
    return ref.entries.filter(e => e.cells.includes(k)).sort((a, b) => a.cells.length - b.cells.length);
}
export function refCells(ref) {
    const set = new Set();
    if (ref) ref.entries.forEach(e => e.cells.forEach(k => set.add(k)));
    return set;
}

// Текст справки → безопасный HTML: абзацы, списки, **жирный**, *курсив*
const escHtml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const inline = s => escHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
export function refHtml(text) {
    const out = [];
    for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
        const lines = block.split('\n').filter(l => l.trim());
        if (!lines.length) continue;
        if (lines.every(l => /^\s*[-•—]\s+/.test(l))) out.push('<ul>' + lines.map(l => '<li>' + inline(l.replace(/^\s*[-•—]\s+/, '')) + '</li>').join('') + '</ul>');
        else out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
    }
    return out.join('');
}

// Заготовка файла по тому, что уже есть на карте: заметки селений и пометок мастера — по их клеткам
export function refTemplate(def, marks, cellOfPt) {
    const cells = {};
    const add = (c, r, title, text) => {
        const k = coordName(c, r);
        if (cells[k]) cells[k].text += `\n\n**${title}.** ${text}`;
        else cells[k] = { title, text };
    };
    (def.places || []).forEach(p => add(p.c, p.r, p.name || 'Селение', p.note || ''));
    marks.filter(m => m.kind === 'marker' && !m.deleted).forEach(m => {
        const cr = cellOfPt([m.data.x, m.data.y]);
        if (cr) add(cr[0], cr[1], m.data.name || 'Метка', m.data.note || '');
    });
    return {
        _как_заполнять: 'Ключ — клетка, как на сетке карты (Ж22), или область: «К10:О14» — прямоугольник, «Е20, Е21» — несколько клеток. Значение — текст или { "title": "…", "text": "…" }. Пустая строка в тексте — новый абзац, «- » в начале строки — пункт списка, **жирный**, *курсив*. Ключи, начинающиеся с «_», не читаются.',
        ...Object.fromEntries(Object.entries(cells).sort(([a], [b]) => a.localeCompare(b, 'ru', { numeric: true })))
    };
}
