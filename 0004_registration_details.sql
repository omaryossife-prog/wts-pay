-- Registration details collected after phone OTP verification: gender,
-- governorate, and a hashed national ID (for duplicate-ID detection) plus
-- its last 6 digits in the clear (used only for "forgot password").
alter table "users"
  add column if not exists "gender" text,
  add column if not exists "governorate" text,
  add column if not exists "nationalIdEnc" text,
  add column if not exists "nationalIdLast6" text;

-- Unique only when set (multiple NULLs are allowed in Postgres unique indexes).
create unique index if not exists "users_nationalIdEnc_key" on "users" ("nationalIdEnc");
