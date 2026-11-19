-- Карта похода: таблицы, доступ и хранилище картинок.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Скрипт можно запускать повторно — он ничего не сломает и не сотрёт.

-- 1. Карты. data — то, что видят игроки (без скрытого мастером),
--    gm_data — полная версия для мастера (рельеф под туманом, тайные поселения и т. п.)
create table if not exists public.maps (
    id          text primary key,
    name        text not null default 'Карта',
    is_current  boolean not null default false,
    data        jsonb not null default '{}'::jsonb,
    gm_data     jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- 2. Пометки на картах: метки, подписи, зоны, линии и круги.
--    hidden — видит только мастер; deleted — удалено (храним, чтобы работала отмена).
create table if not exists public.map_marks (
    id          text primary key,
    map_id      text not null references public.maps(id) on delete cascade,
    kind        text not null,
    hidden      boolean not null default false,
    deleted     boolean not null default false,
    author      text,
    data        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists map_marks_map_id_idx on public.map_marks (map_id);

-- 3. Доступ: как и у листов персонажей, читать и писать может любой, у кого есть ссылка
alter table public.maps enable row level security;
alter table public.map_marks enable row level security;

drop policy if exists "maps: open access" on public.maps;
create policy "maps: open access" on public.maps
    for all to anon, authenticated using (true) with check (true);

drop policy if exists "map_marks: open access" on public.map_marks;
create policy "map_marks: open access" on public.map_marks
    for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.maps, public.map_marks to anon, authenticated;

-- 4. Мгновенные обновления (realtime): пометки других игроков появляются сразу
do $$
begin
    begin
        alter publication supabase_realtime add table public.maps;
    exception when duplicate_object then null;
    end;
    begin
        alter publication supabase_realtime add table public.map_marks;
    exception when duplicate_object then null;
    end;
end $$;

-- 5. Хранилище картинок-подложек для карт (публичная папка maps)
insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do update set public = true;

drop policy if exists "maps bucket: read" on storage.objects;
create policy "maps bucket: read" on storage.objects
    for select to anon, authenticated using (bucket_id = 'maps');

drop policy if exists "maps bucket: upload" on storage.objects;
create policy "maps bucket: upload" on storage.objects
    for insert to anon, authenticated with check (bucket_id = 'maps');

-- 6. Справка мастера по клеткам и доступ по ключу — для страницы мастера и для Claude.
--    Таблицы закрыты: напрямую их не читает и не пишет никто (ни игроки, ни боты с публичным ключом сайта).
--    Работать с ними можно только через функции ниже, и только с ключом доступа.
--    Ключей два: «мастер» (страница мастера) и «claude» (ИИ-помощник); ключ Claude мастер может сменить со своей страницы.
create table if not exists public.map_refs (
    map_id      text primary key references public.maps(id) on delete cascade,
    src         jsonb not null default '{}'::jsonb,   -- { "Ж22": "текст" | { "title": …, "text": … }, "К10:О14": … }
    file        text,
    updated_at  timestamptz not null default now(),
    updated_by  text
);
create table if not exists public.map_keys (
    name        text primary key,
    key         text not null unique,
    created_at  timestamptz not null default now()
);
alter table public.map_refs enable row level security;
alter table public.map_keys enable row level security;
revoke all on public.map_refs, public.map_keys from anon, authenticated;

-- Кто пришёл с этим ключом; чужой ключ — ошибка «нет доступа»
create or replace function public.map_auth(p_key text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text;
begin
    select name into n from public.map_keys where key = p_key and length(p_key) >= 16;
    if n is null then
        perform pg_sleep(0.4);  -- подбор ключа ботом — медленно
        raise exception 'ключ доступа не подходит' using errcode = '28000';
    end if;
    return n;
end $$;

create or replace function public.map_whoami(p_key text) returns text
language sql stable security definer set search_path = public as $$ select public.map_auth(p_key) $$;

-- Список карт
create or replace function public.map_list(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    perform public.map_auth(p_key);
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', m.id, 'name', m.name, 'is_current', m.is_current, 'updated_at', m.updated_at,
            'ref_entries', (select count(*) from jsonb_object_keys(coalesce(r.src, '{}'::jsonb)))
        ) order by m.is_current desc, m.updated_at desc)
        from public.maps m left join public.map_refs r on r.map_id = m.id), '[]'::jsonb);
