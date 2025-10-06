---
date: 2025-10-06T14:49:26+0000
researcher: Claude
git_commit: 845c415fee562180aafcbd2ce765bc4eb5104950
branch: api
repository: vibesdk-production
topic: "Secure API Design for User Management, Project Creation, and Status Tracking"
tags: [research, codebase, api, authentication, security, project-creation, status-tracking]
status: complete
last_updated: 2025-10-06
last_updated_by: Claude
---

# Research: Secure API Design for User Management, Project Creation, and Status Tracking

**Date**: 2025-10-06T14:49:26+0000
**Researcher**: Claude
**Git Commit**: 845c415fee562180aafcbd2ce765bc4eb5104950
**Branch**: api
**Repository**: vibesdk-production

## Research Question

Design a secure API for the VibeSDK application with the following endpoints:
1. User management endpoint that creates a user based on email, or returns existing user info
2. Project creation endpoint that accepts instructions and starts the build process (like the web interface)
3. Project status endpoint that provides project information and preview URL
4. Identify additional immediate endpoints that might be needed

## Summary

The VibeSDK currently has a comprehensive authentication and API infrastructure built on Cloudflare Workers with JWT sessions, OAuth providers, API keys, and rate limiting. The existing web interface uses JWT authentication, but a programmatic API would require API key-based authentication for machine-to-machine access.

**Key Findings:**
- **Authentication Layer**: Three-tier system exists (public, authenticated, owner-only) with middleware at `worker/middleware/auth/`
- **API Pattern**: RESTful controllers extending `BaseController` with standardized error handling
- **User Management**: Complete service at `worker/database/services/UserService.ts` and `AuthService.ts`
- **Project Creation**: Existing at `POST /api/agent` via `CodingAgentController.startCodeGeneration()`
- **Status Tracking**: Database fields in `apps` table + Durable Object state for real-time progress
- **API Keys**: Infrastructure exists at `worker/database/services/ApiKeyService.ts` but not actively used for authentication
- **Rate Limiting**: Comprehensive implementation with Durable Object and KV backends

**Recommended Approach**: Create a new API router (`/api/v1/...`) with API key authentication middleware specifically for programmatic access, leveraging existing services and patterns.

## Detailed Findings

### 1. Existing Authentication Infrastructure

#### JWT Session-Based Authentication
**Location**: `worker/middleware/auth/auth.ts:13-76`

The current web interface uses JWT tokens with session validation:
- JWT tokens contain session ID (not full user data)
- Sessions stored in D1 `sessions` table
- Middleware validates JWT signature + checks session existence
- User attached to request context via `context.user`

#### API Key Infrastructure (Underutilized)
**Location**: `worker/database/services/ApiKeyService.ts`

API key infrastructure exists but is not currently integrated into authentication middleware:
- `apiKeys` table stores keys with scopes, usage tracking, expiration
- `ApiKeyService` provides CRUD operations
- Schema includes: `key` (hashed), `name`, `lastUsedAt`, `expiresAt`, `userId`
- **Missing**: Middleware to validate API keys for programmatic access

#### OAuth Providers
**Locations**:
- `worker/services/oauth/google.ts` - Google OAuth
- `worker/services/oauth/github.ts` - GitHub OAuth
- Used for user registration and login in web interface

#### Rate Limiting
**Location**: `worker/services/rate-limit/rateLimits.ts`

Comprehensive rate limiting with multiple strategies:
- `enforceAuthRateLimit()` - General authenticated requests
- `enforceAppCreationRateLimit()` - Project creation (more restrictive)
- Storage backends: Durable Object (`DORateLimitStore.ts`) or KV (`KVRateLimitStore.ts`)
- Configuration at `worker/services/rate-limit/config.ts`

### 2. User Management Services

#### UserService
**Location**: `worker/database/services/UserService.ts`

Comprehensive user CRUD operations:
- `createUser(userData)` - Create new user with validation
- `getUserById(id)` - Retrieve user by ID
- `getUserByEmail(email)` - Retrieve user by email
- `updateUser(id, updates)` - Update user fields
- `deleteUser(id)` - Soft or hard delete

**Database Schema** (`worker/database/schema.ts:5-64`):
```typescript
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    email: text('email').unique().notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
    passwordHash: text('password_hash'),
    provider: text('provider'), // 'google', 'github', 'email'
    providerId: text('provider_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    // ... additional fields
});
```

#### AuthService
**Location**: `worker/database/services/AuthService.ts`

