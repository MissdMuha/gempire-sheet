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
