-- Per-access-code cap on how many Telegram accounts can be linked to it.
-- NULL means unlimited; any positive integer caps the count.
-- Enforced by /api/telegram/sign-in: if the count of telegram_accounts rows
-- for this code is already >= account_limit, the sign-in is rejected and
-- the freshly-created Telegram session is logged out so nothing leaks.
alter table public.access_codes
  add column if not exists account_limit integer
  check (account_limit is null or account_limit > 0);