Authentication operations:
- `registerUser(email, password, displayName)` - Email/password registration
- `authenticateUser(email, password)` - Login validation
- `createOrUpdateOAuthUser(provider, profile)` - OAuth user creation
- Password hashing via `worker/utils/passwordService.ts` (bcrypt)

### 3. Project Creation Flow

#### Existing Endpoint
**Location**: `worker/api/controllers/agent/controller.ts:33-162`

**Route**: `POST /api/agent`
**Authentication**: JWT required (`AuthConfig.authenticated`)
**Rate Limit**: `enforceAppCreationRateLimit()` (5 apps per hour default)

**Request Body** (`CodeGenArgs`):
```typescript
{
    query: string,              // Required: Project description
    language?: string,          // Optional: Default 'typescript'
    frameworks?: string[],      // Optional: Default ['react', 'vite']
    selectedTemplate?: string,  // Optional: Default 'auto'
    agentMode?: 'deterministic' | 'smart'  // Optional: Default 'deterministic'
}
```

**Response**: NDJSON streaming response with:
1. Initial message with `agentId`, `websocketUrl`, `httpStatusUrl`, `template` data
2. Streaming blueprint chunks as generation progresses
3. Terminates when blueprint complete

**Process Flow**:
1. Generate unique `agentId` via `generateId()`
2. Fetch user model configurations from database
3. AI-powered template selection via `selectTemplate()` (analyzes query against available templates)
4. Create Durable Object agent stub
5. Initialize agent with `agentInstance.initialize()`
6. Blueprint generation (streams back to client via NDJSON)
7. Parallel operations: sandbox deployment, setup commands, README generation
8. Database record creation in `apps` table with `status: 'generating'`
9. Return WebSocket URL for real-time code generation updates

**Database Record** (`worker/database/schema.ts:133-193`):
```typescript
export const apps = sqliteTable('apps', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    originalPrompt: text('original_prompt').notNull(),
    framework: text('framework'),
    visibility: text('visibility').default('private'), // 'private' | 'public'
    status: text('status').default('generating'),     // 'generating' | 'completed'
    deploymentId: text('deployment_id'),              // Production deployment ID
    screenshotUrl: text('screenshot_url'),
    githubRepositoryUrl: text('github_repository_url'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    // ... additional fields
});
```

#### Code Generation Agent
**Location**: `worker/agents/core/simpleGeneratorAgent.ts`

Durable Object-based stateful agent:
- **State Machine**: Tracks generation phase (`IDLE`, `PHASE_GENERATING`, `PHASE_IMPLEMENTING`, `REVIEWING`, etc.)
- **Persistence**: State stored in Durable Object storage, survives restarts
- **WebSocket Protocol**: Real-time updates via WebSocket messages (`FILE_GENERATING`, `FILE_GENERATED`, `PHASE_STARTED`, etc.)
- **Operations**: Modular operation classes for phases, implementation, review, fixes

**WebSocket Connection**:
**Route**: `GET /api/agent/:agentId/ws`
**Location**: `worker/api/controllers/agent/controller.ts:168-240`
- Upgrades HTTP to WebSocket
- Validates origin and authentication
- Proxies connection to Durable Object
- Agent handles bidirectional communication

### 4. Project Status Tracking

#### Status Endpoint
**Location**: `worker/api/controllers/appView/controller.ts:19-86`

**Route**: `GET /api/app/:id`
**Authentication**: Public read, owner required for private apps

**Response Structure**:
```typescript
{
    ...appResult,  // All database fields from apps table
    cloudflareUrl: string,  // Production URL if deployed
    previewUrl: string,     // Preview or production URL
    user: {
        id: string,
        displayName: string,
        avatarUrl: string
    },
    agentSummary?: {  // Live generation state (if agent active)
        generatedFilesCount: number,
        totalFilesCount: number,
        phases: PhaseState[],
        currentDevState: string,
        mvpGenerated: boolean,
        // ... other runtime data
    }
}
```

**Data Sources**:
1. **Database** (`apps` table): Persistent project metadata, status, deployment IDs
2. **Durable Object Agent**: Live generation state if agent is active
3. **Preview URL**: Retrieved from agent cache via `getPreviewUrlCache()`
4. **Production URL**: Constructed from `deploymentId` via `buildUserWorkerUrl()`

#### Status Fields in Database

**Core Status**:
- `status`: `'generating'` or `'completed'`
- `deploymentId`: Cloudflare Workers deployment ID
- `visibility`: `'private'` or `'public'`

