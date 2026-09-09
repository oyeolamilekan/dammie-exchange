# Dammie AI Backend System Design Document

## Overview
Dammie AI Backend is a cryptocurrency trading bot system built with Node.js and Express.js. It integrates with Telegram to provide users with AI-powered crypto trading assistance through a chat interface.

## System Architecture

### Tech Stack
- **Runtime**: Bun with TypeScript
- **Web Framework**: Express.js
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis
- **Crypto Exchange**: Quidax API
- **AI SDK**: Vercel AI SDK (`ai`)
- **AI Service**: DeepSeek V4 Pro through Vercel AI Gateway
- **Messaging Platform**: Telegram Bot API

### Core Components

#### 1. Application Entry Points
- **app.ts**: Side-effect-free Express application and middleware construction
- **server.ts**: Coordinated PostgreSQL, Telegram, Bull, Redis, and HTTP startup/shutdown
- **database.ts**: Explicit PostgreSQL pool and Drizzle client management

#### 2. API Layer (`routes/`)
- **user.routes.ts**: User management endpoints
- **webhook.route.ts**: Webhook handlers for external services
- **index.ts**: Route aggregation and organization

#### 3. Business Logic (`controllers/` and `services/`)

Controllers are HTTP adapters. They extract authenticated request data, invoke
one workflow, map expected discriminated results to the existing HTTP response,
and log unexpected failures. Telegram tools do the equivalent for AI tool input
and output, while queue workers do it for Bull job payloads, logging, and user
notifications.

The service tree is organized by business capability:

```text
services/
  financial/
    account-versions.ts  deposits.ts  reconciliation.ts  withdrawals.ts
    swaps/{create,approval,recovery,settlement,settlement-store,settlement-values}.ts
  integrations/quidax.ts
  portfolio/{metrics,snapshot}.ts
  security/{pin-attempts,store,telegram-auth}.ts
  telegram/{client,history,notifications}.ts
  users/{register,bank-accounts,approve-swap}.ts
```

Services may use queries, schemas, configuration, utilities, and other services
within their capability. They never import controllers, routes, tools, plugins,
agents, or job listeners. Queries are database primitives and never import
services. `settlement-store.ts` and `settlement-values.ts` are private to the
swap settlement folder. Imports are direct; there are no service barrels,
global interface collections, generic repositories, abstract service bases, or
an injected framework.

The canonical internal contracts are the factory-inferred `QuidaxClient`,
`TelegramClient`, `SecurityStore`, `ChatHistoryStore`, and typed queue payloads.
Workflow-specific input/result types live beside their workflow and are exported
only when another production module or test consumes them. Quidax uses
`createQuidaxClient({ request, baseUrl, apiKey, logger })` so tests can provide a
fake transport without mutating the configured singleton.

External behavior is the compatibility boundary for this design. Refactoring
must preserve routes, response envelopes/status/error text, Telegram behavior,
webhook signatures/mappings/200 responses, queue names/options/payloads/job IDs,
Quidax URLs/bodies/errors, reconciliation JSON, database schema and transaction
boundaries, exact decimal financial invariants, and idempotency. Internal
service paths and exports are not compatibility APIs.

#### 4. Telegram Bot Integration (`plugins/telegram.ts`)
- **DammieCryptoBot Class**: Main bot orchestrator
- **Message Processing**: Handles incoming Telegram messages
- **AI Integration**: Processes messages through Vercel AI SDK
- **Tool System**: Provides crypto operations through structured tool calling

#### 5. Vercel AI SDK Integration
The bot uses Vercel AI SDK for streamlined AI operations:
- **ToolLoopAgent**: Main agent loop for AI text generation with tools
- **dynamicTool()**: Bounded SDK tool types with explicit JSON schemas and Zod runtime validation
- **Multi-step Processing**: `stopWhen: isStepCount(5)` for complex operations
- **Type Safety**: Zod schema validation for tool parameters

