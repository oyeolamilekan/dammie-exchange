# Dammie AI API

The API workspace is the backend runtime for Dammie AI. It combines an
Express/TypeScript HTTP API, a Telegram webhook bot, an AI tool-loop, a
Quidax provider adapter, PostgreSQL persistence through Drizzle ORM, and Bull
workers backed by Redis.

The customer-facing interaction starts in Telegram. The HTTP API is used when
the Telegram Mini App needs to complete signup, add or remove a bank account,
or approve a swap or withdrawal. Provider webhooks are accepted by HTTP and
processed asynchronously by workers.

## Responsibilities

- Authenticate Telegram Mini App requests and bind them to the signed Telegram
  user.
- Receive Telegram messages, persist conversation turns, and run the crypto
  assistant.
- Expose owner-scoped customer mutations and the administrator API.
- Call Quidax for sub-users, wallets, addresses, quotations, bank validation,
  and payouts.
- Keep wallet balances and immutable account versions consistent with database
  transactions and decimal arithmetic.
- Persist provider events before queueing them, making webhook delivery
  idempotent.
- Process wallet provisioning, deposits, swaps, and NGN payouts through Bull
  workers.

## Runtime lifecycle

`src/app.ts` creates the Express application without opening external
connections. `src/server.ts` owns the runtime lifecycle:

1. Validate required webhook configuration and mark the app not ready.
2. Bind the HTTP port first so a port conflict fails before external services
   start.
3. Verify PostgreSQL connectivity.
4. Register the Telegram webhook.
5. Initialize all Bull worker queues.
6. Mark the application ready and accept requests.

Requests receive `503 Service is starting` until the ready gate is open.
`SIGINT` and `SIGTERM` use one idempotent shutdown path: HTTP intake stops
first, then worker/producer queues and Redis clients, then PostgreSQL. The
remote Telegram webhook remains registered during restarts so Telegram can
retry updates while the API is temporarily unavailable.

## HTTP API

The API is mounted at `/api/v1`. User mutation responses use this envelope:

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

### Customer routes

Every customer route requires the `X-Telegram-Init-Data` header. Read-only
withdrawal and saved-account requests verify the same header without consuming
its replay claim; mutations claim it once. The value must be the raw
`Telegram.WebApp.initData` string, not the parsed `initDataUnsafe` object.

| Method | Path | Purpose | Body |
| --- | --- | --- | --- |
| `POST` | `/users/create_user/:id` | Complete a Telegram intent and create the user | `email`, `firstName`, `lastName`, `bvnNumber`, `transactionPin` |
| `POST` | `/users/add_bank_account` | Verify and save a bank account | `bankCode`, `accountNumber` |
| `POST` | `/users/add_bank_account/:userId` | Compatibility path for old Mini App links; the path user ID is ignored | `bankCode`, `accountNumber` |
| `GET` | `/users/bank_accounts` | List the customer's active saved accounts with masked account numbers | none |
| `DELETE` | `/users/bank_accounts/:bankId` | Remove an owner-scoped saved account | none |
| `POST` | `/users/approve_transaction/:swapId` | Validate the customer PIN and queue an approved swap | `code` |
| `GET` | `/users/withdrawals/:withdrawalId` | Return an owner-scoped withdrawal review | none |
| `POST` | `/users/approve_withdrawal/:withdrawalId` | Validate PIN, select a saved bank account, lock funds, and queue payout | `code`, `bankId` |

The identity for all of these routes comes from verified Telegram data. A user
ID in a URL or request body is not an authentication credential.

### Administrator routes