**URLs**:
- `screenshotUrl`: Screenshot of deployed app
- `githubRepositoryUrl`: GitHub export URL (if exported)
- Preview URL: Constructed from sandbox instance ID (not persisted in DB)
- Production URL: `${deploymentId}.${CUSTOM_DOMAIN}`

**Timestamps**:
- `createdAt`: Project creation timestamp
- `updatedAt`: Last modification timestamp
- `lastDeployedAt`: Last production deployment timestamp
- `screenshotCapturedAt`: Last screenshot capture timestamp

#### Real-Time Progress (Durable Object State)
**Location**: `worker/agents/core/state.ts:32-61`

```typescript
interface CodeGenState {
    query: string,
    blueprint: Blueprint,
    generatedFilesMap: Record<string, FileState>,  // File-level tracking
    generatedPhases: PhaseState[],                  // Phase completion
    templateDetails: TemplateDetails,
    currentDevState: CurrentDevState,               // IDLE, PHASE_GENERATING, etc.
    mvpGenerated: boolean,
    reviewingInitiated: boolean,
    reviewCycles: number,
    sandboxInstanceId: string | undefined,          // Preview container ID
    shouldBeGenerating: boolean,                    // Resume flag
    // ... additional fields
}
```

**WebSocket Updates**:
- `cf_agent_state` - Full state snapshot (periodic sync)
- `generation_started` - Generation begins
- `file_generating` - File creation started
- `file_generated` - File creation complete
- `phase_started` - Phase begins
- `phase_completed` - Phase finished
- `deployment_started` - Preview deployment begins
- `deployment_completed` - Preview deployment done (includes `previewURL`, `tunnelURL`)
- `generation_complete` - All generation finished

### 5. Existing API Patterns

#### Controller Pattern
**Base**: `worker/api/controllers/baseController.ts`

All controllers extend `BaseController` which provides:
- `createSuccessResponse<T>(data: T)` - Standardized success response
- `createErrorResponse<T>(message, statusCode)` - Standardized error response
- `parseJsonBody<T>(request)` - JSON parsing with error handling
- `getOptionalUser(request, env)` - Optional authentication for public endpoints
- Logger instance for structured logging

**Standard Response Format**:
```typescript
interface ApiResponse<T> {
    success: boolean,
    data?: T,
    error?: {
        message: string,
        name: string,
        type?: SecurityErrorType
    },
    message?: string
}
```

#### Route Definition Pattern
**Example**: `worker/api/routes/appRoutes.ts`

```typescript
import { Hono } from 'hono';
import { adaptController } from '../controllerAdapter';
import { setAuthLevel, AuthConfig } from '../../middleware/auth/routeAuth';

const appRouter = new Hono<AppEnv>();

// Public endpoint
appRouter.get('/discover',
    setAuthLevel(AuthConfig.public),
    adaptController(AppController, AppController.getPublicApps)
);

// Authenticated endpoint
appRouter.get('/',
    setAuthLevel(AuthConfig.authenticated),
    adaptController(AppController, AppController.getUserApps)
);

// Owner-only endpoint
appRouter.delete('/:id',
    setAuthLevel(AuthConfig.ownerOnly),
    adaptController(AppController, AppController.deleteApp)
);
```

#### Authentication Levels
**Location**: `worker/middleware/auth/routeAuth.ts`

Three levels defined in `AuthConfig`:
- `public` - No authentication required
- `authenticated` - User must be logged in (JWT validation)
- `ownerOnly` - User must be logged in AND own the resource

**Ownership Verification**:
```typescript
async function checkAppOwnership(
    userId: string,
    appId: string,
    env: Env
): Promise<{ success: boolean; response?: Response }> {
    const appService = new AppService(env);
    const app = await appService.getAppById(appId);

    if (!app) {
        return { success: false, response: errorResponse('App not found', 404) };
    }

    if (app.userId !== userId) {
        return { success: false, response: errorResponse('Access denied', 403) };
    }

    return { success: true };
}
```

## Recommended API Design

Based on the research, here's the recommended approach for the new secure API:

### Architecture Overview

**Create a new API router**: `/api/v1/` (versioned for future compatibility)
**Authentication**: API key-based (for machine-to-machine access)
**Authorization**: Key scoped to user, operations limited by ownership
**Rate Limiting**: Reuse existing `RateLimitService` with API key context

### Required Endpoints

#### 1. User Management

