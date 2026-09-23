# WTS Pay — Demo Digital Wallet MVP

A production-ready **demo / test** digital wallet. **No real money. No bank integration.
No InstaPay. No Fawry. No real cash-out.** Demo credits are internal only and cannot be
redeemed for real money. The architecture is clean enough to later connect a licensed
payment provider (via the `PaymentProvider` interface) and the official WhatsApp Cloud API
**without rewriting the wallet core**.

```
wts-pay/
├── client/                  # React + TypeScript + Vite (mobile-first, Cloudflare Pages)
│   └── src/
│       ├── pages/           # Landing, Login, Register, Wallet, Send, Transactions,
│       │                    # Referrals, Profile, Help, Admin
│       ├── components/      # Layout (bottom nav), StatCard, TxRow
│       ├── services/        # api client (never exposes secrets)
│       ├── hooks/           # useAuth (JWT context)
│       └── types/
├── server/                  # Node + TypeScript + Express REST API
│   └── src/
│       ├── routes/          # auth, wallet, referrals, admin, whatsapp
│       ├── controllers/
│       ├── services/        # wallet, fee, referral, user, audit, config, payment/
│       ├── middleware/      # auth, admin, rate limiting, validation, CSRF header, errors
│       ├── whatsapp/        # modular Cloud API layer (see below)
│       └── utils/           # prisma, jwt, crypto (app-level field encryption), logger
├── prisma/                  # schema.prisma + seed.ts
├── tests/                   # vitest unit tests (in-memory fake DB)
├── supabase/migrations/     # RLS policies
├── docker-compose.yml       # local Postgres for development
└── .env.example             # every secret/variable placeholder
```

## Architecture

**Balance changes are server-side only.** The frontend never touches balances directly.
Supabase is the database infrastructure — the Node API holds the service-role key
(server-side only) and enforces every business rule (fees, idempotency, anti-abuse).

```
Website ──┐
WhatsApp ─┼─> Express API ─> services (wallet/fee/referral) ─> Prisma ─> Supabase Postgres
Mobile ───┘        (JWT auth, rate limits, validation)
```

### WhatsApp layer (official Meta Cloud API only)

`server/src/whatsapp/` — `whatsapp.client.ts` (Graph API sender: `sendTextMessage`,
`sendButtonMessage`, `sendListMessage`, `sendInteractiveMessage`), `whatsapp.templates.ts`
(payload builders + menu), `whatsapp.webhook.ts` (verify + receive, **deduplicated by
message ID**), `whatsapp.handler.ts` (routes replies to actions), `whatsapp.service.ts`
(session state machine + menu actions that call the **existing** wallet/referral services).

Menu: 💰 Balance · 💸 Send Money · 📜 Transactions · 🎁 Referrals · 👤 My Account · ❓ Help.
Send-money flow uses expiring sessions (`SEND_MONEY_WAITING_FOR_PHONE` → `..._AMOUNT` →
`..._CONFIRMATION`) and the same `fee.service.ts` + `wallet.service.ts` as the website.

No `whatsapp-web.js`, no Baileys, no Selenium/Puppeteer.

### Wallet rules

- Internal demo balance per user; transfers only between WTS users; **no withdrawals**.
- **Immutable ledger**: every balance change creates a `Transaction` row
  (sender, receiver, amount, fee, totalDebit, status, type, idempotency key) inside a
  **DB transaction** with guarded atomic debit/credit (no negative balances under concurrency).
- **Fee** (single dedicated `fee.service.ts`): `fee = CEILING(amount / 1000)` — admin-configurable later.
- **Referrals**: rewards only after anti-abuse conditions (unique phone, active accounts,
  ≥ configured eligible transactions, per-user reward cap, campaign window). Every reward
  is a separate ledger row. Admin can reverse rewards (audited).
- **Anti-abuse**: one account per phone, rate limits, idempotency everywhere, duplicate
  webhook protection, suspicious-referral flags, admin freeze/unfreeze, full audit log.
