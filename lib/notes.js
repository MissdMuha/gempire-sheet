// Редактор заметок: жирный, курсив и заголовки.
// Заметки хранятся в поле notes как простой HTML (только теги из ALLOWED_TAGS).

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'H3', 'DIV', 'P', 'BR']);
const SAVE_DELAY_MS = 1500;

// Оставляет только разрешённые теги без атрибутов: вставки из браузера и Word
// не притащат чужие стили, а заметки останутся аккуратными
export function cleanNotesHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    const walk = (node) => {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                walk(child);
                if (ALLOWED_TAGS.has(child.tagName)) {
                    for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
                } else {
                    child.replaceWith(...child.childNodes);
                }
            } else if (child.nodeType !== Node.TEXT_NODE) {
                child.remove();
            }
        }
    };
    walk(tpl.content);
    const html_ = tpl.innerHTML;
    return html_ === '<br>' ? '' : html_;
}

// Обычный текст без тегов (например, вписанный вручную в базу) — переносы строк сохраняем
function toHtml(value) {
    const text = value == null ? '' : String(value);
    if (/<[a-z\/]/i.test(text)) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

// editor  — элемент с contenteditable
// toolbar — панель с кнопками [data-cmd="bold" | "italic" | "heading"]
// floating — true: панель всплывает над выделенным текстом (ПК); false: панель стоит на месте (телефон)
// onSave(html) — сохранить заметки в базу
export function setupNotesEditor({ editor, toolbar, floating = false, onSave }) {
    document.execCommand('defaultParagraphSeparator', false, 'div');
    document.execCommand('styleWithCSS', false, false);

    let saveTimer = null;
    let lastSaved = '';

    const selectionInEditor = () => {
        const sel = window.getSelection();
        return sel.rangeCount > 0 && editor.contains(sel.anchorNode) && editor.contains(sel.focusNode);
    };

    const isInHeading = () => {
        let node = window.getSelection().anchorNode;
        while (node && node !== editor) {
            if (node.nodeName === 'H3') return true;
            node = node.parentNode;
        }
        return false;
    };

    const flush = () => {
        clearTimeout(saveTimer);
        saveTimer = null;
        const html = cleanNotesHtml(editor.innerHTML);
        if (html !== lastSaved) {
            lastSaved = html;
            onSave(html);
        }
    };

    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, SAVE_DELAY_MS);
    };

    const placeFloating = () => {
        const sel = window.getSelection();
        if (!selectionInEditor() || sel.isCollapsed) {
            toolbar.classList.remove('visible');
            return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        toolbar.classList.add('visible');
        const tb = toolbar.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        let left = rect.left + rect.width / 2 - tb.width / 2;
        left = Math.max(8, Math.min(left, viewportWidth - tb.width - 8));
        // Над выделением, а если сверху нет места — под ним
        let top = rect.top - tb.height - 8;
        if (top < 8) top = rect.bottom + 8;
        toolbar.style.left = (left + window.scrollX) + 'px';
        toolbar.style.top = (top + window.scrollY) + 'px';
    };

    const refresh = () => {
        const inside = selectionInEditor();
        const states = {
            bold: inside && document.queryCommandState('bold'),
            italic: inside && document.queryCommandState('italic'),
            heading: inside && isInHeading()
        };
        toolbar.querySelectorAll('[data-cmd]').forEach(btn => btn.classList.toggle('active', !!states[btn.dataset.cmd]));
        if (floating) placeFloating();
    };

    const run = (cmd) => {
        if (!selectionInEditor()) return;
        if (cmd === 'heading') {
            document.execCommand('formatBlock', false, isInHeading() ? 'div' : 'h3');
        } else {
            document.execCommand(cmd);
        }
        refresh();
        scheduleSave();
    };

    // pointerdown + preventDefault: нажатие на кнопку не снимает выделение в заметках
    toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            run(btn.dataset.cmd);
        });
        btn.addEventListener('mousedown', (e) => e.preventDefault());
    });

    // Вставляем только текст, без чужого оформления
    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    });

    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('blur', flush);
    document.addEventListener('selectionchange', refresh);
    if (floating) window.addEventListener('resize', refresh);

    return {
        // Показать заметки из базы. Пока игрок пишет, его текст не перетираем
        setHtml(value) {
            if (document.activeElement === editor) return;
            const html = cleanNotesHtml(toHtml(value));
            lastSaved = html;
            if (editor.innerHTML !== html) editor.innerHTML = html;
        }
    };
}
