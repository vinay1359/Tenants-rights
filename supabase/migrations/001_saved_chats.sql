-- Run this in the Supabase SQL editor (or via CLI) before using cloud history.
-- Auth: enable Email and/or Google in Dashboard → Authentication → Providers.
-- Redirect URL: https://<your-domain>/auth/callback

create table if not exists public.saved_chats (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists saved_chats_user_updated_idx
  on public.saved_chats (user_id, updated_at desc);

alter table public.saved_chats enable row level security;

create policy "saved_chats_select_own"
  on public.saved_chats for select
  using (auth.uid() = user_id);

create policy "saved_chats_insert_own"
  on public.saved_chats for insert
  with check (auth.uid() = user_id);

create policy "saved_chats_update_own"
  on public.saved_chats for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "saved_chats_delete_own"
  on public.saved_chats for delete
  using (auth.uid() = user_id);