- **Security**: bcrypt passwords, JWT (+ httpOnly cookie), CSRF custom-header check,
  strict CORS, zod validation, auth + admin middleware, app-level AES-256-GCM field
  encryption helper for sensitive identity data, zero secrets in the frontend/repo.

---

## 1. Install dependencies

```bash
npm run install:all        # installs server + client packages
```

## 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Settings → Database**: copy the connection strings (pooler `6543`/`5432` for
   `DATABASE_URL` with `?pgbouncer=true`, direct for `DIRECT_URL`).
3. **Settings → API**: copy `SUPABASE_URL`, the `anon/publishable` key
   (`SUPABASE_PUBLISHABLE_KEY`) and the `service_role/secret` key (`SUPABASE_SECRET_KEY`).

## 3. Configure environment

```bash
cp .env.example .env          # then fill in values
```

| Variable | Where used |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Prisma migrations |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | safe for frontend (not required by the client yet) |
| `SUPABASE_SECRET_KEY` | **server only** — never expose |
| `JWT_SECRET`, `ENCRYPTION_KEY` (64 hex chars) | server only |
| `WHATSAPP_*` | server only — added when connecting WhatsApp (step 10) |

## 4. Run Prisma migrations

```bash
cd server
npx prisma migrate dev --name init     # applies schema to Supabase
npx prisma generate
```

(For local development you can instead run `docker compose up -d` and point `DATABASE_URL`
at `postgresql://postgres:postgres@localhost:5432/wtspay`.)

Apply RLS (see `supabase/migrations/0001_rls.sql`): enable RLS on all tables; grant the
frontend key read-only policies only — **no balance-write policies, ever**.

## 5. Seed demo users

```bash
cd server && npm run seed
# Admin:  +201000000001 / AdminDemo123!
# Users:  +201000000002 / UserDemo123!   (500 EGP demo balance)
#         +201000000003 / UserDemo123!
```

Also seeds default config: fee divisor 1000, signup reward +50, referral reward +25,
anti-abuse thresholds.

## 6. Start the backend

```bash
cd server && npm run dev     # http://localhost:4000  (GET /api/health)
```

## 7. Start the frontend

```bash
cd client && npm run dev     # http://localhost:5173 (proxies /api -> :4000)
```

## 8. Deploy frontend to Cloudflare Pages

```bash
cd client && npm run build
```

In Cloudflare Pages: **Create project → connect your repo**, framework preset **Vite**,
build command `npm run build`, output dir `client/dist`, root dir `client`. Add no secret
env vars — the client needs none. Set the backend URL via a Pages environment variable
(e.g. `VITE_API_URL=https://your-api.example.com`) and adjust `client/src/services/api.ts`
to use it as the request base.

## 9. Production environment variables

Set on your Node hosting (Render/Railway/Fly/VPS — **not** Cloudflare Pages, the backend
stays independent): everything in `.env.example` except the publishable key. Rotate
`JWT_SECRET` and `ENCRYPTION_KEY` before going live (`ENCRYPTION_KEY` must remain 64 hex
chars; changing it makes previously encrypted fields unreadable).

## 10. Where WhatsApp Cloud API credentials go

Add these **server-side only** values to `.env` / hosting env:

```
WHATSAPP_ACCESS_TOKEN=EAAG...        # permanent token from Meta Business > System Users
WHATSAPP_PHONE_NUMBER_ID=1234...     # WhatsApp > API Setup
WHATSAPP_BUSINESS_ACCOUNT_ID=5678... # Business Manager account id
WHATSAPP_VERIFY_TOKEN=<random>       # you invent this; used in webhook verification
WHATSAPP_API_VERSION=v21.0
```

No wallet code changes are needed — the `whatsapp/` layer already calls the existing services.

## 11. Expose the webhook over HTTPS

The webhook URL is `https://<your-api-domain>/api/whatsapp/webhook`. Terminate TLS with
your host or a reverse proxy (e.g. Caddy/Nginx/Cloudflare Tunnel). Quick tunnel for local
testing: `cloudflared tunnel --url http://localhost:4000`.