end $$;

-- Карта целиком, как её видит мастер: рельеф, селения, дороги, пометки (и скрытые) и справка.
-- p_map — id карты; пусто — та, что сейчас у игроков
create or replace function public.map_get(p_key text, p_map text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.maps;
begin
    perform public.map_auth(p_key);
    if p_map is null or p_map = '' then
        select * into m from public.maps order by is_current desc, updated_at desc limit 1;
    else
        select * into m from public.maps where id = p_map;
    end if;
    if m.id is null then raise exception 'нет такой карты' using errcode = 'P0002'; end if;
    return jsonb_build_object(
        'id', m.id, 'name', m.name, 'is_current', m.is_current, 'updated_at', m.updated_at,
        'def', coalesce(m.gm_data, m.data),
        'marks', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'hidden', k.hidden, 'author', k.author, 'data', k.data) order by k.created_at)
                           from public.map_marks k where k.map_id = m.id and not k.deleted), '[]'::jsonb),
        'ref', (select r.src from public.map_refs r where r.map_id = m.id));
end $$;

-- Справка карты
create or replace function public.map_ref_get(p_key text, p_map text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.map_refs;
begin
    perform public.map_auth(p_key);
    select * into r from public.map_refs where map_id = p_map;
    if r.map_id is null then return null; end if;
    return jsonb_build_object('src', r.src, 'file', r.file, 'updated_at', r.updated_at, 'updated_by', r.updated_by);
end $$;

-- Заменить справку целиком (p_src = null — убрать справку с карты)
create or replace function public.map_ref_put(p_key text, p_map text, p_src jsonb, p_file text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text := public.map_auth(p_key); r public.map_refs;
begin
    if not exists (select 1 from public.maps where id = p_map) then raise exception 'нет такой карты' using errcode = 'P0002'; end if;
    if p_src is null then
        delete from public.map_refs where map_id = p_map;
        return null;
    end if;
    if jsonb_typeof(p_src) <> 'object' then raise exception 'справка — объект вида { "Ж22": "текст" }' using errcode = '22023'; end if;
    if pg_column_size(p_src) > 4000000 then raise exception 'справка слишком большая (больше 4 МБ)' using errcode = '54000'; end if;
    insert into public.map_refs (map_id, src, file, updated_at, updated_by) values (p_map, p_src, p_file, now(), who)
    on conflict (map_id) do update set src = excluded.src, file = excluded.file, updated_at = now(), updated_by = who
    returning * into r;
    return jsonb_build_object('updated_at', r.updated_at, 'updated_by', r.updated_by,
                              'count', (select count(*) from jsonb_object_keys(r.src)));
end $$;

-- Дописать и поправить отдельные записи: p_set — какие записи поставить (заменяются целиком), p_remove — какие ключи убрать
create or replace function public.map_ref_patch(p_key text, p_map text, p_set jsonb default '{}'::jsonb, p_remove text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text := public.map_auth(p_key); r public.map_refs;
begin
    if not exists (select 1 from public.maps where id = p_map) then raise exception 'нет такой карты' using errcode = 'P0002'; end if;
    if p_set is not null and jsonb_typeof(p_set) <> 'object' then raise exception 'p_set — объект вида { "Ж22": "текст" }' using errcode = '22023'; end if;
    insert into public.map_refs (map_id, src, updated_at, updated_by) values (p_map, coalesce(p_set, '{}'::jsonb), now(), who)
    on conflict (map_id) do update
        set src = (public.map_refs.src - coalesce(p_remove, '{}'::text[])) || coalesce(p_set, '{}'::jsonb), updated_at = now(), updated_by = who
    returning * into r;
    if pg_column_size(r.src) > 4000000 then raise exception 'справка слишком большая (больше 4 МБ)' using errcode = '54000'; end if;
    return jsonb_build_object('updated_at', r.updated_at, 'updated_by', r.updated_by,
                              'count', (select count(*) from jsonb_object_keys(r.src)));
end $$;

-- Ключ Claude: мастер видит его и может сменить (старый перестанет работать)
create or replace function public.map_key_claude(p_key text, p_rotate boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text, '-', '');
begin
    if public.map_auth(p_key) <> 'мастер' then raise exception 'только для ключа мастера' using errcode = '42501'; end if;
    if p_rotate then
        insert into public.map_keys (name, key) values ('claude', k) on conflict (name) do update set key = excluded.key, created_at = now();
    else
        insert into public.map_keys (name, key) values ('claude', k) on conflict (name) do nothing;
    end if;
    return (select key from public.map_keys where name = 'claude');
end $$;

-- Новый ключ для любого имени — только из SQL Editor (например: select public.map_key_new('мастер');)
create or replace function public.map_key_new(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text, '-', '');
begin
    insert into public.map_keys (name, key) values (p_name, k) on conflict (name) do update set key = excluded.key, created_at = now();
    return k;
end $$;

-- Клетка по названию с сетки карты: «Ж22» → c, r (с нуля). Латинские буквы-двойники (A, B, E, K, M, H, O, P, C, T, X, Y) тоже понимаются
create or replace function public.map_cell(p_name text, out c int, out r int)
language plpgsql immutable set search_path = public as $$
declare
    letters constant text := 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭ';
    s text := translate(upper(replace(coalesce(p_name, ''), ' ', '')), 'ABCEHKMOPTXYЁ', 'АВСЕНКМОРТХУЕ');
    m text[]; a int; b int;
begin
    m := regexp_match(s, '^([А-Я]{1,2})([0-9]{1,3})$');
    if m is null then raise exception 'не понял клетку «%»', p_name using errcode = '22023'; end if;
    a := strpos(letters, substr(m[1], 1, 1));
    if length(m[1]) = 1 then c := a - 1;
    else b := strpos(letters, substr(m[1], 2, 1)); c := case when a > 0 and b > 0 then a * 25 + b - 1 else -1 end;
    end if;
    if c < 0 then raise exception 'не понял клетку «%»', p_name using errcode = '22023'; end if;
    r := m[2]::int - 1;
end $$;

-- Пометка мастера от Claude (или по ключу мастера): поставить новую или поправить свою.
-- Пометки игроков так не меняются. Новая пометка всегда скрыта от игроков; показать её игрокам может только мастер на своей странице.
-- p_mark: { id?, kind: marker|label|zone|shape, cell: "Ж22" (или x, y), type, name, note, text, size: s|m|l,
--           cells: ["Ж22", "К10:О14"] (зона), shape: line|path|poly|circle, points: ["Ж22", "Е20"], radius (в клетках), ink }
create or replace function public.map_mark_set(p_key text, p_map text, p_mark jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    who text := public.map_auth(p_key);
    v_def jsonb; v_cols int; v_rows int;
    v_id text := p_mark->>'id'; v_kind text; v_data jsonb; v_old public.map_marks; v_new boolean := false;
    v_cell record; v_cells jsonb := '[]'::jsonb; v_pts jsonb := '[]'::jsonb; v_e text; v_a record; v_b record; i int; j int;
    f text;
begin
    if p_mark is null or jsonb_typeof(p_mark) <> 'object' then raise exception 'p_mark — объект с полями пометки' using errcode = '22023'; end if;
    select coalesce(gm_data, data) into v_def from public.maps where id = p_map;
    if v_def is null then raise exception 'нет такой карты' using errcode = 'P0002'; end if;
    v_cols := coalesce((v_def->>'cols')::int, 0); v_rows := coalesce((v_def->>'rows')::int, 0);
    if v_id is not null and v_id <> '' then
        select * into v_old from public.map_marks where id = v_id and map_id = p_map and not deleted;
        if v_old.id is null then raise exception 'нет такой пометки: %', v_id using errcode = 'P0002'; end if;
        if not coalesce((v_old.data->>'gm')::boolean, false) then
            raise exception 'это пометка игроков — менять можно только пометки мастера' using errcode = '42501';
        end if;
        v_kind := v_old.kind; v_data := v_old.data;
    else
        v_new := true; v_id := 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
        v_kind := coalesce(p_mark->>'kind', 'marker'); v_data := '{}'::jsonb;
    end if;
    if v_kind not in ('marker', 'label', 'zone', 'shape') then raise exception 'kind — marker, label, zone или shape' using errcode = '22023'; end if;
    -- текстовые поля: пришло — ставим (null — стереть)
    foreach f in array array['name', 'note', 'text'] loop
        if p_mark ? f then v_data := case when p_mark->f = 'null'::jsonb then v_data - f else v_data || jsonb_build_object(f, p_mark->>f) end; end if;
    end loop;
    -- место: клетка (в её середину) или точные x, y в точках карты
    if p_mark ? 'cell' then
        select * into v_cell from public.map_cell(p_mark->>'cell');
        if v_cell.c >= v_cols or v_cell.r >= v_rows then raise exception 'клетка «%» за краем карты', p_mark->>'cell' using errcode = '22023'; end if;
        v_data := v_data || jsonb_build_object('x', 40 + (v_cell.c + 0.5) * 28, 'y', 40 + (v_cell.r + 0.5) * 28);
    elsif p_mark ? 'x' and p_mark ? 'y' then
        v_data := v_data || jsonb_build_object('x', (p_mark->>'x')::numeric, 'y', (p_mark->>'y')::numeric);
    end if;
    if v_kind = 'marker' then
        if p_mark ? 'type' or v_new then
            v_data := v_data || jsonb_build_object('type', case when p_mark->>'type' in ('camp', 'danger', 'cache', 'unknown', 'note', 'goal', 'person', 'battle', 'treasure', 'entrance') then p_mark->>'type' else 'note' end);
        end if;
    elsif v_kind = 'label' then
        if p_mark ? 'size' or v_new then v_data := v_data || jsonb_build_object('size', case when p_mark->>'size' in ('s', 'm', 'l') then p_mark->>'size' else 'm' end); end if;
        if v_new and coalesce(v_data->>'text', '') = '' then v_data := v_data || jsonb_build_object('text', coalesce(p_mark->>'name', '…')); end if;
    elsif v_kind = 'zone' then
        if p_mark ? 'cells' then
            for v_e in select value from jsonb_array_elements_text(case when jsonb_typeof(p_mark->'cells') = 'array' then p_mark->'cells' else to_jsonb(string_to_array(p_mark->>'cells', ',')) end) loop
                if position(':' in v_e) > 0 then
                    select * into v_a from public.map_cell(split_part(v_e, ':', 1));
                    select * into v_b from public.map_cell(split_part(v_e, ':', 2));
                    for j in least(v_a.r, v_b.r)..greatest(v_a.r, v_b.r) loop
                        for i in least(v_a.c, v_b.c)..greatest(v_a.c, v_b.c) loop v_cells := v_cells || to_jsonb(i || ',' || j); end loop;
                    end loop;
                else
                    select * into v_a from public.map_cell(v_e);
                    v_cells := v_cells || to_jsonb(v_a.c || ',' || v_a.r);
                end if;
            end loop;
            v_data := v_data || jsonb_build_object('cells', (select coalesce(jsonb_agg(distinct x.v), '[]'::jsonb) from jsonb_array_elements(v_cells) as x(v)));
        end if;
    elsif v_kind = 'shape' then
        if p_mark ? 'shape' or v_new then
            v_data := v_data || jsonb_build_object('shape', case when p_mark->>'shape' in ('line', 'path', 'free', 'poly', 'circle') then p_mark->>'shape' else 'path' end);
        end if;
        if p_mark ? 'points' then
            for v_e in select value from jsonb_array_elements_text(p_mark->'points') loop
                select * into v_a from public.map_cell(v_e);
                v_pts := v_pts || jsonb_build_array(jsonb_build_array(40 + (v_a.c + 0.5) * 28, 40 + (v_a.r + 0.5) * 28));
            end loop;
            if v_data->>'shape' = 'circle' then
                v_pts := jsonb_build_array(v_pts->0, jsonb_build_array((v_pts->0->>0)::numeric + coalesce((p_mark->>'radius')::numeric, 1) * 28, (v_pts->0->>1)::numeric));
            end if;
            v_data := v_data || jsonb_build_object('pts', v_pts);
        elsif p_mark ? 'pts' then
            v_data := v_data || jsonb_build_object('pts', p_mark->'pts');
        end if;
    end if;
    if p_mark ? 'ink' or (v_new and v_kind in ('zone', 'shape')) then
        v_data := v_data || jsonb_build_object('ink', case when p_mark->>'ink' in ('red', 'blue', 'green', 'sepia', 'ink', 'violet') then p_mark->>'ink' else 'red' end);
    end if;
    -- проверка: у пометки должно быть место
    if v_kind in ('marker', 'label') and not (v_data ? 'x' and v_data ? 'y') then raise exception 'нужно место: cell (например «Ж22») или x, y' using errcode = '22023'; end if;
    if v_kind = 'zone' and jsonb_array_length(coalesce(v_data->'cells', '[]'::jsonb)) = 0 then raise exception 'у зоны нужны клетки: cells' using errcode = '22023'; end if;
    if v_kind = 'shape' and jsonb_array_length(coalesce(v_data->'pts', '[]'::jsonb)) < 2 then
        raise exception 'у линии нужны points — хотя бы две клетки (у круга — центр и radius)' using errcode = '22023';
    end if;
    v_data := v_data || jsonb_build_object('gm', true);
    if v_new then
        v_data := v_data || jsonb_build_object('t', (extract(epoch from clock_timestamp()) * 1000)::bigint);
        insert into public.map_marks (id, map_id, kind, hidden, deleted, author, data, created_at, updated_at)
        values (v_id, p_map, v_kind, true, false, case when who = 'claude' then 'Claude' else 'Мастер' end, v_data, now(), now());
    else
        update public.map_marks set data = v_data, updated_at = now() where id = v_id;
    end if;
    return (select jsonb_build_object('id', k.id, 'kind', k.kind, 'hidden', k.hidden, 'author', k.author, 'data', k.data) from public.map_marks k where k.id = v_id);
end $$;

-- Убрать пометку мастера (как ластик: помечается удалённой). Пометки игроков так не убираются
create or replace function public.map_mark_delete(p_key text, p_map text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_old public.map_marks;
begin
    perform public.map_auth(p_key);
    select * into v_old from public.map_marks where id = p_id and map_id = p_map and not deleted;
    if v_old.id is null then raise exception 'нет такой пометки: %', p_id using errcode = 'P0002'; end if;
    if not coalesce((v_old.data->>'gm')::boolean, false) then
        raise exception 'это пометка игроков — убирать можно только пометки мастера' using errcode = '42501';
    end if;
    update public.map_marks set deleted = true, updated_at = now() where id = p_id;
    return true;
end $$;

-- Кому что можно: функции с ключом — всем (без ключа они не пустят), служебные — никому, кроме владельца базы
revoke all on function public.map_auth(text), public.map_whoami(text), public.map_list(text), public.map_get(text, text),
    public.map_ref_get(text, text), public.map_ref_put(text, text, jsonb, text), public.map_ref_patch(text, text, jsonb, text[]),
    public.map_key_claude(text, boolean), public.map_key_new(text),
    public.map_mark_set(text, text, jsonb), public.map_mark_delete(text, text, text) from public, anon, authenticated;
grant execute on function public.map_whoami(text), public.map_list(text), public.map_get(text, text),
    public.map_ref_get(text, text), public.map_ref_put(text, text, jsonb, text), public.map_ref_patch(text, text, jsonb, text[]),
    public.map_key_claude(text, boolean), public.map_mark_set(text, text, jsonb), public.map_mark_delete(text, text, text) to anon, authenticated;

-- Ключи создаются один раз; ниже, в результатах, — ваши ключи. Ключ мастера вставьте на странице мастера
-- (вкладка «Карта» → «Справка по клеткам»). Забыли — просто запустите этот скрипт ещё раз, он их покажет.
insert into public.map_keys (name, key) values ('мастер', replace(gen_random_uuid()::text, '-', '')) on conflict (name) do nothing;
insert into public.map_keys (name, key) values ('claude', replace(gen_random_uuid()::text, '-', '')) on conflict (name) do nothing;
notify pgrst, 'reload schema';
select name as "чей ключ", key as "ключ доступа" from public.map_keys order by name desc;
