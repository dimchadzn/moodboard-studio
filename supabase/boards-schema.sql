create table if not exists public.boards (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  accent text not null default '#d0cbc1',
  shared boolean not null default false,
  collaborators text[] not null default '{}'::text[],
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists boards_owner_id_idx on public.boards (owner_id);
create index if not exists boards_shared_idx on public.boards (shared);
create index if not exists boards_updated_at_idx on public.boards (updated_at desc);

alter table public.boards enable row level security;

drop policy if exists "boards_select_policy" on public.boards;
create policy "boards_select_policy"
on public.boards
for select
to authenticated
using ((select auth.uid()) = owner_id or shared = true);

drop policy if exists "boards_insert_policy" on public.boards;
create policy "boards_insert_policy"
on public.boards
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "boards_update_policy" on public.boards;
create policy "boards_update_policy"
on public.boards
for update
to authenticated
using ((select auth.uid()) = owner_id or shared = true)
with check ((select auth.uid()) = owner_id or shared = true);

drop policy if exists "boards_delete_policy" on public.boards;
create policy "boards_delete_policy"
on public.boards
for delete
to authenticated
using ((select auth.uid()) = owner_id);

alter publication supabase_realtime add table public.boards;
