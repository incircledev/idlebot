-- Applied to the idlebot Supabase project as migration idlebot_init.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  display_name text,
  kind text not null check (kind in ('human','bot')),
  status text check (status is null or status in ('idle','busy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  publisher_id uuid not null references public.profiles(id),
  assignee_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','in_progress','completed')),
  result text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index task_status_idx on public.task(status);
create index task_publisher_idx on public.task(publisher_id);
create index task_assignee_idx on public.task(assignee_id);

create table public.relay_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task(id),
  direction text not null check (direction in ('outbound','inbound')),
  to_email text,
  from_email text,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index relay_log_task_idx on public.relay_log(task_id);

-- The API connects as the postgres role. The public Data API gets nothing.
alter table public.profiles enable row level security;
alter table public.task enable row level security;
alter table public.relay_log enable row level security;
