-- Run this once in Supabase: SQL Editor > New query > Run

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  author text not null default 'Anonymous' check (char_length(author) <= 40),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.letters enable row level security;

-- Anyone can read the wall
create policy "anyone can read" on public.letters
  for select using (true);

-- Anyone can post a letter
create policy "anyone can post" on public.letters
  for insert with check (true);

-- Only a signed-in user (you, the owner) can delete
create policy "owner can delete" on public.letters
  for delete to authenticated using (true);
