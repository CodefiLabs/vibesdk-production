# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is Cloudflare VibeSDK - an AI-powered webapp generator built on Cloudflare's full-stack platform. The system features a React+Vite frontend and Cloudflare Workers backend with Durable Object-based AI agents that build webapps phase-wise from user prompts.

**Core Stack:**
- **Frontend**: React 19, Vite (Rolldown), TypeScript, Tailwind CSS 4, shadcn/ui components
- **Backend**: Cloudflare Workers (Hono framework), Durable Objects for stateful AI agents
- **Database**: D1 (SQLite) with Drizzle ORM
- **Containers**: Cloudflare Containers for sandboxed app execution
- **AI Integration**: Multiple LLM providers (Anthropic, OpenAI, Google) via AI Gateway
- **Deployment**: Workers for Platforms with dispatch namespaces for generated apps

## Development Commands

### Frontend Development
```bash
npm run dev              # Start Vite dev server with hot reload
npm run build            # Build production frontend (TypeScript + Vite)
npm run lint             # Run ESLint
npm run preview          # Preview production build
```

### Worker Development
```bash
npm run local            # Run Worker locally with Wrangler (uses local bindings)
npm run dev:worker       # Build + run Worker with remote bindings (port 5173)
npm run dev:remote       # Build + run Worker with full remote setup
npm run cf-typegen       # Generate TypeScript types for Cloudflare bindings
npm run deploy           # Deploy to Cloudflare Workers (reads .prod.vars)
```

### Database (D1)
```bash
npm run db:setup         # Initial database setup
npm run db:generate      # Generate migrations from schema (local)
npm run db:generate:remote # Generate migrations for remote
npm run db:migrate:local # Apply migrations to local D1
npm run db:migrate:remote # Apply migrations to production D1
npm run db:push:local    # Push schema changes directly (local)
npm run db:push:remote   # Push schema changes directly (remote)
npm run db:studio        # Open Drizzle Studio for local DB
npm run db:studio:remote # Open Drizzle Studio for remote DB
npm run db:drop          # Drop schema (local)
```

### Testing
```bash
npm run test             # Run Vitest tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
```

### Code Quality
```bash
npm run knip             # Find unused files, dependencies, and exports
npm run knip:fix         # Auto-fix knip issues
npm run knip:production  # Check production dependencies only
```

## Core Architecture

### AI Code Generation System
The heart of the application is the **Durable Object-based code generator** that creates webapps through sophisticated AI orchestration:

#### Key Components

**1. Code Generator Agent (`worker/agents/core/`)**
- `SmartCodeGeneratorAgent` (extends `SimpleCodeGeneratorAgent`): Main Durable Object for code generation
- `state.ts`: Generation state management with typed states (`CodeGenState`, `FileState`, `PhaseState`)
- `websocket.ts`: WebSocket protocol for real-time frontend updates
- Two modes: `'deterministic'` (state machine-based) and `'smart'` (LLM orchestrator - WIP)

**2. Generation Operations (`worker/agents/operations/`)**
- `PhaseGeneration.ts`: Creates development phases from blueprint
- `PhaseImplementation.ts`: Implements code for each phase
- `CodeReview.ts`: Automated code review and error detection
- `FastCodeFixer.ts`: Quick error fixes during generation
- `FileRegeneration.ts`: Regenerates specific files when needed
- `UserConversationProcessor.ts`: Handles user chat interactions
- `ScreenshotAnalysis.ts`: Analyzes UI screenshots for visual feedback

**3. Output Formats (`worker/agents/output-formats/`)**
- **Streaming Formats**:
  - `scof.ts` (Shell Command Output Format): Streams generated code with file boundaries
  - `xml-stream.ts`: XML-based streaming format
- **Diff Formats**:
  - `udiff.ts`: Unified diff format for file updates
  - `search-replace.ts`: Search-replace based updates

**4. Planning & Blueprint (`worker/agents/planning/`)**
- `blueprint.ts`: Creates project blueprints from user prompts (PRD generation)
- `templateSelector.ts`: Selects appropriate starter templates
- Templates sourced from `TEMPLATES_REPOSITORY` (env var)

**5. Inference System (`worker/agents/inferutils/`)**
- `infer.ts`: Main inference execution with retries and error handling
- `config.ts`: Model configuration and provider selection
- `core.ts`: Core inference logic with streaming support
- `schemaFormatters.ts`: Zod schema to prompt formatting
- Supports structured outputs with Zod schemas

### Sandbox System (`worker/services/sandbox/`)
The sandbox system executes generated code in isolated Cloudflare Containers:

- **Durable Objects**: `UserAppSandboxService` manages container lifecycle
- **Preview URLs**: Apps accessible at `{appId}.{CUSTOM_DOMAIN}`
- **Instance Types**: Configurable via `SANDBOX_INSTANCE_TYPE` env var (dev, basic, standard, enhanced)
- **Resource Provisioning**: Automated container creation and management
- **Template System**: Templates parsed and injected into containers