**POST /api/v1/users/find-or-create**
- **Purpose**: Find existing user by email or create new user
- **Authentication**: API key required
- **Request Body**:
  ```typescript
  {
      email: string,
      displayName?: string,
      metadata?: Record<string, any>
  }
  ```
- **Response**:
  ```typescript
  {
      success: true,
      data: {
          user: {
              id: string,
              email: string,
              displayName: string,
              createdAt: string,
              isNew: boolean  // true if just created
          }
      }
  }
  ```
- **Implementation Notes**:
  - Use `UserService.getUserByEmail()` to check existence
  - If not found, use `UserService.createUser()` with `provider: 'api'`
  - Generate secure user ID via `generateId()`
  - Rate limit: 100 requests per hour per API key

**GET /api/v1/users/:id**
- **Purpose**: Get user details by ID
- **Authentication**: API key required
- **Authorization**: API key owner only or the user themselves
- **Response**: User object with apps count, registration date

#### 2. Project Management

**POST /api/v1/projects**
- **Purpose**: Create new project and start build process
- **Authentication**: API key required
- **Request Body**:
  ```typescript
  {
      userId: string,        // User ID from find-or-create
      instructions: string,   // Project description (maps to 'query')
      language?: string,      // Default: 'typescript'
      frameworks?: string[],  // Default: ['react', 'vite']
      template?: string,      // Default: 'auto'
      webhookUrl?: string,    // Optional: callback for status updates
      metadata?: Record<string, any>
  }
  ```
- **Response**:
  ```typescript
  {
      success: true,
      data: {
          projectId: string,  // agentId
          status: 'generating',
          websocketUrl: string,
          statusUrl: string,
          createdAt: string,
          estimatedCompletionTime?: string  // Based on historical data
      }
  }
  ```
