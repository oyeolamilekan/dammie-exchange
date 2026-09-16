# Dammie AI

Dammie AI is a Telegram-first crypto and NGN financial assistant. Customers
interact with the Telegram bot in natural language, while the linked Telegram
Mini App collects sensitive approvals and account details. Operators use the
same Next.js application through a separate admin console.

The repository is a Bun monorepo with two workspaces:

| Workspace | Responsibility |
| --- | --- |
| [`apps/api`](apps/api/README.md) | Express API, Telegram webhook bot, AI tool loop, Quidax integration, PostgreSQL/Drizzle data layer, and Bull/Redis workers |
| [`apps/web`](apps/web/README.md) | Next.js customer Mini App forms and administrator operations console |

## Product overview

The application supports:

- Telegram conversations about supported currencies, balances, deposit
  addresses, portfolio activity, deposits, swaps, and account history.
- Customer registration and wallet provisioning through Quidax.
- Crypto deposits received through provider webhooks and credited to the
  customer ledger by background workers.
- Crypto-to-NGN swap quotations that require explicit PIN approval before
  processing.
- NGN withdrawals to a verified saved bank account, with fee calculation,
  PIN approval, provider submission, and webhook settlement.
- Owner-scoped saved-bank-account management with masked details and
  history-preserving removal.
- An operator console for users, transactions, account-version history,
  conversations, currencies, networks, currency/network relationships, and
  platform-fee rules.

## How the system works

```text
Telegram user message
        |
        v
Telegram webhook -> Express API -> intent + chat history -> AI tool loop
                                      |
                         database/provider operation
                                      |
                                      v
              text reply or trusted Mini App action
                                      |
                                      v
                          Next.js Mini App form
                                      |
                 signed Telegram initData on mutations
                                      |
                                      v
                         Express API -> service layer
                                      |
                 PostgreSQL transaction and/or Bull job
                                      |
                                      v
                    Quidax provider + Telegram notification
```

The Telegram webhook is authenticated with Telegram's configured secret-token
header before its update enters the bot workflow. The important separation is:

1. The AI agent receives the authenticated Telegram user from the bot runtime;
   the model cannot supply or replace that identity through tool arguments.
2. Read operations can be completed in the bot process, but financial writes
   are guarded by service-level ownership checks, PIN verification, database
   transactions, and idempotent provider-event processing.
3. A quotation or withdrawal intent is not the same as completion. The user
   must approve it in the Mini App, and provider callbacks or worker
   reconciliation finish the financial state transition.

## Repository layout

```text
.
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── agents/       AI tool-loop agent
│   │   │   ├── controllers/  HTTP adapters
│   │   │   ├── db/schema/    Drizzle schema
│   │   │   ├── jobs/         Bull queues and workers
│   │   │   ├── plugins/      Telegram runtime
│   │   │   ├── queries/      Database primitives
│   │   │   ├── services/     Business workflows and integrations
│   │   │   └── tools/        AI-facing tool adapters
│   │   ├── drizzle/          Generated SQL migrations and snapshots
│   │   └── test/             API unit, integration, and boundary tests
│   └── web/
│       ├── app/              Next.js routes
│       ├── components/       Customer forms and admin UI
│       ├── config/           API client and URL configuration
│       ├── endpoints/        Customer API calls
│       └── lib/              Admin API and formatting helpers
├── bun.lock
└── package.json
```

## Prerequisites

- Bun `1.3.10`.
- Node.js `22+` compatibility for the dependency/runtime surface.
- PostgreSQL for application data and the immutable account ledger.
- Redis for Bull queues and security controls such as replay claims and PIN
  attempt limits.
- A Telegram bot token.
- Quidax API credentials and a configured webhook secret.
- An AI Gateway API key and model supported by the AI SDK integration.

PostgreSQL and Redis are external dependencies; this repository does not
provision them.

## Local setup

Install all workspace dependencies from the repository root:

```bash
bun install
```

Create environment files for both workspaces:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Fill in the API secrets and database/Redis connection strings. Set the web
`NEXT_PUBLIC_API_URL` to the API origin with the `/api/v1` prefix. For local
development, the web example points to `http://localhost:3001/api/v1`.

Telegram delivers bot messages through the API webhook, so local bot testing
also needs a public HTTPS tunnel to port `3001`. Put the machine-specific
callback and secret in `apps/api/.env.local`:

```env
TELEGRAM_WEBHOOK_URL=https://your-api-tunnel.example/api/v1/webhooks/telegram
TELEGRAM_WEBHOOK_SECRET=replace_with_a_long_random_secret
```

The API validates these values and registers the URL with Telegram during
startup. The secret may contain only letters, digits, `_`, and `-`. Restart the
API whenever the tunnel hostname changes so Telegram receives the new URL.

Run both workspaces together:

```bash
bun run dev
```

The development URLs are:

- Web: <http://localhost:3000>
- API base: <http://localhost:3001/api/v1>
- Telegram webhook: `/api/v1/webhooks/telegram` on the public API tunnel
- Customer landing page: <http://localhost:3000/>
- Admin login: <http://localhost:3000/admin/login>

Run one workspace independently when needed:

```bash
bun --filter @dammie/api dev
bun --filter @dammie/web dev
```

Before starting the API against a new database, validate and apply migrations,
then run the one-time interactive setup from a terminal:

```bash
bun --filter @dammie/api db:check
bun run db:migrate
bun run setup
```

`bun run setup` prompts for the initial administrator email, password, and
password confirmation. Password input is hidden and must contain at least 12
characters. Setup then creates all initial application data in one PostgreSQL
transaction:

- 247 provider bank-directory records.
- One administrator with a normalized email and bcrypt-hashed password.
- Enabled flat ₦0 fee rules for NGN swaps and withdrawals.
- One `created` audit record for each platform-fee rule.

Setup requires an enabled, non-crypto `ngn` currency created by the migrations.
It uses a database advisory lock to serialize concurrent attempts and refuses
to run if any setup-owned table already contains data. A failure rolls back the
entire operation, so setup cannot leave partial seed data.

The command is intentionally interactive and one-time. To add another
administrator after setup, run:

```bash
bun run admin:create --email admin@example.com
```

## Development commands

From the root:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run check
```

Useful API-only commands:

```bash
bun --filter @dammie/api test:watch
bun --filter @dammie/api db:generate
bun --filter @dammie/api db:studio
bun --filter @dammie/api reconcile:financial
bun --filter @dammie/api reconcile:withdrawals
```

`reconcile:financial` is a read-only report. The withdrawal reconciliation
command resumes safe provider reconciliation for pending or processing NGN
withdrawals and can change their operational state; run it only as an
operator-approved recovery operation.

## Deployment notes

Build from the repository root so the committed lockfile and workspace
configuration remain available:

```bash
bun run build
```

Deploy `apps/web` as the Next.js application and `apps/api` as the Bun service.
Set the web `NEXT_PUBLIC_API_URL` to the reachable API origin with the `/api/v1`
prefix, and configure the API `FRONTEND_URL` and `ADMIN_FRONTEND_URL` to the actual browser origin(s). The
API process owns HTTP, Telegram webhook registration, and all Bull workers.
Set `TELEGRAM_WEBHOOK_URL` to the public HTTPS API callback and use a long,
random `TELEGRAM_WEBHOOK_SECRET` containing only letters, digits, `_`, or `-`.

Database migrations must run before the new API version accepts traffic. Run
`bun run setup` once when provisioning a fresh database; do not run it during
routine deployments of an already initialized database. Keep PostgreSQL and
Redis available during startup: the API deliberately fails closed when
required security or provider configuration is missing.

For implementation details, endpoint contracts, security behavior, and
financial lifecycle documentation, see the [API README](apps/api/README.md).
For Mini App routes, proxy configuration, and admin UI behavior, see the [web
README](apps/web/README.md).
For a short explanation of the agentic-finance design—bounded memory, tool
calling, and customer approval—see [Agentic Finance](docs/agentic-finance.md).

## License

This project is licensed under the [MIT License](LICENSE).

## Disclaimer

This software is provided for self-hosting and development purposes. Operators
are solely responsible for securing and maintaining their deployments,
complying with all applicable laws and regulations, protecting user data, and
managing financial transactions and third-party integrations. The authors and
copyright holders provide no warranty and accept no liability for losses,
damages, regulatory violations, security incidents, or other issues arising
from the operation or modification of this software. See the
[MIT License](LICENSE) for the full warranty and liability terms.