#### 6. AI Tools System
The bot implements structured tools using Vercel AI SDK:
- **addBankAccount**: Bank account management with empty parameters
- **removeBankAccount**: Opens the owner-scoped saved-account removal Mini App
- **createSwap**: Cryptocurrency swapping with amount and coin validation
- **getWalletBalance**: Balance checking with coin symbol validation
- **getWalletAddress**: Deposit address generation with coin and network validation
- **getPortfolioSnapshot**: Deterministic, read-only available/locked balances and grouped activity; accepts no model-supplied identity
- **fetchAccountHistory**: Paginated immutable balance mutations with action, timestamp, transaction identity, and resulting balances

#### 6. Background Jobs (`jobs/`)
- **event.job.ts**: Typed queue producers that preserve queue wire contracts
- **listener.job.ts**: Small, single-initialization worker bootstrap/shutdown module
- **workers/**: One adapter per workflow, with typed Bull payloads
- **queue-registry.job.ts** / **queueNames.job.ts**: Queue contracts and names
- **redis.job.ts**: Shared Redis client configuration

Workers call services and handle only adapter concerns such as logging and
notifications. Queue names, deterministic IDs, five-attempt exponential retry,
completion/failure bookkeeping, and sequential shutdown are part of the
compatibility boundary.

#### 7. Middleware (`middlewares/`)
- **errorHandler.ts**: Global error handling
- **webhook.middleware.ts**: Webhook security middleware
- Request logging and validation
- CORS and security middleware

#### 8. Utilities (`library/` and `utils/`)
- **logging.utils.ts**: Centralized logging system
- **rateLimiter**: Rate limiting for API calls
- Helper functions and utilities

## Data Flow

### 1. User Interaction Flow
```
User → Telegram Message → Bot Handler → Rate Limiter → Message Router
```

### 2. Command Processing
```
Command → Command Handler → Database Query → Response Generation → Telegram API
```

### 3. AI Message Processing
```
User Message → Vercel AI SDK → generateText() → Tool Selection → Tool Execution → Response → User
```

#### Detailed AI Processing Flow
```
User Message → runCryptoAgent() → ToolLoopAgent({
  model: 'deepseek/deepseek-v4-pro-0813',
  prompt: userText,
  system: SYSTEM_PROMPT,
  stopWhen: isStepCount(5),
  tools: { addBankAccount, removeBankAccount, createSwap, getWalletBalance, getWalletAddress, getPortfolioSnapshot, ... }
}) → AI Tool Decision → Tool Execution → Formatted Response
```

### 4. Crypto Operations
```
AI Tool Call → Quidax API → Database Update → User Notification
```

## Key Features

### 1. Intelligent Message Processing
- Natural language understanding through Vercel AI SDK and OpenAI GPT-4
- Structured tool calling with type-safe parameter validation
- Multi-step conversation handling with an explicit `stopWhen` condition
- Context-aware responses with system prompts

### 2. Cryptocurrency Operations
- Real-time balance checking
- Crypto-to-fiat swapping
- Wallet address generation
- Read-only portfolio snapshots with available and locked balances
- Supported cryptocurrencies and networks:
  - USDC: ERC20, BEP20, Base
  - cNGN: Base, BEP20
  - USDT: BEP20, Celo, ERC20, TRC20

### 3. User Management
- Intent-based user tracking
- Signup flow integration
- Session management

### 4. Security Features
- Rate limiting per user
- Environment variable configuration
- Error handling and logging
- Input validation

## Database Schema

### PostgreSQL tables
- **users / intents**: User profiles, authentication data, and signup state
- **chat_messages**: Intent-scoped user/assistant history with idempotent Telegram ingestion and stable turn ordering
- **wallets / wallet_addresses**: Exact balances and normalized network addresses
- **deposits / swaps**: Financial history with UUID relations and exact decimals
- **account_versions**: Immutable available/locked balance history for deposits, swaps, and withdrawals
- **withdrawals**: Persistence-only direct wallet withdrawal records
- **banks**: Multiple accounts per user with one database-enforced default and soft deletion for historical withdrawal integrity
- **provider_events**: Idempotent webhook processing and reconciliation state

## External Integrations

### 1. Telegram Bot API
- Message receiving and sending
- Inline keyboards and web apps
- Chat action indicators

### 2. Vercel AI SDK
- `ToolLoopAgent` for AI text generation and bounded tool loops
- Structured tool calling with Zod validation
- Multi-step processing capabilities
- Type-safe AI integrations

### 3. Vercel AI Gateway
- DeepSeek model access through a provider-neutral model string
- Structured tool calling through AI SDK
- Gateway authentication through `AI_GATEWAY_API_KEY`

### 4. Quidax API
- Cryptocurrency trading operations
- Wallet management
- Real-time price data

### 5. PostgreSQL Database
- User data persistence
- Transaction history
- Configuration storage

### 6. Redis Cache
- Session management
- Rate limiting data
- Temporary data storage

## Configuration Management

### Environment Variables
- `PORT`: Application port
- `NODE_ENV`: Environment mode
- `TELEGRAM_BOT_TOKEN`: Telegram bot authentication
- `TELEGRAM_WEBHOOK_URL`: Public HTTPS Telegram update endpoint
- `TELEGRAM_WEBHOOK_SECRET`: Telegram webhook secret-token authentication
- `AI_GATEWAY_API_KEY`: Vercel AI Gateway access
- `AI_MODEL`: Gateway model identifier
- `QUIDAX_API_URL` & `QUIDAX_API_KEY`: Crypto exchange integration
- `DATABASE_URL`: PostgreSQL production connection string
- `TEST_DATABASE_URL`: Dedicated disposable PostgreSQL integration-test database
- `REDIS_URL`: Cache connection
- `CRYPTO_WEBHOOK_KEY`: Webhook security

## Deployment Architecture

### Development Environment
- Hot-reloading with `bun run dev`
- TypeScript compilation
- Environment variable loading

### Production Environment
- Built TypeScript to JavaScript
- Process management
- Error logging and monitoring

## Security Considerations

### 1. API Security
- Environment variable protection
- Rate limiting implementation
- Input sanitization

### 2. User Data Protection
- Secure database connections
- Encrypted sensitive data
- Access control mechanisms

### 3. Integration Security
- API key management
- Webhook signature verification
- Secure external communications

## Scalability Features

### 1. Modular Architecture
- Separated concerns
- Plugin-based extensions
- Service-oriented design

### 2. Caching Strategy
- Redis for frequently accessed data
- Database query optimization
- Response caching

### 3. Background Processing
- Job queue system
- Asynchronous operations
- Event-driven architecture

## Monitoring and Logging

### 1. Application Logging
- Structured logging with logging.utils
- Error tracking and reporting
- Performance monitoring
- Privacy-safe portfolio success/empty/error counters and aggregate latency; no identities or balances are recorded

### 2. Database Monitoring
- Connection health checks
- Query performance tracking
- Data integrity monitoring

## Future Enhancements

### 1. Additional Features
- More cryptocurrency exchanges
- Advanced trading strategies
- Fiat-valued portfolio analytics (the shipped base snapshot is deliberately read-only and unvalued)
- Price alerts and notifications

### 2. Technical Improvements
- Microservices architecture
- Container deployment
- Load balancing
- Health check endpoints

## Vercel AI SDK Implementation Details

### Tool Definition Structure
Each tool follows this pattern using Vercel AI SDK:

```typescript
toolName: tool({
  description: 'Clear description of what the tool does',
  inputSchema: z.object({
    paramName: z.string().describe("Parameter description")
  }),
  execute: async (params) => {
    // Tool implementation logic
    return result;
  }
})
```

### AI Processing Configuration
- **Model**: configurable Gateway model, defaulting to `deepseek/deepseek-v4-pro-0813`
- **Max Steps**: 5 steps for complex multi-tool operations
- **System Prompts**: Structured prompts for consistent AI behavior
- **Parameter Validation**: Zod schemas ensure type safety

### Tool Parameter Validation
- **String Validation**: `.string()` for text inputs
- **Case Transformation**: `.toUpperCase()`, `.toLowerCase()` for consistency
- **Descriptive Schema**: Clear parameter descriptions for AI understanding

## Development Workflow

### 1. Code Organization
- TypeScript for type safety
- Modular file structure
- Clear separation of concerns

### 2. Testing Strategy
- Unit tests for business logic
- Integration tests for APIs
- End-to-end testing for user flows

### 3. Build Process
- TypeScript compilation
- Dependency management
- Environment configuration