### Database Schema (`worker/database/schema.ts`)
Comprehensive schema with:
- **Users & Auth**: `users`, `sessions`, `apiKeys` tables
- **Applications**: `apps` table with generation metadata
- **Analytics**: `costs`, `analytics`, `runtimeUsages` for tracking
- **Model Configs**: User-specific LLM configurations
- **GitHub Integration**: Repository export tracking

### Frontend Architecture (`src/`)

**Key Routes:**
- `/` - Home page
- `/chat/:appId` - Main code generation interface with live preview
- `/apps` - User's application list
- `/app/:appId` - Individual app view
- `/discover` - Public app discovery
- `/settings` - User settings and model configuration

**State Management:**
- `src/contexts/auth-context.tsx` - Authentication state
- `src/contexts/apps-data-context.tsx` - Applications data
- `src/contexts/theme-context.tsx` - Theme management

**WebSocket Communication:**
- `src/routes/chat/hooks/use-chat.ts` - Main WebSocket handler for generation updates
- `src/routes/chat/hooks/use-file-content-stream.ts` - Streaming file content updates

### Routing Architecture (`worker/index.ts`)

**Domain-based Routing:**
1. **Main Platform** (`CUSTOM_DOMAIN` or `localhost`):
   - Static assets: `ASSETS` binding (Vite dist)
   - API routes: Hono app at `/api/*`

2. **User Apps** (`*.{CUSTOM_DOMAIN}` or `*.localhost`):
   - First attempts sandbox proxy for live development
   - Falls back to dispatch namespace for deployed apps
   - Isolated execution per subdomain

3. **Security**: Rejects IP-based requests, requires domain names

### API Structure (`worker/api/`)

**Controller Pattern:**
- `controllers/agent/` - Code generation endpoints
- `controllers/apps/` - App CRUD operations
- `controllers/auth/` - Authentication (OAuth + JWT)
- `controllers/analytics/` - Usage analytics
- `controllers/modelConfig/` - LLM configuration
- `controllers/secrets/` - Encrypted secrets management
- `controllers/githubExporter/` - GitHub repository export

**Routes** (`worker/api/routes/`):
- RESTful endpoints with type-safe Hono bindings
- WebSocket upgrade at `/api/agent/:agentId/ws`

## Environment Configuration

### Local Development (`.dev.vars`)
Required for `npm run local`:
```bash
GOOGLE_AI_STUDIO_API_KEY=""      # Required for AI generation
JWT_SECRET=""                     # Session management
WEBHOOK_SECRET=""                 # Webhook authentication
ANTHROPIC_API_KEY=""             # Optional: Claude models
OPENAI_API_KEY=""                # Optional: GPT models
GOOGLE_CLIENT_ID=""              # Optional: Google OAuth
GOOGLE_CLIENT_SECRET=""          # Optional: Google OAuth
GITHUB_CLIENT_ID=""              # Optional: GitHub OAuth
GITHUB_CLIENT_SECRET=""          # Optional: GitHub OAuth
```

### Production Deployment (`.prod.vars`)
Used by `npm run deploy`:
- Same variables as `.dev.vars`
- `CLOUDFLARE_AI_GATEWAY_TOKEN=""` - Auto-creates AI Gateway if has read/edit/run permissions
- `CLOUDFLARE_API_TOKEN=""` - Cloudflare API access (optional, auto-provided by Workers Builds)
- `CLOUDFLARE_ACCOUNT_ID=""` - Account ID (optional, auto-provided)

### Wrangler Configuration (`wrangler.jsonc`)
Key bindings configured:
- `AI` - Cloudflare AI binding
- `DB` - D1 database binding
- `CodeGenObject` - Code generator Durable Object
- `Sandbox` - Sandbox Durable Object
- `DISPATCHER` - Workers for Platforms dispatch namespace
- `TEMPLATES_BUCKET` - R2 bucket for templates
- `VibecoderStore` - KV namespace
- `ASSETS` - Static asset serving
- Rate limiters: `API_RATE_LIMITER`, `AUTH_RATE_LIMITER`

## Development Workflow

### Adding New Generation Features
1. Modify generation logic in `worker/agents/operations/`
2. Update state types in `worker/agents/core/state.ts`
3. Add WebSocket message types in `worker/agents/core/websocket.ts`
4. Update frontend handler in `src/routes/chat/hooks/use-chat.ts`
5. Update prompts in `worker/agents/prompts.ts` if needed

### Working with Durable Objects
- **State Persistence**: Automatic via Cloudflare platform
- **ID Generation**: Based on session/user context (`worker/agents/utils/idGenerator.ts`)
- **Migrations**: Defined in `wrangler.jsonc` migrations array
- **Testing**: Use `@cloudflare/vitest-pool-workers` for DO tests

