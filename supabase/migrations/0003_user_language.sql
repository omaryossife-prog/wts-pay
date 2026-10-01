-- Add per-user language preference (website + WhatsApp bot).
-- "ar" (Arabic, default) or "en" (English). All existing users default to "ar".
alter table "User"
  add column if not exists "language" text not null default 'ar';
