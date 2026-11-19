// Замок на страницы мастера: пароль спрашивается один раз на устройстве (в этом браузере),
// чтобы игрок не открыл их случайно. Это не защита от взлома — пароль виден в коде страницы.
// Подключается обычным <script> в <head>, до остального содержимого.
(function () {
    var KEY = 'gempire-gm-unlocked', PASS = '2021';
    try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}

    // пока пароль не введён — всё, кроме окна замка, спрятано
    var hide = document.createElement('style');
    hide.textContent = 'body > *:not(#gm-lock) { visibility: hidden !important; } body { overflow: hidden !important; }';
    document.head.appendChild(hide);
    var wrap = null;

    function unlock() {
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
        if (wrap) wrap.remove();
        hide.remove();
    }
    // открыли в соседней вкладке или во внешней странице (карта во вкладке мастер-пульта) — открываемся и здесь
    window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue === '1') unlock(); });

    function show() {
        wrap = document.createElement('div');
        wrap.id = 'gm-lock';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#2b2620;font-family:Georgia,"Times New Roman",serif;';
        wrap.innerHTML =
            '<form style="width:min(320px,100%);background:#f4eddd;color:#2b2620;border:1px solid #2b2620;box-shadow:0 0 0 4px #f4eddd,0 0 0 5px #2b2620;padding:24px 26px;display:flex;flex-direction:column;gap:12px;">' +
            '<div style="font-size:22px;letter-spacing:.03em">Страница мастера</div>' +
            '<input type="password" inputmode="numeric" autocomplete="off" placeholder="Пароль" aria-label="Пароль" style="font:inherit;font-size:18px;padding:8px 10px;border:1px solid rgba(43,38,32,.35);background:#fbf8f0;color:#2b2620;">' +
            '<button type="submit" style="font:inherit;font-size:16px;padding:8px 12px;border:1px solid #2b2620;background:#2b2620;color:#f4eddd;cursor:pointer;">Войти</button>' +
            '<div class="gm-lock-err" role="alert" style="min-height:1.2em;font-size:14px;font-style:italic;color:#a8432a;"></div>' +
            '</form>';
        document.body.appendChild(wrap);
        var form = wrap.querySelector('form'), input = wrap.querySelector('input'), err = wrap.querySelector('.gm-lock-err');
        input.focus();
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (input.value.trim() === PASS) unlock();
            else { err.textContent = 'Неверный пароль'; input.value = ''; input.focus(); }
        });
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
