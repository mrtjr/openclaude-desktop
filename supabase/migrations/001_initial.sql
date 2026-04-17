-- ───────────────────────────────────────────────────────────────
-- OpenClaude Desktop — Initial Supabase schema
-- ───────────────────────────────────────────────────────────────
--
-- Single generic table: `sync_items` keyed by (user_id, kind).
-- Payload is JSONB — plain data for non-secret kinds, an EncryptedBlob
-- for encrypted kinds ("apiKeys", "canary"). The server never sees
-- plaintext for encrypted kinds (zero-knowledge).
--
-- Row-Level Security ensures users can only read/write their own rows.
-- Auth is handled by Supabase Auth (email + Google OAuth via PKCE).

create table if not exists public.sync_items (
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,
  payload      jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Constrain `kind` to the known categories. Add new ones via migration.
alter table public.sync_items
  drop constraint if exists sync_items_kind_check;
alter table public.sync_items
  add constraint sync_items_kind_check
  check (kind in ('settings','profiles','personas','scheduledTasks','apiKeys','canary'));

create index if not exists sync_items_user_updated_idx
  on public.sync_items (user_id, updated_at desc);

-- ─── Row-Level Security ─────────────────────────────────────────
alter table public.sync_items enable row level security;

drop policy if exists "sync_items_select_own" on public.sync_items;
create policy "sync_items_select_own" on public.sync_items
  for select using (auth.uid() = user_id);

drop policy if exists "sync_items_insert_own" on public.sync_items;
create policy "sync_items_insert_own" on public.sync_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "sync_items_update_own" on public.sync_items;
create policy "sync_items_update_own" on public.sync_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sync_items_delete_own" on public.sync_items;
create policy "sync_items_delete_own" on public.sync_items
  for delete using (auth.uid() = user_id);

-- ─── updated_at auto-maintenance ────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists sync_items_touch on public.sync_items;
create trigger sync_items_touch
  before update on public.sync_items
  for each row execute function public.touch_updated_at();