- **Implementation Notes**:
  - Reuse `CodingAgentController.startCodeGeneration()` logic
  - Verify user exists and API key has permission
  - Store webhook URL in app metadata for callbacks
  - Return immediately with connection info (don't wait for completion)
  - Rate limit: 10 projects per hour per API key

**GET /api/v1/projects/:id**
- **Purpose**: Get project status and details
- **Authentication**: API key required
- **Authorization**: API key owner only or project owner
- **Response**:
  ```typescript
  {
      success: true,
      data: {
          project: {
              id: string,
              userId: string,
              title: string,
              description: string,
              status: 'generating' | 'completed',
              previewUrl: string | null,
              productionUrl: string | null,
              progress?: {
                  currentPhase: string,
                  filesGenerated: number,
                  totalFiles: number,
                  percentComplete: number
              },
              createdAt: string,
              completedAt: string | null,
              error?: string
          }
      }
  }
  ```
- **Implementation Notes**:
  - Combine data from `apps` table and Durable Object agent state
  - Reuse `AppViewController.getAppDetails()` logic
  - Include real-time progress if agent is still generating
  - Rate limit: 100 requests per hour per API key

**GET /api/v1/projects**
- **Purpose**: List projects for a user
- **Authentication**: API key required
- **Query Parameters**:
  - `userId` - User ID to filter by
  - `status` - Filter by status ('generating', 'completed')
  - `limit` - Page size (default: 20, max: 100)
  - `offset` - Page offset (default: 0)
- **Response**: Paginated list of projects with summary info

**DELETE /api/v1/projects/:id**
- **Purpose**: Delete a project
- **Authentication**: API key required
- **Authorization**: API key owner AND project owner
- **Implementation Notes**:
  - Reuse `AppController.deleteApp()` logic
  - Also stop any active generation (set `shouldBeGenerating: false`)
  - Rate limit: 50 requests per hour per API key

**POST /api/v1/projects/:id/stop**
- **Purpose**: Stop active generation
- **Authentication**: API key required
- **Authorization**: API key owner AND project owner
- **Implementation**: Send `STOP_GENERATION` WebSocket message to agent

**POST /api/v1/projects/:id/resume**
- **Purpose**: Resume stopped generation
- **Authentication**: API key required
- **Authorization**: API key owner AND project owner
- **Implementation**: Send `RESUME_GENERATION` WebSocket message to agent

#### 3. API Key Management

**POST /api/v1/api-keys**
- **Purpose**: Create new API key
- **Authentication**: JWT required (user must be logged in via web interface)
- **Request Body**:
  ```typescript
  {
      name: string,           // Descriptive name for key
      scopes?: string[],      // Permissions (default: ['projects:create', 'projects:read'])
      expiresAt?: string      // ISO date (default: never)
  }
  ```
- **Response**:
  ```typescript
  {
      success: true,
      data: {
          apiKey: string,  // Only returned once! Raw key (not hashed)
          id: string,
          name: string,
          scopes: string[],
          createdAt: string,
          expiresAt: string | null
      },
      message: "Store this API key securely - it won't be shown again"
  }
  ```
- **Implementation Notes**:
  - Generate secure random key: `crypto.randomBytes(32).toString('base64url')`
  - Store hashed version in database via `ApiKeyService.createApiKey()`
  - Return raw key only in creation response
  - Rate limit: 10 keys per hour per user

**GET /api/v1/api-keys**
- **Purpose**: List user's API keys
- **Authentication**: JWT required
- **Response**: List of keys (without raw key values)

**DELETE /api/v1/api-keys/:id**
- **Purpose**: Revoke API key
- **Authentication**: JWT required
- **Authorization**: Key owner only

#### 4. Webhook Management

**POST /api/v1/webhooks**
- **Purpose**: Configure webhook for status updates
- **Authentication**: API key required
- **Request Body**:
  ```typescript
  {
      url: string,
      events: string[],  // ['project.started', 'project.completed', 'project.failed']
      secret: string     // For HMAC signature validation
  }
  ```

**POST /api/v1/webhooks/test**
- **Purpose**: Send test webhook
- **Authentication**: API key required

#### 5. Additional Utility Endpoints

**GET /api/v1/templates**
- **Purpose**: List available project templates
- **Authentication**: Public or API key
- **Response**: Array of template metadata (name, description, frameworks, preview image)

**GET /api/v1/usage**
- **Purpose**: Get API usage statistics
- **Authentication**: API key required
- **Response**: Request counts, rate limits, project counts, costs

**GET /api/v1/health**
- **Purpose**: API health check
- **Authentication**: Public
- **Response**: `{ status: 'healthy', version: '1.0.0' }`

### Implementation Plan

#### Step 1: Create API Key Authentication Middleware

**File**: `worker/middleware/auth/apiKeyAuth.ts`

```typescript
import { Context } from 'hono';
import { AppEnv } from '../../types/appenv';
import { ApiKeyService } from '../../database/services/ApiKeyService';
import { errorResponse } from '../../api/responses';
import { sha256 } from '../../utils/cryptoUtils';

export async function apiKeyAuthMiddleware(c: Context<AppEnv>): Promise<Response | undefined> {
    // Extract API key from Authorization header
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
        return errorResponse('API key required', 401);
    }

    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
        return errorResponse('Invalid Authorization header format. Expected: Bearer <api_key>', 401);
    }

    const apiKey = match[1];

    // Hash the API key for database lookup
    const apiKeyHash = await sha256(apiKey);

    // Validate API key
    const apiKeyService = new ApiKeyService(c.env);
    const keyRecord = await apiKeyService.getApiKeyByHash(apiKeyHash);

    if (!keyRecord) {
        return errorResponse('Invalid API key', 401);
    }

    // Check expiration
    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
        return errorResponse('API key expired', 401);
    }

    // Update last used timestamp
    await apiKeyService.updateLastUsed(keyRecord.id);

    // Attach user to context (load from userId)
    const userService = new UserService(c.env);
    const user = await userService.getUserById(keyRecord.userId);

    if (!user) {
        return errorResponse('User not found', 401);
    }

    c.set('user', user);
    c.set('apiKey', keyRecord);

    return undefined; // Continue to handler
}
```

#### Step 2: Create API Router

**File**: `worker/api/routes/v1/index.ts`

```typescript
import { Hono } from 'hono';
import { apiKeyAuthMiddleware } from '../../../middleware/auth/apiKeyAuth';
import { AppEnv } from '../../../types/appenv';

const v1Router = new Hono<AppEnv>();

// Apply API key auth to all /api/v1 routes except health
v1Router.use('/*', async (c, next) => {
    // Skip auth for health check
    if (c.req.path === '/api/v1/health') {
        return next();
    }

    const result = await apiKeyAuthMiddleware(c);
    if (result) {
        return result;
    }
    return next();
});

// Import and mount sub-routers
import usersRouter from './usersRoutes';
import projectsRouter from './projectsRoutes';
import apiKeysRouter from './apiKeysRoutes';
import webhooksRouter from './webhooksRoutes';

v1Router.route('/users', usersRouter);
v1Router.route('/projects', projectsRouter);
v1Router.route('/api-keys', apiKeysRouter);
v1Router.route('/webhooks', webhooksRouter);

// Health check
v1Router.get('/health', (c) => {
    return c.json({
        success: true,
        data: {
            status: 'healthy',
            version: '1.0.0',
            timestamp: new Date().toISOString()
        }
    });
});

export default v1Router;
```

#### Step 3: Create Controllers

**File**: `worker/api/controllers/v1/usersController.ts`

```typescript
import { BaseController } from '../baseController';
import { UserService } from '../../../database/services/UserService';
import { generateId } from '../../../utils/idGenerator';
import type { RouteContext, ControllerResponse, ApiResponse } from '../../types/route-context';

export class V1UsersController extends BaseController {
    static async findOrCreateUser(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<{ user: any; isNew: boolean }>>> {
        try {
            const bodyResult = await V1UsersController.parseJsonBody<{
                email: string;
                displayName?: string;
                metadata?: Record<string, any>;
            }>(request);

            if (!bodyResult.success) {
                return bodyResult.response!;
            }

            const { email, displayName, metadata } = bodyResult.data!;

            // Validate email
            if (!email || !email.includes('@')) {
                return V1UsersController.createErrorResponse(
                    'Valid email is required',
                    400
                );
            }

            const userService = new UserService(env);

            // Try to find existing user
            let user = await userService.getUserByEmail(email);
            let isNew = false;

            if (!user) {
                // Create new user
                const userId = generateId();
                user = await userService.createUser({
                    id: userId,
                    email,
                    displayName: displayName || email.split('@')[0],
                    provider: 'api',
                    emailVerified: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
                isNew = true;

                this.logger.info('Created new user via API', { userId, email });
            }

            return V1UsersController.createSuccessResponse({
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.displayName,
                    createdAt: user.createdAt,
                    isNew
                }
            });
        } catch (error) {
            this.logger.error('Error in findOrCreateUser:', error);
            return V1UsersController.createErrorResponse(
                'Failed to find or create user',
                500
            );
        }
    }
}
```

**File**: `worker/api/controllers/v1/projectsController.ts`

```typescript
import { BaseController } from '../baseController';
import { AppService } from '../../../database/services/AppService';
import { UserService } from '../../../database/services/UserService';
import { getAgentStub } from '../../../agents';
import { generateId } from '../../../utils/idGenerator';
import { getTemplateForQuery } from '../../../agents/index';
import type { RouteContext, ControllerResponse, ApiResponse } from '../../types/route-context';

export class V1ProjectsController extends BaseController {
    static async createProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<any>>> {
        try {
            const bodyResult = await V1ProjectsController.parseJsonBody<{
                userId: string;
                instructions: string;
                language?: string;
                frameworks?: string[];
                template?: string;
                webhookUrl?: string;
                metadata?: Record<string, any>;
            }>(request);

            if (!bodyResult.success) {
                return bodyResult.response!;
            }

            const {
                userId,
                instructions,
                language = 'typescript',
                frameworks = ['react', 'vite'],
                template = 'auto',
                webhookUrl,
                metadata
            } = bodyResult.data!;

            // Validate required fields
            if (!userId || !instructions) {
                return V1ProjectsController.createErrorResponse(
                    'userId and instructions are required',
                    400
                );
            }

            // Verify user exists
            const userService = new UserService(env);
            const user = await userService.getUserById(userId);

            if (!user) {
                return V1ProjectsController.createErrorResponse(
                    'User not found',
                    404
                );
            }

            // Verify API key owner has permission (check if API key user === userId or has admin scope)
            const apiKeyUser = context.user!;
            const apiKey = context.apiKey!;

            // For now, API key can only create projects for its own user
            if (apiKeyUser.id !== userId) {
                return V1ProjectsController.createErrorResponse(
                    'API key can only create projects for its own user',
                    403
                );
            }

            // Apply rate limiting (reuse existing service)
            const RateLimitService = await import('../../../services/rate-limit/rateLimits');
            await RateLimitService.RateLimitService.enforceAppCreationRateLimit(
                env,
                context.config.security.rateLimit,
                user,
                request
            );

            // Generate project ID
            const projectId = generateId();

            // Get template and initialize agent (similar to existing flow)
            const { sandboxSessionId, templateDetails, selection } =
                await getTemplateForQuery(env, {
                    agentId: projectId,
                    userId: user.id,
                    userModelConfigs: {},
                    enableRealtimeCodeFix: true
                }, instructions, this.logger);

            const agentInstance = await getAgentStub(env, projectId, false, this.logger);

            // Start generation asynchronously
            const url = new URL(request.url);
            const hostname = url.hostname;

            agentInstance.initialize({
                query: instructions,
                language,
                frameworks,
                hostname,
                inferenceContext: {
                    agentId: projectId,
                    userId: user.id,
                    userModelConfigs: {},
                    enableRealtimeCodeFix: true
                },
                onBlueprintChunk: () => {}, // No streaming for API
                templateInfo: { templateDetails, selection },
                sandboxSessionId
            }, 'deterministic');

            // Construct URLs
            const websocketUrl = `wss://${hostname}/api/agent/${projectId}/ws`;
            const statusUrl = `${url.origin}/api/v1/projects/${projectId}`;

            return V1ProjectsController.createSuccessResponse({
                projectId,
                status: 'generating',
                websocketUrl,
                statusUrl,
                createdAt: new Date().toISOString(),
                template: {
                    name: templateDetails.name,
                    description: selection.reasoning
                }
            });
        } catch (error) {
            this.logger.error('Error creating project:', error);
            return V1ProjectsController.createErrorResponse(
                'Failed to create project',
                500
            );
        }
    }

    static async getProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<any>>> {
        try {
            const projectId = context.pathParams.id;

            if (!projectId) {
                return V1ProjectsController.createErrorResponse(
                    'Project ID is required',
                    400
                );
            }

            const appService = new AppService(env);
            const app = await appService.getAppById(projectId);

            if (!app) {
                return V1ProjectsController.createErrorResponse(
                    'Project not found',
                    404
                );
            }

            // Authorization: API key owner or project owner
            const apiKeyUser = context.user!;
            if (app.userId !== apiKeyUser.id) {
                return V1ProjectsController.createErrorResponse(
                    'Access denied',
                    403
                );
            }

            // Try to get live agent state for progress
            let progress = null;
            try {
                const agentStub = await getAgentStub(env, projectId, true, this.logger);
                if (await agentStub.isInitialized()) {
                    const state = await agentStub.getState();
                    const previewUrl = await agentStub.getPreviewUrlCache();

                    progress = {
                        currentPhase: state.currentDevState,
                        filesGenerated: Object.keys(state.generatedFilesMap).length,
                        totalFiles: state.blueprint?.phases?.reduce(
                            (sum, phase) => sum + phase.files.length,
                            0
                        ) || 0,
                        percentComplete: Math.round(
                            (Object.keys(state.generatedFilesMap).length /
                            (state.blueprint?.phases?.reduce((sum, p) => sum + p.files.length, 0) || 1)) * 100
                        ),
                        previewUrl
                    };
                }
            } catch (error) {
                // Agent not active, that's okay
                this.logger.debug('Agent not active for project', { projectId });
            }

            // Construct URLs
            let productionUrl = null;
            if (app.deploymentId) {
                const domain = env.CUSTOM_DOMAIN;
                productionUrl = `https://${app.deploymentId}.${domain}`;
            }

            return V1ProjectsController.createSuccessResponse({
                project: {
                    id: app.id,
                    userId: app.userId,
                    title: app.title,
                    description: app.description,
                    status: app.status,
                    previewUrl: progress?.previewUrl || null,
                    productionUrl,
                    progress,
                    createdAt: app.createdAt,
                    completedAt: app.status === 'completed' ? app.updatedAt : null,
                    visibility: app.visibility,
                    framework: app.framework
                }
            });
        } catch (error) {
            this.logger.error('Error getting project:', error);
            return V1ProjectsController.createErrorResponse(
                'Failed to get project',
                500
            );
        }
    }
}
```

#### Step 4: Update ApiKeyService

**File**: `worker/database/services/ApiKeyService.ts`

Add missing methods:
```typescript
async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const result = await this.database
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.key, keyHash))
        .limit(1);

    return result[0] || null;
}

