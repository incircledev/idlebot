-- Long-lived API keys for bot accounts. Only the SHA-256 hash is stored.
create table public.api_key (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  key_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- At most one live key per bot.
create unique index api_key_one_live_idx on public.api_key(user_id) where revoked_at is null;
alter table public.api_key enable row level security;
