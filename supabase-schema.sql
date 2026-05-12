create extension if not exists pgcrypto;

create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_code text not null,
  name text not null,
  qty text not null default '1',
  note text not null default '',
  category text not null default 'Other',
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists grocery_items_household_code_idx
  on public.grocery_items (household_code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_grocery_items_updated_at on public.grocery_items;

create trigger trg_grocery_items_updated_at
before update on public.grocery_items
for each row
execute function public.set_updated_at();

alter table public.grocery_items enable row level security;

drop policy if exists "allow read grocery items" on public.grocery_items;
drop policy if exists "allow insert grocery items" on public.grocery_items;
drop policy if exists "allow update grocery items" on public.grocery_items;
drop policy if exists "allow delete grocery items" on public.grocery_items;

create policy "allow read grocery items"
on public.grocery_items
for select
using (true);

create policy "allow insert grocery items"
on public.grocery_items
for insert
with check (true);

create policy "allow update grocery items"
on public.grocery_items
for update
using (true)
with check (true);

create policy "allow delete grocery items"
on public.grocery_items
for delete
using (true);
