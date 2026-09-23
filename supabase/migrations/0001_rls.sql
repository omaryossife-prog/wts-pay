-- WTS Pay — Row Level Security
-- Principle: the frontend NEVER modifies balances directly. All balance changes
-- happen server-side through the service-role (SUPABASE_SECRET_KEY) used only by
-- the Node API. Authenticated clients (anon/publishable key) get read-only access
-- to their own rows where applicable.

alter table users enable row level security;
alter table transactions enable row level security;
alter table referrals enable row level security;
alter table config enable row level security;
alter table audit_logs enable row level security;
alter table processed_messages enable row level security;

-- Examples of least-privilege policies (tighten to your auth setup):
-- create policy "read own profile" on users
--   for select using (auth.uid()::text = id);
-- create policy "read own transactions" on transactions
--   for select using (auth.uid()::text = sender_id or auth.uid()::text = receiver_id);

-- No insert/update/delete policies are granted to the anon/publishable key.
-- The Node API connects with the service role key (server-side only) and is
-- therefore subject to RLS bypass — which is why ALL business rules
-- (fees, limits, idempotency, anti-abuse) live in server/services, not in SQL.