### Database Migrations
1. Modify schema in `worker/database/schema.ts`
2. Run `npm run db:generate` to create migration
3. Apply with `npm run db:migrate:local` (local) or `npm run db:migrate:remote` (prod)
4. Use `npm run db:studio` to inspect database

### Template System
- Templates stored in R2 bucket (`TEMPLATES_BUCKET`)
- Repository URL in `TEMPLATES_REPOSITORY` env var
- Templates parsed in `worker/services/sandbox/templateParser.ts`
- Selected via `worker/agents/planning/templateSelector.ts`

## Important Patterns

### Cloudflare-Specific
- **D1 Performance**: Use batch operations, avoid sequential queries
- **Durable Object State**: Use `this.ctx.storage` for persistence
- **Bindings**: Always access via `env` parameter, never global
- **Service Bindings**: Type-safe RPC between Workers
- **Container Limits**: Respect `MAX_SANDBOX_INSTANCES` env var

### Code Quality
- **No `any` types**: Find or create proper types
- **No dynamic imports**: Use static imports only
- **DRY Principle**: Strictly follow, avoid duplication
- **Comments**: Professional, explain "why" not "what", no change logs in comments

### Testing Strategy
- Unit tests for pure functions (domain logic, utilities)
- Integration tests for Durable Objects with Vitest workers pool
- E2E tests for generation workflow (not yet implemented)
- Current tests may be AI-generated - verify before trusting

## Debugging

### Code Generation Issues
1. Check Durable Object logs: `npm run local` and watch console
2. Inspect WebSocket messages: Browser DevTools → Network → WS
3. Review generation state: `worker/agents/core/state.ts` types
4. Check template selection: Verify `TEMPLATES_REPOSITORY` accessible

### Sandbox Issues
1. Verify container binding: `env.Sandbox` available
2. Check instance type: `SANDBOX_INSTANCE_TYPE` in wrangler.jsonc
3. Review container logs: Sandbox Durable Object console output
4. Test preview URL: `{appId}.{CUSTOM_DOMAIN}` resolves correctly

### Database Issues
1. Local: `npm run db:studio` to inspect
2. Remote: `npm run db:studio:remote`
3. Check migrations: `wrangler d1 migrations list vibesdk-db`
4. Reset local: `npm run db:drop && npm run db:generate && npm run db:migrate:local`

## Deployment

### First-Time Setup
1. Set environment variables in `.prod.vars`
2. Create D1 database: Auto-created by deploy script
3. Create AI Gateway: Auto-created if `CLOUDFLARE_AI_GATEWAY_TOKEN` provided
4. Configure custom domain: Set `CUSTOM_DOMAIN` in wrangler.jsonc
5. Deploy: `npm run deploy`

### Regular Deployments
- Pushing to `main` triggers automatic deployment (CI/CD configured)
- Manual: `npm run deploy` (uses `.prod.vars`)
- Database migrations: Automatically applied during deploy

### DNS Configuration
For preview apps to work:
1. Add CNAME record: `*.{subdomain}` → `{CUSTOM_DOMAIN}`
2. Enable Cloudflare proxy (orange cloud)
3. Wait for DNS propagation (up to 1 hour)

## Special Considerations

### Workers for Platforms
- Requires separate Cloudflare subscription
- Apps deployed to `DISPATCH_NAMESPACE` (wrangler.jsonc)
- Each generated app gets isolated worker in namespace
- Preview during development uses Containers, production uses dispatch

### AI Gateway
- Unified interface for multiple LLM providers
- Caches responses, tracks usage, enforces rate limits
- Created automatically if `CLOUDFLARE_AI_GATEWAY_TOKEN` provided
- Gateway name in `CLOUDFLARE_AI_GATEWAY` env var

### Container Instance Types
- `dev`: Minimal (256MB, 1/16 vCPU) - development only
- `basic`: Light (1GB, 1/4 vCPU) - simple apps
- `standard`: Recommended (4GB, 1/2 vCPU) - most apps
- `enhanced`: High-performance (4GB, 4 vCPUs) - Enterprise only

### Security
- OAuth flows: Google, GitHub
- JWT sessions: Managed in D1 `sessions` table
- API keys: Encrypted in `secrets` table
- Rate limiting: DO-based + namespace-based limiters
- Input validation: Zod schemas throughout

## Common Gotchas

1. **Vite Override**: Uses `rolldown-vite` in package.json overrides (faster builds)
2. **TypeScript Configs**: Multiple configs (app, node, worker) - use correct one
3. **Import Paths**: Worker uses absolute imports, frontend uses relative/aliased
4. **Prettier Config**: Uses tabs, single quotes (in package.json)
5. **Bindings Access**: Always via `env` parameter, types in `worker-configuration.d.ts`
6. **D1 Limits**: 100k rows/query, use pagination
7. **Container Lifecycle**: Sandboxes auto-terminate after inactivity
8. **Preview URLs**: Require wildcard DNS, may take time to propagate