## 12. Connect the WhatsApp phone number later (Meta steps)

1. Meta for Developers → create app → add **WhatsApp** product.
2. Copy credentials into env vars (step 10).
3. Add the webhook URL + your `WHATSAPP_VERIFY_TOKEN` in WhatsApp → Configuration.
4. Subscribe to the `messages` field. The backend answers the verification `GET`
   automatically and processes `POST` events (text, buttons, lists) with message-ID dedup.
5. Users message your business number; if their number matches a WTS account it links
   automatically and the main menu (💰💸📜🎁👤❓) works against the same wallet.

## Tests

```bash
npm test     # from repo root (runs server vitest suite)
```

Covers: registration, login, password hashing, **all fee examples from the spec**,
transfers (atomicity, insufficient balance, frozen accounts, self-transfer), referral
rewards (activation conditions, duplicates, cap, self-use flag), idempotency, admin
adjustments + audit trail, reward reversal. Tests run against an in-memory Prisma-like
fake — no database required.

## Adding a real payment provider later

Implement `PaymentProvider` from `server/src/services/payment/provider.ts`
(`createDeposit`, `verifyDeposit`, `createWithdrawal`, `verifyWithdrawal`) and swap the
provider instance. Wallet/ledger/business logic stays untouched. The included
`DemoPaymentProvider` only simulates internal credits and **refuses withdrawals by design**.

## Update — WhatsApp-first experience, secure PIN authorization & admin corrections

The MVP has been extended so the **entire normal user experience happens inside
WhatsApp** (registration → verification → PIN → transfers), while keeping every
existing wallet protection (immutable ledger, atomicity, idempotency, fee formula
`CEILING(amount/1000)`, referrals, admin auth, strict CORS, Zod validation).

### Identity model

- The **stable WhatsApp identity** `wa_id` from the official Cloud API webhook is the
  authoritative channel identity (`users.waId`, unique). The WhatsApp profile name is
  stored only as a display hint and is **never** an identifier.
- The permanent WTS identity is the internal **`WTS-######`** user ID (plus
  **`WALLET-######`**), issued atomically at admin approval from config counters.
- A user record keeps: internal id, WTS ID, wallet ID, wa_id, WhatsApp phone,
  full legal name, verification status, balance, PIN state, timestamps.

### Registration inside WhatsApp

