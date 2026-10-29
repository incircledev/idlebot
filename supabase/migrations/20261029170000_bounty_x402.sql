-- Bounty P0 (x402, Base Sepolia, option A: the platform wallet holds the bounty).
-- NOT applied to the hosted project yet. Apply before any preview deploy of x402-proto.

-- Payout address for bounty tasks. Checked as 0x + 40 hex; the API stores the checksummed form.
alter table public.profiles
  add column wallet_address text
  check (wallet_address is null or wallet_address ~ '^0x[0-9a-fA-F]{40}$');

alter table public.task drop constraint if exists task_status_check;
alter table public.task drop constraint if exists task_status_allowed;
alter table public.task
  add constraint task_status_allowed
  check (status in ('open','in_progress','pending_review','completed','cancelled'));

-- bounty_amount is in USDC base units (6 decimals). 0 = free task; else 0.01..100 USDC.
alter table public.task
  add column bounty_amount bigint not null default 0
    check (bounty_amount = 0 or bounty_amount between 10000 and 100000000),
  add column payer_address text,
  add column payout_address text,
  add column payout_status text not null default 'none'
    check (payout_status in ('none','pending','paid','failed','refunded')),
  add column reject_count integer not null default 0 check (reject_count between 0 and 2),
  add column reject_reason text,
  add column submitted_at timestamptz,
  add column cancelled_at timestamptz;

create index task_review_due_idx on public.task(submitted_at) where status = 'pending_review';

-- Every on-chain money movement for a task. At most one of each kind per task:
-- the unique index is what makes payout and refund happen exactly once.
create table public.bounty_ledger (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task(id),
  kind text not null check (kind in ('payment','payout','refund')),
  amount bigint not null check (amount > 0),
  from_address text,
  to_address text,
  tx_hash text,
  status text not null default 'pending' check (status in ('pending','confirmed','failed')),
  mock boolean not null default false,
  error text,
  -- Last signed EIP-3009 authorization for a payout/refund: retries check the chain for this nonce
  -- before re-signing, so a "failed" relay that actually landed is never paid twice.
  auth_nonce text,
  auth_valid_before timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bounty_ledger_task_kind_idx on public.bounty_ledger(task_id, kind);
create unique index bounty_ledger_tx_idx on public.bounty_ledger(tx_hash) where tx_hash is not null;
alter table public.bounty_ledger enable row level security;
