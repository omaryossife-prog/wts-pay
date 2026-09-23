-- WTS Pay v2 — WhatsApp-first identity, verification, PIN & authorizations
-- Apply with: npx prisma migrate dev (preferred) or run these statements manually.

create type "VerificationStatus" as enum ('UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
create type "AuthorizationStatus" as enum ('PENDING', 'USED', 'EXPIRED', 'INVALIDATED');

alter table users add column "wtsId" text;
alter table users add column "walletId" text;
alter table users add column "fullName" text;
alter table users add column "waId" text;
alter table users add column "verificationStatus" "VerificationStatus" not null default 'UNVERIFIED';
alter table users add column "idSubmitted" boolean not null default false;
alter table users add column "idReceivedAt" timestamp;
alter table users add column "faceVideoSubmitted" boolean not null default false;
alter table users add column "faceVideoReceivedAt" timestamp;
alter table users add column "reviewedAt" timestamp;
alter table users add column "reviewedById" text;
alter table users add column "rejectionReason" text;
alter table users add column "pinHash" text;
alter table users add column "pinFailedAttempts" integer not null default 0;
alter table users add column "pinLockedUntil" timestamp;
alter table users add column "transfersEnabled" boolean not null default true;

create unique index "users_wtsId_key" on users("wtsId");
create unique index "users_walletId_key" on users("walletId");
create unique index "users_waId_key" on users("waId");

alter table transactions add column "balanceBefore" integer;
alter table transactions add column "balanceAfter" integer;
alter type "TransactionType" add value if not exists 'MANUAL_ADJUSTMENT';

create table "transaction_authorizations" (
  id text primary key default gen_random_uuid()::text,
  "authorizationId" text not null unique,
  "senderId" text not null references users(id),
  "recipientId" text not null references users(id),
  "recipientPhone" text not null,
  "recipientWtsId" text,
  amount integer not null,
  fee integer not null,
  total integer not null,
  "transferIdempotencyKey" text not null unique,
  status "AuthorizationStatus" not null default 'PENDING',
  "createdAt" timestamp not null default now(),
  "expiresAt" timestamp not null,
  "usedAt" timestamp
);
create index "transaction_authorizations_senderId_status_idx" on "transaction_authorizations"("senderId", status);

alter table audit_logs add column ip text;

-- RLS: enable on the new table; the server-side service role performs all writes.
alter table "transaction_authorizations" enable row level security;

-- MEDIA POLICY: ID photos and face videos are NEVER stored in the database or
-- Supabase Storage. Only the metadata columns above are persisted. Admins
-- review the actual media inside the WhatsApp conversation.