Start → full **four-part legal name** (validated) → confirm the API-detected WhatsApp
number (you cannot claim someone else's number — the API identity is authoritative) →
send **ID front**, **ID back**, then a **5–10s face video**. Status becomes
`PENDING_REVIEW`.

**Media policy:** ID photos and face videos are **never** fetched, copied, or stored in
the WTS database or Supabase Storage — only metadata (`idSubmitted`,
`faceVideoSubmitted`, timestamps). The admin reviews the actual media by opening the
WhatsApp conversation from the dashboard (`wa.me/<number>` link).

### Admin verification dashboard

New "Verifications" tab: pending list with name, WhatsApp number, submission metadata,
**Open WhatsApp Conversation**, **Approve**, **Reject** (with reason). Approval is
atomic: issues WTS ID + wallet, sets `VERIFIED`, grants configurable initial balance
with a ledger row, audits `USER_APPROVED`, and notifies the user on WhatsApp with
Wallet / Send Money / Create PIN buttons.

### WTS transaction PIN (authorization ≠ identity)

- Separate 6-digit PIN, bcrypt-hashed, never stored/displayed in plaintext.
- Failed attempts are counted and temporarily lock the PIN (configurable limits);
  every failure/lock is audited with IP.
- Admin can **Reset PIN** (audited `PIN_RESET`); user recreates it in WhatsApp.
- **Preferred UX:** a WhatsApp-native **Flow** for PIN entry — set
  `WHATSAPP_PIN_FLOW_ID` + `WHATSAPP_FLOW_PRIVATE_KEY`; the backend exposes
  `POST /api/whatsapp/flows/pin` (Meta-encrypted data exchange, AES-256-GCM with
  RSA-OAEP-wrapped key) and stores only the hash. No external browser is involved.
- **Documented limitation:** if no Flow is configured, the bot uses the officially
  supported chat fallback (type the 6-digit PIN in the encrypted WhatsApp chat) with
  rate limiting and lockout. No Face ID/biometrics is claimed or required — the PIN is
  the authorization mechanism.

### Transaction authorization (transfers)

A WhatsApp button press **never** executes a transfer directly:

1. Confirm Transfer → server creates a **PENDING** `TransactionAuthorization`
   (recipient, amount, fee, total, `expiresAt`, unique `transferIdempotencyKey`).
2. Any earlier pending authorization of the sender is **invalidated** (details changed
   ⇒ old authorization dies).
3. User enters PIN (Flow or fallback) → `verifyPin` → `executeAuthorizedTransfer`
   runs **one DB transaction**: re-checks authorization (owner, PENDING, unexpired,
   unused), executes the guarded wallet transfer bound to the exact idempotency key,
   marks the authorization `USED`. The unique ledger key makes double-execution
   impossible; expiry is enforced.

### Admin corrections system

- **Manual balance adjustment** (+/-) with a before/after preview, mandatory reason,
   `MANUAL_ADJUSTMENT` ledger row recording `balanceBefore`/`balanceAfter`, and an
   append-only audit entry (admin, user, amount, reason, IP, adjustment ID). Balances
   are never silently overwritten.
- User controls: Freeze/Unfreeze (balance intact, WhatsApp notification, `ACCOUNT_FROZEN`),
  Reset PIN, Disable/Enable Transfers (`USER_STATUS_CHANGED`).
- Settings: fee formula, rewards, referral qualification, initial balance,
  transaction limits, PIN attempt limits, lock duration, authorization TTL,
  maintenance mode — all admin-configurable, changes audited
  (`FEE_SETTING_CHANGED`, `REFERRAL_SETTING_CHANGED`, …).
- Audit events include: `USER_APPROVED`, `USER_REJECTED`, `ACCOUNT_FROZEN`,
  `ACCOUNT_UNFROZEN`, `PIN_RESET`, `PIN_LOCKED`, `PIN_VERIFY_FAILED`,
  `MANUAL_BALANCE_ADJUSTMENT`, `FEE_SETTING_CHANGED`, `REFERRAL_SETTING_CHANGED`,
  `USER_STATUS_CHANGED` — with admin, target user, IP and metadata.

### New/changed tables

`users` (+wtsId, walletId, fullName, waId, verification lifecycle, PIN fields,
transfersEnabled), `transaction_authorizations` (new), `transactions`
(+balanceBefore/After, MANUAL_ADJUSTMENT type), `audit_logs` (+ip). See
`supabase/migrations/0002_whatsapp_first.sql`. Run `npx prisma migrate dev` after
pulling; re-seed to get the new config keys.

### Full user flow (WhatsApp only)

Start → identity registered? → main menu (💰💸📜🎁👤❓) · else Create Account →
four-part name → confirm number → ID front → ID back → face video → Pending Review →
admin reviews media in WhatsApp → Approve → wallet created (`WTS-######`, `WALLET-######`,
balance 0) → create PIN (Flow preferred, documented fallback) → Send Money → recipient →
amount → fee summary → Confirm Transfer → PIN → atomic execution → success receipt.

## Legal / demo disclaimer

WTS Pay is a demonstration product. Balances are demo credits with no cash value and no
redemption. Do not connect real payment rails without a license from the relevant
regulator (e.g. Central Bank of Egypt for wallets operating in Egypt).

#### WhatsApp Flow actions result screen

`server/flows/wts-actions.flow.json` contains the native WhatsApp Flow for WTS actions. Configure `WHATSAPP_WTS_ACTIONS_FLOW_ID` and point the Flow data exchange endpoint to `POST /api/whatsapp/flows/actions`. The Flow shows a backend-driven `RESULT` screen and also sends a normal WhatsApp message after terminal operations; the existing chat send-money flow remains as fallback when the Flow id is not configured.