async updateLastUsed(apiKeyId: string): Promise<void> {
    await this.database
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, apiKeyId));
}
```

#### Step 5: Mount Router

**File**: `worker/api/routes/index.ts`

```typescript
import v1Router from './v1';

// ... existing routes

app.route('/api/v1', v1Router);
```

### Security Considerations

1. **API Key Storage**:
   - Store hashed keys in database (SHA-256)
   - Return raw key only once during creation
   - Support key rotation

2. **Rate Limiting**:
   - More restrictive than web interface (to prevent abuse)
   - Per-key limits in addition to per-user limits
   - Different limits for different operations

3. **Input Validation**:
   - Validate all inputs with Zod schemas
   - Sanitize user-provided strings
   - Limit instructions length (max 10,000 characters)

4. **Authorization**:
   - API keys scoped to user (can't create projects for other users without admin scope)
   - Ownership checks for all resource access
   - Optional scopes: `users:read`, `users:write`, `projects:read`, `projects:write`

5. **Audit Logging**:
   - Log all API key usage to `analytics` table
   - Track: API key ID, endpoint, timestamp, user ID, result

6. **CORS**:
   - Whitelist allowed origins for browser-based API access
   - Require API key in Authorization header (not query params)

7. **Webhooks**:
   - HMAC signature validation for webhook authenticity
   - Retry logic with exponential backoff
   - Timeout after 10 seconds

## Code References

### Authentication & Authorization
- `worker/middleware/auth/auth.ts:13-76` - JWT authentication middleware
- `worker/middleware/auth/routeAuth.ts:138-179` - Authorization enforcement
- `worker/database/services/ApiKeyService.ts` - API key management
- `worker/database/services/UserService.ts:64-72` - User CRUD operations
- `worker/database/services/AuthService.ts` - Authentication service

### Project Creation
- `worker/api/controllers/agent/controller.ts:33-162` - Existing code generation endpoint
- `worker/agents/core/simpleGeneratorAgent.ts:263-328` - Agent initialization
- `worker/agents/planning/blueprint.ts:257-321` - Blueprint generation
- `worker/agents/planning/templateSelector.ts:21-124` - Template selection
- `worker/database/schema.ts:133-193` - Apps table schema

### Status Tracking
- `worker/api/controllers/appView/controller.ts:19-86` - App details endpoint
- `worker/agents/core/state.ts:32-61` - Generation state interface
- `worker/agents/core/websocket.ts` - WebSocket message handling
- `worker/database/services/AppService.ts` - App CRUD operations

### API Patterns
- `worker/api/controllers/baseController.ts` - Base controller with standardized responses
- `worker/api/responses.ts:51-74` - Error response formatting
- `worker/services/rate-limit/rateLimits.ts` - Rate limiting service
- `worker/utils/cryptoUtils.ts` - Cryptographic utilities

## Implementation Timeline

**Phase 1 (Week 1)**: Foundation
- Create API key authentication middleware
- Add missing methods to `ApiKeyService`
- Create `/api/v1` router structure
- Implement health check endpoint

**Phase 2 (Week 2)**: User Management
- Implement `POST /api/v1/users/find-or-create`
- Implement `GET /api/v1/users/:id`
- Add rate limiting for user operations
- Write integration tests

**Phase 3 (Week 3)**: Project Management
- Implement `POST /api/v1/projects`
- Implement `GET /api/v1/projects/:id`
- Implement `GET /api/v1/projects` (list)
- Add progress tracking to status endpoint

**Phase 4 (Week 4)**: Advanced Features
- Implement project control (stop/resume)
- Implement `DELETE /api/v1/projects/:id`
- Add webhook support
- Implement `/api/v1/api-keys` endpoints

**Phase 5 (Week 5)**: Polish & Documentation
- Add comprehensive error messages
- Write API documentation (OpenAPI spec)
- Create Postman collection
- Performance optimization
- Security audit

## Testing Strategy

1. **Unit Tests**: Test individual controllers and services
2. **Integration Tests**: Test API endpoints with Durable Objects
3. **Load Tests**: Verify rate limiting and performance under load
4. **Security Tests**: Attempt unauthorized access, key reuse, etc.
5. **E2E Tests**: Full flow from user creation to project deployment

## Open Questions

1. **API Key Scopes**: Should we implement fine-grained scopes (read/write per resource) or keep it simple initially?
2. **Webhook Retry Logic**: How many retries? Exponential backoff parameters?
3. **Billing Integration**: Should API usage count towards paid tiers differently than web usage?
4. **Multi-User API Keys**: Should we support API keys that can create projects for multiple users (team/organization keys)?
5. **Streaming Support**: Should we support Server-Sent Events for real-time status updates in addition to WebSocket?
6. **Versioning Strategy**: How to handle breaking changes in future API versions?

## Related Resources

- **Existing Postman Collection**: `docs/v1dev-api-collection.postman_collection.json`
- **Architecture Diagrams**: `docs/architecture-diagrams.md`
- **CLAUDE.md Project Guide**: `/Users/brianh/Projects/vibesdk-production/CLAUDE.md`
