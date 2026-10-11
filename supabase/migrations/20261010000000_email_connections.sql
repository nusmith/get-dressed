-- Stores the encrypted Gmail refresh token used to import closet items from receipts.
-- Only the backend (service role) reads or writes this table: RLS is enabled with no
-- policies, and anon/authenticated roles have no grants, so the token never reaches clients.
create table if not exists public.email_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'gmail',
  email text,
  encrypted_refresh_token text not null,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.email_connections enable row level security;
revoke all on public.email_connections from anon, authenticated;
