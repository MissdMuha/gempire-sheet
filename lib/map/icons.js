// Значки инструментов и типы меток (в стиле гравюры: тонкая линия, бумажная заливка)

export const INKS = {
    red: { name: 'Киноварь', hex: '#A8432A' },
    blue: { name: 'Синие чернила', hex: '#3D5A73' },
    green: { name: 'Ярь', hex: '#4F6B3A' },
    sepia: { name: 'Сепия', hex: '#6B4E2E' },
    ink: { name: 'Тушь', hex: '#2B2620' },
    violet: { name: 'Пурпур', hex: '#6A4A72' }
};

// Метки. d — путь внутри кружка радиусом 9.5 (центр в 0,0)
export const MARKER_TYPES = {
    camp: { label: 'Лагерь', d: 'M0 -5L5 4H-5Z', color: '#2B2620' },
    danger: { label: 'Опасность', d: 'M-4 -4L4 4M4 -4L-4 4', color: '#A8432A' },
    cache: { label: 'Тайник', d: 'M0 -4.5L4.5 0L0 4.5L-4.5 0Z', color: '#2B2620', filled: true },
    unknown: { label: 'Загадка', d: 'M-2.6 -2.2C-2.6 -5.6 2.8 -5.6 2.8 -2.2C2.8 0 0 -0.2 0 2.2M0 4.6L0 4.7', color: '#3D5A73' },
    note: { label: 'Заметка', d: 'M-4.5 -2H4.5M-4.5 2H2', color: '#2B2620' },
    goal: { label: 'Цель', d: 'M-3 5.5L-3 -5.5M-3 -5.5L4.5 -3.2L-3 -0.8', color: '#A8432A' },
    person: { label: 'Встреча', d: 'M0 -5.8C1.6 -5.8 2.5 -4.7 2.5 -3.3C2.5 -1.9 1.6 -0.8 0 -0.8C-1.6 -0.8 -2.5 -1.9 -2.5 -3.3C-2.5 -4.7 -1.6 -5.8 0 -5.8ZM-4.6 5.2C-4.6 1.8 -2.6 0.6 0 0.6C2.6 0.6 4.6 1.8 4.6 5.2', color: '#3D5A73' },
    battle: { label: 'Сражение', d: 'M-4.8 -4.8L4.2 4.2M4.8 -4.8L-4.2 4.2M-5 1.8L-1.8 5M5 1.8L1.8 5', color: '#A8432A' },
    treasure: { label: 'Сокровище', d: 'M-4.8 -0.6L-4.8 4.4L4.8 4.4L4.8 -0.6ZM-4.8 -0.6C-4.8 -4.6 4.8 -4.6 4.8 -0.6M-0.9 0.9L0.9 0.9L0.9 2.4L-0.9 2.4Z', color: '#6B4E2E' },
    entrance: { label: 'Вход', d: 'M-4.2 4.8L-4.2 -0.8C-4.2 -6 4.2 -6 4.2 -0.8L4.2 4.8M-5.8 4.8L5.8 4.8M-1.6 4.8L-1.6 1.2C-1.6 -1.4 1.6 -1.4 1.6 1.2L1.6 4.8', color: '#2B2620' }
};

export function markerSvg(type, { r = 9.5, sw = 1.3 } = {}) {
    const m = MARKER_TYPES[type] || MARKER_TYPES.note;
    return `<circle r="${r}" fill="#F7F2E7" stroke="${m.color}" stroke-width="${sw}"/>` +
        `<path d="${m.d}" stroke="${m.color}" fill="${m.filled ? m.color : 'none'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function markerIcon(type, size = 22) {
    return `<svg width="${size}" height="${size}" viewBox="-11 -11 22 22" aria-hidden="true">${markerSvg(type, { r: 9, sw: 1.2 })}</svg>`;
}

// Инструменты: значки 20×20
export const TOOL_ICONS = {
    inspect: 'M3 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M12 12L17 17',
    marker: 'M10 3L17 16H3Z',
    zone: 'M3 3h14v14H3ZM3 10L10 3M3 17L17 3M10 17L17 10',
    draw: 'M3 17L17 3M4 10a6 6 0 1 0 12 0a6 6 0 1 0 -12 0',
    label: 'M4 5h12M10 5v11M7 16h6',
    eraser: 'M4 4L16 16M16 4L4 16',
    terrain: 'M2 16L7.5 6.5L10.5 11.5L13 8L18 16ZM6 10.5L7.5 9.2L9 10.5',
    place: 'M4 16V9L10 4L16 9V16ZM8.2 16V12.2H11.8V16',
    road: 'M3 17C7 13 5 9.5 10 8.5C14.5 7.6 14.5 5 17 3M3.5 13.5L5.5 14.5M8 9.5L9 11.5M13.5 6L14.5 8',
    fog: 'M5.5 14.5H14.5A3 3 0 0 0 14.6 8.5A4.3 4.3 0 0 0 6.4 7.6A3.5 3.5 0 0 0 5.5 14.5ZM3 17.5H17'
};

export function toolIcon(id, size = 20) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><path d="${TOOL_ICONS[id]}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export const DRAW_MODES = {
    line: { label: 'Прямая', d: 'M-7 6L7 -6', hint: 'Протяните от точки до точки. Концы цепляются к центрам и углам клеток.' },
    path: { label: 'Маршрут', d: 'M-8 6L-3 -2L2 3L8 -6', hint: 'Нажимайте по точкам пути. Двойное нажатие или Enter — закончить, Backspace — убрать последнюю точку.' },
    free: { label: 'От руки', d: 'M-8 4C-5 -6 -1 7 2 -1C4 -6 6 -3 8 -5', hint: 'Ведите линию, не отпуская кнопку или палец.' },
    circle: { label: 'Круг', d: 'M-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z', hint: 'Протяните от центра к краю круга — покажется радиус.' },
    poly: { label: 'Область', d: 'M-7 5L-5 -6L6 -4L7 6Z', hint: 'Обведите область по точкам. Закончить — нажать на первую точку, двойное нажатие или Enter.' }
};

export const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8C3.5 4.5 6 3.5 8 3.5S12.5 4.5 14.5 8C12.5 11.5 10 12.5 8 12.5S3.5 11.5 1.5 8ZM6 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M2.5 13.5L13.5 2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
export const EYE_ON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8C3.5 4.5 6 3.5 8 3.5S12.5 4.5 14.5 8C12.5 11.5 10 12.5 8 12.5S3.5 11.5 1.5 8ZM6 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