Admin login creates an HTTP-only `dammie_admin_session` cookie. The cookie is
scoped to `/api/v1/admin`, stores a random token on the client, and stores only
its SHA-256 hash in PostgreSQL. The default session duration is 12 hours.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/admin/auth/login` | Authenticate an administrator with email and password |
| `POST` | `/admin/auth/logout` | Revoke the current session |
| `GET` | `/admin/auth/me` | Return the current administrator |
| `GET` | `/admin/overview` | Return operational counts, balances, recent transactions, and reconciliation items |
| `GET` | `/admin/catalog` | Return currencies with their networks |
| `GET` | `/admin/catalog/currencies` | List currencies |
| `GET` | `/admin/catalog/networks` | List networks |
| `GET` | `/admin/catalog/currency-networks` | List currency/network relationships |
| `GET` | `/admin/fees` | List platform-fee rules |
| `POST` / `PATCH` | `/admin/fees`, `/admin/fees/:id` | Create or update a fee rule |
| `GET` | `/admin/fees/:id/audit` | Read fee-rule audit history |
| `POST` | `/admin/catalog/currencies` | Create a currency |
| `PATCH` / `DELETE` | `/admin/catalog/currencies/:id` | Update or delete a currency |
| `POST` | `/admin/catalog/networks` | Create a network |
| `PATCH` / `DELETE` | `/admin/catalog/networks/:id` | Update or delete a network |
| `POST` | `/admin/catalog/currency-networks` | Link a currency to a network |
| `DELETE` | `/admin/catalog/currency-networks/:currencyId/:networkId` | Remove a currency/network link |
| `GET` | `/admin/users` | Cursor-paginated user list with search and active filters |
| `GET` | `/admin/users/:userId` | User details and wallets |
| `GET` | `/admin/users/:userId/transactions` | Cursor-paginated deposits, swaps, and withdrawals |
| `GET` | `/admin/users/:userId/account-versions` | Cursor-paginated immutable balance changes |
| `GET` | `/admin/users/:userId/conversations` | Cursor-paginated Telegram conversation turns |

Admin mutations also require an allowed `Origin`. The API allows the origins
derived from `FRONTEND_URL` and `ADMIN_FRONTEND_URL`.

### Webhooks

| Method | Path | Header | Purpose |
| --- | --- | --- | --- |
| `POST` | `/webhooks/crypto` | `quidax-signature: <CRYPTO_WEBHOOK_KEY>` | Persist a provider event and enqueue its workflow |
| `POST` | `/webhooks/telegram` | `X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>` | Authenticate and dispatch an inbound Telegram update |

The current webhook middleware compares the supplied signature to the
configured shared secret with a timing-safe comparison. Keep the provider's
webhook configuration aligned with `CRYPTO_WEBHOOK_KEY`. The request body is
captured as a raw buffer for webhook requests before JSON parsing.

Known provider event mappings are:

| Provider event | Queue/workflow |
| --- | --- |
| `deposit.transaction.confirmation` | Verify and record a deposit confirmation |
| `deposit.successful` | Verify and credit the deposit |
| `swap_transaction.completed` / `.complete` | Settle a completed swap and begin custody handling |
| `swap_transaction.failed` / `.reversed` | Recover or restore the swap |
| `withdraw.successful` / `withdraw.rejected` | Verify and settle a provider withdrawal or restore the hold |

Events are identified by provider, event type, and resource ID. Duplicate or
unknown events are acknowledged safely; a known event is claimed before it is
queued so provider retries do not create duplicate work.

The API registers `TELEGRAM_WEBHOOK_URL` with Telegram during startup and asks
Telegram to include `TELEGRAM_WEBHOOK_SECRET` on every delivery. The configured
URL must be the public HTTPS address of `/api/v1/webhooks/telegram`. Telegram
message IDs remain idempotent in the conversation store, so redeliveries do not
repeat an already-claimed turn.

## Telegram bot and AI agent

`src/plugins/telegram.ts` receives text messages from Telegram. For each
message it:

1. Applies the in-process user rate limit.
2. Creates or loads the Telegram intent.
3. Claims the inbound message so duplicate deliveries do not create duplicate
   turns.
4. Loads a bounded recent conversation history and the current supported
   currency catalog.
5. Runs the crypto agent with the authenticated Telegram user context.
6. Sends a text response, a wallet-address QR/image response, or a typed
   Telegram Web App button.
7. Persists the exact assistant message shown to the customer.

The agent is implemented in `src/agents/crypto.agent.ts` using the AI SDK's
tool-loop. Tool schemas are generated from the current database catalog, and
the loop stops after five steps. Available tools are:

- `addBankAccount`
- `removeBankAccount`
- `createSwap`
- `withdrawNgn`
- `getWalletBalance`
- `getWalletAddress`
- `getPortfolioSnapshot`
- `fetchDeposits`
- `fetchSwaps`
- `fetchAccountHistory`
- `computeTotalDeposits`
- `computeTotalSwaps`

Tool results can include trusted action metadata. The bot turns that metadata
into a Mini App button or wallet-address response; the model does not control
the final URL or customer identity. Swap creation only creates a quotation and
pending record. It does not approve or complete the swap.

For the tool contracts, input conventions, action protocol, extension guide,
and focused test locations, see [the crypto agent tools README](src/tools/README.md).

## Financial workflows

### Registration and wallet provisioning

The bot creates a Telegram intent and sends a signup Mini App link. The Mini
App submits the signed Telegram identity and signup details. The API checks that
the signed Telegram ID owns the intent, creates a Quidax sub-user, hashes the
four-digit transaction PIN, stores the user, and queues wallet provisioning.

The wallet worker ensures the NGN wallet, creates configured crypto wallets,
requests network-specific payment addresses from Quidax, stores addresses, and
notifies the customer as addresses become available.

### Deposits

Quidax sends a webhook. The API persists the event and queues the appropriate
deposit worker. The worker re-verifies the provider record, records the deposit,
and credits the wallet in a PostgreSQL transaction. Repeated events are
idempotent.

### Swaps

1. The AI tool validates the currency and amount, checks the user's available
   balance, requests a Quidax instant-swap quotation, resolves the configured
   platform fee, and stores a pending swap.
2. Telegram shows the quotation and an approval Mini App button.
3. The Mini App sends the PIN with signed Telegram init data.
4. The API verifies ownership and the PIN, applies the Redis-backed failed-PIN
   limit, and queues the swap approval.
5. The worker refreshes/validates the approved swap and locks the source
   balance. Provider completion and custody events settle or recover the swap.

### NGN withdrawals

1. The AI tool checks NGN availability, validates the amount, resolves the
   current withdrawal fee, checks the NGN balance, and creates a review intent.
2. The Mini App performs an owner-scoped read of the intent, displaying masked
   saved bank accounts and the total debit.
3. The customer selects a verified bank account and enters the four-digit PIN.
4. The API atomically snapshots the bank details, moves amount plus fee from
   available to locked balance, and queues the payout.
5. The worker reconciles an existing provider payout before creating one. A
   verified success completes the hold; a verified rejection restores it.

The payout path requires `MAIN_ACCOUNT_ID`. Provider records are checked for
expected owner, reference, amount, and provider ID before settlement.

## Data model and consistency

The main Drizzle tables are:

- `intents`, `users`, and `chat_messages` for Telegram identity and history.
- `currencies`, `networks`, and `currency_network` for the supported catalog.
- `wallets` and `wallet_addresses` for customer custody records.
- `deposits`, `swaps`, and `withdrawals` for transaction state.
- `account_versions` for immutable balance transitions.
- `provider_events` for webhook idempotency and processing state.
- `admins`, `admin_sessions`, `platform_fee`, and `platform_fee_audit` for
  operator access and fee configuration.

Financial numeric values use PostgreSQL `numeric(36,18)` and are manipulated
with the decimal helpers in `src/utils/decimal.ts`. Wallet rows maintain
available and locked balances. Every balance mutation records a corresponding
account version with the previous balance, new balance, locked balance,
transaction family, and action.

Transaction histories use bounded cursor pagination. Telegram history output is
kept below Telegram's message limit, while admin endpoints accept opaque
continuation cursors.

## Security model

- Telegram mutations require the raw signed `X-Telegram-Init-Data` value.
  Telegram HMAC validation checks the bot token, `auth_date`, and user fields.
- Mutation auth claims each signed init-data payload once in Redis. The
  read-only withdrawal review does not consume the claim, allowing the approval
  mutation to use it.
- Redis is required for replay protection, admin login limits, and PIN attempt
  limits. Sensitive operations fail closed if its security store is unavailable.
- Swap and withdrawal PIN failures are limited per authenticated Telegram user
  and transaction. Defaults are five attempts per 15 minutes.
- Admin passwords are bcrypt-hashed. Admin sessions are random HTTP-only
  cookies whose hashes are stored in PostgreSQL, and login attempts are
  rate-limited in Redis.
- User lookup and approval workflows scope records to the authenticated owner;
  route parameters alone never establish ownership.
- Provider responses are retained for operational verification, but customer
  and admin response mappers omit sensitive fields such as hashed PINs and BVN.

## Environment variables

Copy `.env.example` to `.env` in this workspace. Machine-specific overrides,
including a changing development tunnel URL, can go in the gitignored
`.env.local` file. Bun loads `.env.local` with higher precedence than `.env`.
The important settings are:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; the API dev script forces `3001` |
| `NODE_ENV` | Runtime mode; production enables secure admin cookies |
| `TELEGRAM_BOT_TOKEN` | Telegram bot and Mini App HMAC verification |
| `TELEGRAM_WEBHOOK_URL` | Public HTTPS URL for `/api/v1/webhooks/telegram` |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram-compatible secret token used to authenticate bot updates |
| `AI_GATEWAY_API_KEY` | AI Gateway credential used by the bot |
| `AI_MODEL` | AI model identifier; defaults to the configured fallback |
| `QUIDAX_API_URL`, `QUIDAX_API_KEY` | Quidax provider adapter configuration |
| `CRYPTO_WEBHOOK_KEY` | Required shared secret for `/webhooks/crypto` |
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | Optional test database when `NODE_ENV=test` |
| `REDIS_URL` | Bull queues and security store |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | Maximum signed init-data age; default `300` |
| `PIN_ATTEMPT_WINDOW_SECONDS`, `PIN_MAX_ATTEMPTS` | Failed-PIN lock policy |
| `MAIN_ACCOUNT_ID` | Quidax owner account used for NGN payout operations |
| `FRONTEND_URL` | Customer origin and Telegram Mini App link base |
| `ADMIN_FRONTEND_URL` | Allowed admin browser origin; defaults based on environment |
| `ADMIN_SESSION_HOURS` | Admin session duration; default `12` |
| `ADMIN_LOGIN_WINDOW_SECONDS`, `ADMIN_LOGIN_MAX_ATTEMPTS` | Admin login rate-limit policy |

Never commit populated `.env` files or provider credentials.

For local Telegram delivery, expose the API port through an HTTPS tunnel and
set the full callback URL in `.env.local`:

```env
TELEGRAM_WEBHOOK_URL=https://your-api-tunnel.example/api/v1/webhooks/telegram
TELEGRAM_WEBHOOK_SECRET=replace_with_a_long_random_secret
```

The API registers this callback automatically on startup. Restart it after the
tunnel hostname changes. Requests without the matching
`X-Telegram-Bot-Api-Secret-Token` header are rejected before update dispatch.

## Queues and workers

The worker registry initializes these queues at startup:

```text
create-wallet-queue
deposit-confirmation-queue
deposit-successful-queue
pending-swap-queue
successful-swap-queue
finalize-swap-queue
swap-recovery-queue
pending-withdrawal-queue
```

Webhook and approval jobs use stable job IDs where possible, retry with
exponential backoff, and record provider-event success/failure. The queue
registry keeps producer queues separate from tracked worker queues so shutdown
can close both cleanly.

## Commands

Run these from `apps/api`, or use the equivalent root workspace commands:

```bash
bun install
bun run dev
bun run build
bun run start
bun run lint
bun run typecheck
bun run test
bun run test:watch
bun run db:check
bun run db:generate
bun run db:migrate
bun run setup
bun run db:studio
bun run reconcile:financial
bun run reconcile:withdrawals
bun run admin:create --email admin@example.com
```

### Initial database setup

For a fresh database, apply the schema and then run setup from an interactive
terminal:

```bash
bun run db:migrate
bun run setup
```

The setup command prompts for an administrator email, password, and password
confirmation. Passwords are entered invisibly and must contain at least 12
characters. The administrator email is trimmed and lowercased before storage,
and the password is hashed with bcrypt cost 12.

Setup owns and creates the following initial records:

- The complete 247-record provider bank catalog.
- One active administrator.
- Enabled flat ₦0 platform-fee rules for NGN `swap` and `withdrawal` contexts.
- A `created` audit entry for each fee, attributed to the initial administrator.

All seeds execute in dependency order inside one transaction. A PostgreSQL
transaction-level advisory lock serializes concurrent setup attempts. Setup also
requires `bank_catalog`, `admins`, `platform_fee`, and `platform_fee_audit` to
be empty, and requires the migrated `ngn` currency to be enabled and marked as
non-crypto. If any condition or seed fails, the transaction is rolled back.

The command is therefore deliberately one-time and cannot be used to refresh
or merge seed data. Use the existing command below to add administrators after
initial setup:

```bash
bun run admin:create --email admin@example.com
```

`bun run start` runs the compiled `dist/server.js`. It does not start from
`src` and should be used only after `bun run build`.

## Code organization

Controllers, Telegram tools, plugins, and workers are adapters. Business rules
live in `src/services`, database access primitives live in `src/queries`, and
external boundaries are represented by typed adapters such as `QuidaxClient`,
`TelegramClient`, `SecurityStore`, and the queue registry.

Services do not depend on controllers, routes, tools, plugins, agents, or job
listeners. The dependency direction is guarded by
`test/services/service-boundaries.test.ts`. When changing a workflow, preserve
the external contract: route paths/statuses/envelopes, Telegram messages and
actions, webhook event identities, queue names/payloads, database transactions,
decimal behavior, and idempotency.

## Tests

The test suite covers service boundaries, wallet provisioning, provider
adapters, AI tools, Telegram behavior, admin auth/data, security controls,
financial ledger transitions, webhook mapping, queue lifecycle, and portfolio
queries. Tests that need persistence should use the `TEST_DATABASE_URL`
database and should not point at production data.

## License

See [`LICENCE`](LICENCE).
