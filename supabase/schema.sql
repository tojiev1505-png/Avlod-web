-- Avlod family budget: initial Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor as the project owner.
create extension if not exists pgcrypto;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Семья Avlod',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 70),
  amount bigint not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  category text not null default 'Другое',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 60),
  target bigint not null check (target > 0),
  saved bigint not null default 0 check (saved >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  invited_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  invite_code text not null unique default encode(gen_random_bytes(16), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists family_members_user_id_idx on public.family_members(user_id);
create index if not exists transactions_family_occurred_idx on public.transactions(family_id, occurred_at desc);
create index if not exists goals_family_created_idx on public.goals(family_id, created_at desc);
create index if not exists family_invites_code_idx on public.family_invites(invite_code);

-- Private helper functions avoid recursive RLS policies on family_members.
create schema if not exists private;

create or replace function private.is_family_member(target_family uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.family_id = target_family
      and fm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_family_owner(target_family uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.family_id = target_family
      and fm.user_id = (select auth.uid())
      and fm.role = 'owner'
  );
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on function private.is_family_member(uuid) from public, anon;
revoke all on function private.is_family_owner(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.is_family_owner(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.transactions enable row level security;
alter table public.goals enable row level security;
alter table public.family_invites enable row level security;

revoke all on public.families, public.family_members, public.transactions, public.goals, public.family_invites from anon;
grant select, insert, update, delete on public.families, public.family_members, public.transactions, public.goals, public.family_invites to authenticated;

drop policy if exists "family members can read their families" on public.families;
create policy "family members can read their families"
on public.families for select to authenticated
using (private.is_family_member(id));

drop policy if exists "signed in users can create families" on public.families;
create policy "signed in users can create families"
on public.families for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "owners can update families" on public.families;
create policy "owners can update families"
on public.families for update to authenticated
using (private.is_family_owner(id))
with check (private.is_family_owner(id));

drop policy if exists "owners can delete families" on public.families;
create policy "owners can delete families"
on public.families for delete to authenticated
using (private.is_family_owner(id));

drop policy if exists "members can read memberships in their families" on public.family_members;
create policy "members can read memberships in their families"
on public.family_members for select to authenticated
using (private.is_family_member(family_id) or user_id = (select auth.uid()));

drop policy if exists "family owner can add members" on public.family_members;
create policy "family owner can add members"
on public.family_members for insert to authenticated
with check (
  (user_id = (select auth.uid()) and role = 'owner'
   and exists (select 1 from public.families f where f.id = family_id and f.created_by = (select auth.uid())))
  or private.is_family_owner(family_id)
);

drop policy if exists "owners can remove members and members can leave" on public.family_members;
create policy "owners can remove members and members can leave"
on public.family_members for delete to authenticated
using (private.is_family_owner(family_id) or user_id = (select auth.uid()));

drop policy if exists "family members can read transactions" on public.transactions;
create policy "family members can read transactions"
on public.transactions for select to authenticated using (private.is_family_member(family_id));
drop policy if exists "family members can add transactions" on public.transactions;
create policy "family members can add transactions"
on public.transactions for insert to authenticated with check (private.is_family_member(family_id) and created_by = (select auth.uid()));
drop policy if exists "family members can edit transactions" on public.transactions;
create policy "family members can edit transactions"
on public.transactions for update to authenticated using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
drop policy if exists "family members can delete transactions" on public.transactions;
create policy "family members can delete transactions"
on public.transactions for delete to authenticated using (private.is_family_member(family_id));

drop policy if exists "family members can read goals" on public.goals;
create policy "family members can read goals"
on public.goals for select to authenticated using (private.is_family_member(family_id));
drop policy if exists "family members can add goals" on public.goals;
create policy "family members can add goals"
on public.goals for insert to authenticated with check (private.is_family_member(family_id) and created_by = (select auth.uid()));
drop policy if exists "family members can edit goals" on public.goals;
create policy "family members can edit goals"
on public.goals for update to authenticated using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
drop policy if exists "family members can delete goals" on public.goals;
create policy "family members can delete goals"
on public.goals for delete to authenticated using (private.is_family_member(family_id));

drop policy if exists "family owners can manage invites" on public.family_invites;
create policy "family owners can manage invites"
on public.family_invites for all to authenticated
using (private.is_family_owner(family_id))
with check (private.is_family_owner(family_id));

-- Realtime publication is used for instant updates across signed-in devices.
do $$
begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.goals;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
