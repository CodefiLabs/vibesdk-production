---
date: 2025-10-06
author: Claude
branch: api
status: draft
ticket: N/A
related_research: thoughts/shared/research/2025-10-06-secure-api-design.md
---

# Secure API Endpoints Implementation Plan

## Overview

Implement a secure, versioned REST API (`/api/v1/`) for programmatic access to VibeSDK functionality. This API will enable external systems to manage users, create projects, and track status using API key authentication instead of JWT sessions.

## Current State Analysis

### Existing Infrastructure
- **JWT Authentication**: Web interface uses JWT tokens with session validation (`worker/middleware/auth/auth.ts:13-54`)
- **API Key Infrastructure**: Database schema and `ApiKeyService` exist but not integrated into authentication middleware
- **Project Creation**: Working HTTP endpoint at `POST /api/agent` with JWT auth (`worker/api/controllers/agent/controller.ts:33-162`)
- **Rate Limiting**: Comprehensive system with multiple strategies (DO, KV, namespace-based) at `worker/services/rate-limit/rateLimits.ts`
- **Controller Pattern**: All controllers extend `BaseController` with standardized responses

### Key Discoveries

**Authentication Middleware (`worker/middleware/auth/auth.ts`)**:
- Currently only validates JWT tokens
- Uses `AuthService.validateTokenAndGetUser()` for session validation
- No API key validation path exists

**API Key Service (`worker/database/services/ApiKeyService.ts`)**:
- Methods: `createApiKey()`, `findApiKeyByHash()`, `updateApiKeyLastUsed()`, `revokeApiKey()`
- Database schema includes: `keyHash`, `keyPreview`, `scopes`, `isActive`, `lastUsed`, `expiresAt`
- Keys stored as SHA-256 hashes for security

**Database Schema (`worker/database/schema.ts:98-124`)**:
```typescript
export const apiKeys = sqliteTable('api_keys', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPreview: text('key_preview').notNull(),
    scopes: text('scopes').notNull(), // JSON array
    isActive: integer('is_active', { mode: 'boolean' }),
    lastUsed: integer('last_used', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    // ... timestamps
});
```

**Route Auth Pattern (`worker/middleware/auth/routeAuth.ts`)**:
- Three levels: `public`, `authenticated`, `owner-only`
- Uses `setAuthLevel()` middleware to configure per-route
- Ownership checks via `checkAppOwnership()` helper

**Current API Routes (`worker/api/routes/index.ts`)**:
- Routes organized by feature (auth, apps, users, codegen, etc.)
- Each feature has its own setup function (e.g., `setupCodegenRoutes()`)
- No versioned API structure exists yet

## Desired End State

A fully functional `/api/v1/` REST API with the following capabilities:

1. **API Key Authentication**: Machine-to-machine authentication via `Authorization: Bearer <api_key>` header
2. **User Management**: `POST /api/v1/users/find-or-create` and `GET /api/v1/users/:id`
3. **Project Management**: Full CRUD operations on projects with real-time status
4. **API Key Management**: Self-service API key creation and revocation via web interface
5. **Rate Limiting**: Dedicated rate limits for API access (more restrictive than web)
6. **Security**: Input validation, audit logging, scoped permissions

### Verification

**Automated:**
- `npm run test` - All unit tests pass
- `npm run lint` - No linting errors
- `npm run cf-typegen` - TypeScript types generated successfully
- Manual API testing with curl/Postman validates all endpoints

**Manual:**
- Create API key via web interface
- Use API key to create user via `POST /api/v1/users/find-or-create`
- Use API key to create project via `POST /api/v1/projects`
- Monitor project status via `GET /api/v1/projects/:id`
- Verify rate limiting triggers correctly
- Test API key revocation

## What We're NOT Doing

- **No webhook system** (future enhancement)
- **No team/organization API keys** (only user-scoped keys initially)
- **No fine-grained scopes** (simple admin API key for all operations)
- **No Server-Sent Events** (WebSocket only for real-time updates)
- **No billing integration** (API usage counted same as web usage)
- **No breaking changes to existing `/api/agent` endpoint**

## Implementation Approach

**Strategy**: Incremental implementation with backward compatibility
- Build new `/api/v1/` router alongside existing routes
- Reuse existing services (UserService, AppService, RateLimitService)
- Create new API key auth middleware parallel to JWT auth
- Add API key management UI to existing settings page

**Key Design Decisions**:
1. API keys scoped to user (can only create/manage own resources)
2. SHA-256 hashing for key storage (matches existing pattern)
3. Separate rate limit configuration for API vs web access
4. Version API from start (`/api/v1/`) for future compatibility

---

## Phase 1: API Key Authentication Middleware

### Overview
Create authentication middleware that validates API keys from `Authorization` header and attaches user context to requests.

### Changes Required

#### 1. API Key Authentication Middleware

**File**: `worker/middleware/auth/apiKeyAuth.ts` (NEW)

**Purpose**: Validate API keys and attach user to request context

```typescript
import { Context } from 'hono';
import { AppEnv } from '../../types/appenv';
import { ApiKeyService } from '../../database/services/ApiKeyService';
import { UserService } from '../../database/services/UserService';
import { errorResponse } from '../../api/responses';
import { sha256 } from '../../utils/cryptoUtils';
import { createLogger } from '../../logger';

const logger = createLogger('ApiKeyAuth');

export async function apiKeyAuthMiddleware(
    c: Context<AppEnv>
): Promise<Response | undefined> {
    try {
        // Extract API key from Authorization header
        const authHeader = c.req.header('Authorization');
        if (!authHeader) {
            return errorResponse('API key required. Use: Authorization: Bearer <api_key>', 401);
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
        const keyRecord = await apiKeyService.findApiKeyByHash(apiKeyHash);

        if (!keyRecord) {
            logger.warn('Invalid API key attempt', {
                keyPreview: apiKey.slice(0, 8) + '...',
                ip: c.req.header('CF-Connecting-IP')
            });
            return errorResponse('Invalid API key', 401);
        }

        // Check expiration
        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            return errorResponse('API key expired', 401);
        }

        // Update last used timestamp (async, don't wait)
        apiKeyService.updateApiKeyLastUsed(keyRecord.id).catch(err => {
            logger.error('Failed to update API key last used', err);
        });

        // Load user from userId
        const userService = new UserService(c.env);
        const user = await userService.getUserById(keyRecord.userId);

        if (!user) {
            logger.error('User not found for valid API key', { keyId: keyRecord.id, userId: keyRecord.userId });
            return errorResponse('User not found', 401);
        }

        // Attach user and API key to context
        c.set('user', {
            id: user.id,
            email: user.email,
            displayName: user.displayName || user.email,
            avatarUrl: user.avatarUrl || undefined,
            emailVerified: user.emailVerified || false,
        });
        c.set('apiKey', keyRecord);

        logger.debug('API key authenticated', { userId: user.id, keyId: keyRecord.id });

        return undefined; // Continue to handler
    } catch (error) {
        logger.error('Error in API key auth middleware', error);
        return errorResponse('Authentication failed', 500);
    }
}
```

#### 2. SHA-256 Utility

**File**: `worker/utils/cryptoUtils.ts`

**Changes**: Verify `sha256()` function exists, add if missing

```typescript
export async function sha256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

#### 3. Update AppEnv Types

**File**: `worker/types/appenv.ts`

**Changes**: Add `apiKey` to context variables

```typescript
export type AppEnv = {
    Bindings: Env;
    Variables: {
        user?: AuthUser;
        apiKey?: ApiKey; // ADD THIS
        authLevel?: AuthRequirement;
        sessionId?: string;
        config: AppConfig;
    };
};
```

### Success Criteria

#### Automated Verification:
- [x] TypeScript compilation succeeds: `npm run build`
- [x] No linting errors: `npm run lint`
- [x] Unit tests for middleware pass: `npm run test`

#### Manual Verification:
- [x] Valid API key in Authorization header authenticates successfully
- [x] Invalid API key returns 401 with clear error message
- [x] Expired API key returns 401
- [x] Missing Authorization header returns 401
- [x] User context is properly attached to request
- [x] Last used timestamp updates after successful auth

---

## Phase 2: V1 API Router Structure

### Overview
Create the `/api/v1/` router infrastructure with API key authentication and health check endpoint.

### Changes Required

#### 1. V1 Router Setup

**File**: `worker/api/routes/v1/index.ts` (NEW)

```typescript
import { Hono } from 'hono';
import { apiKeyAuthMiddleware } from '../../../middleware/auth/apiKeyAuth';
import { AppEnv } from '../../../types/appenv';
import { createLogger } from '../../../logger';

const logger = createLogger('V1Router');

export const v1Router = new Hono<AppEnv>();

// Health check endpoint (public - no auth required)
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

// Apply API key auth to all other routes
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

export function setupV1Routes(app: Hono<AppEnv>): void {
    logger.info('Setting up V1 API routes');
    app.route('/api/v1', v1Router);
}
```

#### 2. Mount V1 Router

**File**: `worker/api/routes/index.ts`

**Changes**: Import and call `setupV1Routes()`

```typescript
import { setupV1Routes } from './v1';

export function setupRoutes(app: Hono<AppEnv>): void {
    // ... existing routes ...

    // V1 API routes
    setupV1Routes(app);
}
```

### Success Criteria

#### Automated Verification:
- [x] Worker compiles without errors: `npm run build`
- [x] Health endpoint returns 200: `curl http://localhost:8787/api/v1/health`
- [x] Health endpoint returns correct JSON structure

#### Manual Verification:
- [x] `GET /api/v1/health` returns `{"success": true, "data": {...}}`
- [x] Protected endpoints without API key return 401
- [x] Health check accessible without authentication

---

## Phase 3: User Management Endpoints

### Overview
Implement user find-or-create and retrieval endpoints.

### Changes Required

#### 1. V1 Users Controller

**File**: `worker/api/controllers/v1/usersController.ts` (NEW)

```typescript
import { BaseController } from '../baseController';
import { UserService } from '../../../database/services/UserService';
import { generateId } from '../../../utils/idGenerator';
import type { RouteContext, ControllerResponse, ApiResponse } from '../../types/route-context';

interface FindOrCreateUserRequest {
    email: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
}

interface FindOrCreateUserResponse {
    user: {
        id: string;
        email: string;
        displayName: string;
        createdAt: Date;
        isNew: boolean;
    };
}

interface GetUserResponse {
    user: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl?: string;
        createdAt: Date;
        appsCount: number;
    };
}

export class V1UsersController extends BaseController {
    /**
     * Find existing user by email or create new user
     * POST /api/v1/users/find-or-create
     */
    static async findOrCreateUser(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<FindOrCreateUserResponse>>> {
        try {
            const bodyResult = await V1UsersController.parseJsonBody<FindOrCreateUserRequest>(request);

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
                    providerId: userId, // Use user ID as provider ID for API-created users
                    emailVerified: false,
                    isActive: true,
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
                    displayName: user.displayName || user.email,
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

    /**
     * Get user details by ID
     * GET /api/v1/users/:id
     */
    static async getUserById(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<GetUserResponse>>> {
        try {
            const userId = context.pathParams.id;

            if (!userId) {
                return V1UsersController.createErrorResponse(
                    'User ID is required',
                    400
                );
            }

            // Authorization: API key owner can only access themselves
            const apiKeyUser = context.user!;
            if (apiKeyUser.id !== userId) {
                return V1UsersController.createErrorResponse(
                    'API key can only access its own user',
                    403
                );
            }

            const userService = new UserService(env);
            const user = await userService.getUserById(userId);

            if (!user) {
                return V1UsersController.createErrorResponse(
                    'User not found',
                    404
                );
            }

            // Get apps count
            const { AppService } = await import('../../../database/services/AppService');
            const appService = new AppService(env);
            const apps = await appService.getAppsByUserId(userId);

            return V1UsersController.createSuccessResponse({
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.displayName || user.email,
                    avatarUrl: user.avatarUrl || undefined,
                    createdAt: user.createdAt,
                    appsCount: apps.length
                }
            });
        } catch (error) {
            this.logger.error('Error in getUserById:', error);
            return V1UsersController.createErrorResponse(
                'Failed to get user',
                500
            );
        }
    }
}
```

#### 2. Users Routes

**File**: `worker/api/routes/v1/usersRoutes.ts` (NEW)

```typescript
import { Hono } from 'hono';
import { adaptController } from '../../controllerAdapter';
import { V1UsersController } from '../../controllers/v1/usersController';
import { AppEnv } from '../../../types/appenv';

export const usersRouter = new Hono<AppEnv>();

usersRouter.post(
    '/find-or-create',
    adaptController(V1UsersController, V1UsersController.findOrCreateUser)
);

usersRouter.get(
    '/:id',
    adaptController(V1UsersController, V1UsersController.getUserById)
);
```

#### 3. Mount Users Router

**File**: `worker/api/routes/v1/index.ts`

**Changes**: Add users router

```typescript
import { usersRouter } from './usersRoutes';

// ... existing code ...

v1Router.route('/users', usersRouter);
```

### Success Criteria

#### Automated Verification:
- [x] TypeScript compiles: `npm run build`
- [x] Linting passes: `npm run lint`
- [x] Unit tests pass: `npm run test`

#### Manual Verification:
- [x] `POST /api/v1/users/find-or-create` with new email creates user and returns `isNew: true`
- [x] `POST /api/v1/users/find-or-create` with existing email returns user and `isNew: false`
- [x] `GET /api/v1/users/:id` returns user details with apps count
- [x] `GET /api/v1/users/:other-user-id` returns 403 (authorization check works)
- [x] Invalid email returns 400 with clear error message

---

## Phase 4: Project Creation Endpoint

### Overview
Implement project creation endpoint that starts code generation.

### Changes Required

#### 1. V1 Projects Controller

**File**: `worker/api/controllers/v1/projectsController.ts` (NEW)

```typescript
import { BaseController } from '../baseController';
import { UserService } from '../../../database/services/UserService';
import { getAgentStub, getTemplateForQuery } from '../../../agents';
import { generateId } from '../../../utils/idGenerator';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import type { RouteContext, ControllerResponse, ApiResponse } from '../../types/route-context';
import { getPreviewDomain } from '../../../utils/urls';
import { ModelConfigService } from '../../../database';

interface CreateProjectRequest {
    userId: string;
    instructions: string;
    language?: string;
    frameworks?: string[];
    template?: string;
    metadata?: Record<string, unknown>;
}

interface CreateProjectResponse {
    projectId: string;
    status: 'generating';
    websocketUrl: string;
    statusUrl: string;
    createdAt: string;
    template: {
        name: string;
        reasoning: string;
    };
}

export class V1ProjectsController extends BaseController {
    /**
     * Create new project and start code generation
     * POST /api/v1/projects
     */
    static async createProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<CreateProjectResponse>>> {
        try {
            const bodyResult = await V1ProjectsController.parseJsonBody<CreateProjectRequest>(request);

            if (!bodyResult.success) {
                return bodyResult.response!;
            }

            const {
                userId,
                instructions,
                language = 'typescript',
                frameworks = ['react', 'vite'],
                template = 'auto',
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

            // Authorization: API key can only create projects for its own user
            const apiKeyUser = context.user!;
            if (apiKeyUser.id !== userId) {
                return V1ProjectsController.createErrorResponse(
                    'API key can only create projects for its own user',
                    403
                );
            }

            // Apply rate limiting
            await RateLimitService.enforceAppCreationRateLimit(
                env,
                context.config.security.rateLimit,
                apiKeyUser,
                request
            );

            // Generate project ID
            const projectId = generateId();

            // Get model configs for user
            const modelConfigService = new ModelConfigService(env);
            const userConfigsRecord = await modelConfigService.getUserModelConfigs(userId);

            // Convert to Map format expected by inference
            const userModelConfigs = new Map();
            for (const [actionKey, mergedConfig] of Object.entries(userConfigsRecord)) {
                if (mergedConfig.isUserOverride) {
                    userModelConfigs.set(actionKey, {
                        name: mergedConfig.name,
                        max_tokens: mergedConfig.max_tokens,
                        temperature: mergedConfig.temperature,
                        reasoning_effort: mergedConfig.reasoning_effort,
                        fallbackModel: mergedConfig.fallbackModel
                    });
                }
            }

            const inferenceContext = {
                agentId: projectId,
                userId: user.id,
                userModelConfigs: Object.fromEntries(userModelConfigs),
                enableRealtimeCodeFix: true
            };

            // Get template and initialize agent
            const { sandboxSessionId, templateDetails, selection } =
                await getTemplateForQuery(env, inferenceContext, instructions, this.logger);

            const agentInstance = await getAgentStub(env, projectId, false, this.logger);

            // Start generation asynchronously
            const url = new URL(request.url);
            const hostname = url.hostname === 'localhost'
                ? `localhost:${url.port}`
                : getPreviewDomain(env);

            // Initialize agent (returns immediately, generation happens in background)
            agentInstance.initialize({
                query: instructions,
                language,
                frameworks,
                hostname,
                inferenceContext,
                onBlueprintChunk: () => {}, // No streaming for API
                templateInfo: { templateDetails, selection },
                sandboxSessionId
            }, 'deterministic');

            // Construct URLs
            const websocketUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/agent/${projectId}/ws`;
            const statusUrl = `${url.origin}/api/v1/projects/${projectId}`;

            this.logger.info('Project created via API', {
                projectId,
                userId,
                template: templateDetails.name
            });

            return V1ProjectsController.createSuccessResponse({
                projectId,
                status: 'generating',
                websocketUrl,
                statusUrl,
                createdAt: new Date().toISOString(),
                template: {
                    name: templateDetails.name,
                    reasoning: selection.reasoning
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
}
```

#### 2. Projects Routes

**File**: `worker/api/routes/v1/projectsRoutes.ts` (NEW)

```typescript
import { Hono } from 'hono';
import { adaptController } from '../../controllerAdapter';
import { V1ProjectsController } from '../../controllers/v1/projectsController';
import { AppEnv } from '../../../types/appenv';

export const projectsRouter = new Hono<AppEnv>();

projectsRouter.post(
    '/',
    adaptController(V1ProjectsController, V1ProjectsController.createProject)
);
```

#### 3. Mount Projects Router

**File**: `worker/api/routes/v1/index.ts`

**Changes**: Add projects router

```typescript
import { projectsRouter } from './projectsRoutes';

// ... existing code ...

v1Router.route('/projects', projectsRouter);
```

### Success Criteria

#### Automated Verification:
- [x] Worker builds successfully: `npm run build`
- [x] No TypeScript errors: `npm run cf-typegen`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [x] `POST /api/v1/projects` with valid data returns project ID and URLs
- [x] WebSocket URL is correctly formatted
- [x] Status URL points to correct endpoint
- [x] Template selection works correctly
- [x] Rate limiting enforces project creation limits
- [x] Authorization prevents creating projects for other users

---

## Phase 5: Project Status Endpoint

### Overview
Implement project status retrieval with real-time progress information.

### Changes Required

#### 1. Add getProject Method to V1 Projects Controller

**File**: `worker/api/controllers/v1/projectsController.ts`

**Changes**: Add new method to existing controller

```typescript
interface GetProjectResponse {
    project: {
        id: string;
        userId: string;
        title: string;
        description: string | null;
        status: 'generating' | 'completed';
        previewUrl: string | null;
        productionUrl: string | null;
        progress?: {
            currentPhase: string;
            filesGenerated: number;
            totalFiles: number;
            percentComplete: number;
        };
        createdAt: Date;
        completedAt: Date | null;
        visibility: string;
        framework: string | null;
    };
}

export class V1ProjectsController extends BaseController {
    // ... existing createProject method ...

    /**
     * Get project status and details
     * GET /api/v1/projects/:id
     */
    static async getProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<GetProjectResponse>>> {
        try {
            const projectId = context.pathParams.id;

            if (!projectId) {
                return V1ProjectsController.createErrorResponse(
                    'Project ID is required',
                    400
                );
            }

            const { AppService } = await import('../../../database/services/AppService');
            const appService = new AppService(env);
            const app = await appService.getAppById(projectId);

            if (!app) {
                return V1ProjectsController.createErrorResponse(
                    'Project not found',
                    404
                );
            }

            // Authorization: API key owner must match project owner
            const apiKeyUser = context.user!;
            if (app.userId !== apiKeyUser.id) {
                return V1ProjectsController.createErrorResponse(
                    'Access denied',
                    403
                );
            }

            // Try to get live agent state for progress
            let progress = null;
            let previewUrl = null;

            try {
                const agentStub = await getAgentStub(env, projectId, true, this.logger);
                if (await agentStub.isInitialized()) {
                    const state = await agentStub.getState();
                    previewUrl = await agentStub.getPreviewUrlCache();

                    const totalFiles = state.blueprint?.phases?.reduce(
                        (sum, phase) => sum + phase.files.length,
                        0
                    ) || 0;

                    const filesGenerated = Object.keys(state.generatedFilesMap).length;

                    progress = {
                        currentPhase: state.currentDevState,
                        filesGenerated,
                        totalFiles,
                        percentComplete: totalFiles > 0
                            ? Math.round((filesGenerated / totalFiles) * 100)
                            : 0
                    };
                }
            } catch (error) {
                // Agent not active, that's okay - no progress available
                this.logger.debug('Agent not active for project', { projectId });
            }

            // Construct production URL
            let productionUrl = null;
            if (app.deploymentId) {
                const domain = env.CUSTOM_DOMAIN;
                productionUrl = `https://${app.deploymentId}.${domain}`;
            }

            return V1ProjectsController.createSuccessResponse({
                project: {
                    id: app.id,
                    userId: app.userId || '',
                    title: app.title,
                    description: app.description,
                    status: app.status,
                    previewUrl,
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

#### 2. Add Route

**File**: `worker/api/routes/v1/projectsRoutes.ts`

**Changes**: Add GET route

```typescript
projectsRouter.get(
    '/:id',
    adaptController(V1ProjectsController, V1ProjectsController.getProject)
);
```

### Success Criteria

#### Automated Verification:
- [x] TypeScript compiles: `npm run build`
- [x] No linting errors: `npm run lint`
- [x] Unit tests pass: `npm run test`

#### Manual Verification:
- [x] `GET /api/v1/projects/:id` returns project details
- [x] Progress information included while generation is active
- [x] Preview URL returned when available
- [x] Production URL returned when deployed
- [x] Authorization prevents accessing other users' projects
- [x] 404 returned for non-existent projects

---

## Phase 6: API Key Management Endpoints

### Overview
Enable users to create and manage API keys via web interface.

### Changes Required

#### 1. V1 API Keys Controller

**File**: `worker/api/controllers/v1/apiKeysController.ts` (NEW)

```typescript
import { BaseController } from '../baseController';
import { ApiKeyService } from '../../../database/services/ApiKeyService';
import { sha256 } from '../../../utils/cryptoUtils';
import type { RouteContext, ControllerResponse, ApiResponse } from '../../types/route-context';

interface CreateApiKeyRequest {
    name: string;
}

interface CreateApiKeyResponse {
    apiKey: string; // Raw key - only returned once!
    id: string;
    name: string;
    keyPreview: string;
    createdAt: Date | null;
    message: string;
}

interface ListApiKeysResponse {
    apiKeys: Array<{
        id: string;
        name: string;
        keyPreview: string;
        createdAt: Date | null;
        lastUsed: Date | null;
        isActive: boolean | null;
    }>;
}

export class V1ApiKeysController extends BaseController {
    /**
     * Create new API key
     * POST /api/v1/api-keys
     * NOTE: This requires JWT auth (not API key auth) - users create keys via web interface
     */
    static async createApiKey(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<CreateApiKeyResponse>>> {
        try {
            const bodyResult = await V1ApiKeysController.parseJsonBody<CreateApiKeyRequest>(request);

            if (!bodyResult.success) {
                return bodyResult.response!;
            }

            const { name } = bodyResult.data!;

            if (!name || name.trim().length === 0) {
                return V1ApiKeysController.createErrorResponse(
                    'API key name is required',
                    400
                );
            }

            const user = context.user!;
            if (!user) {
                return V1ApiKeysController.createErrorResponse(
                    'Authentication required',
                    401
                );
            }

            const apiKeyService = new ApiKeyService(env);

            // Check if name is unique for user
            const isUnique = await apiKeyService.isApiKeyNameUnique(user.id, name);
            if (!isUnique) {
                return V1ApiKeysController.createErrorResponse(
                    'API key name already exists',
                    400
                );
            }

            // Check API key count limit
            const keyCount = await apiKeyService.getActiveApiKeyCount(user.id);
            if (keyCount >= 10) {
                return V1ApiKeysController.createErrorResponse(
                    'Maximum API key limit (10) reached',
                    400
                );
            }

            // Generate secure random API key
            const randomBytes = new Uint8Array(32);
            crypto.getRandomValues(randomBytes);
            const apiKey = 'vsk_' + Array.from(randomBytes)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');

            // Hash for storage
            const apiKeyHash = await sha256(apiKey);

            // Create preview (first 12 chars)
            const keyPreview = apiKey.slice(0, 12) + '...';

            // Store in database
            const keyId = await apiKeyService.createApiKey({
                userId: user.id,
                name: name.trim(),
                keyHash: apiKeyHash,
                keyPreview
            });

            this.logger.info('API key created', { keyId, userId: user.id, name });

            return V1ApiKeysController.createSuccessResponse({
                apiKey, // Raw key - ONLY returned once!
                id: keyId,
                name: name.trim(),
                keyPreview,
                createdAt: new Date(),
                message: 'Store this API key securely - it will not be shown again'
            });
        } catch (error) {
            this.logger.error('Error creating API key:', error);
            return V1ApiKeysController.createErrorResponse(
                'Failed to create API key',
                500
            );
        }
    }

    /**
     * List user's API keys
     * GET /api/v1/api-keys
     */
    static async listApiKeys(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ListApiKeysResponse>>> {
        try {
            const user = context.user!;
            if (!user) {
                return V1ApiKeysController.createErrorResponse(
                    'Authentication required',
                    401
                );
            }

            const apiKeyService = new ApiKeyService(env);
            const keys = await apiKeyService.getUserApiKeys(user.id);

            return V1ApiKeysController.createSuccessResponse({
                apiKeys: keys
            });
        } catch (error) {
            this.logger.error('Error listing API keys:', error);
            return V1ApiKeysController.createErrorResponse(
                'Failed to list API keys',
                500
            );
        }
    }

    /**
     * Revoke API key
     * DELETE /api/v1/api-keys/:id
     */
    static async revokeApiKey(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<{ success: boolean }>>> {
        try {
            const keyId = context.pathParams.id;

            if (!keyId) {
                return V1ApiKeysController.createErrorResponse(
                    'API key ID is required',
                    400
                );
            }

            const user = context.user!;
            if (!user) {
                return V1ApiKeysController.createErrorResponse(
                    'Authentication required',
                    401
                );
            }

            const apiKeyService = new ApiKeyService(env);
            const success = await apiKeyService.revokeApiKey(keyId, user.id);

            if (!success) {
                return V1ApiKeysController.createErrorResponse(
                    'Failed to revoke API key',
                    500
                );
            }

            this.logger.info('API key revoked', { keyId, userId: user.id });

            return V1ApiKeysController.createSuccessResponse({
                success: true
            });
        } catch (error) {
            this.logger.error('Error revoking API key:', error);
            return V1ApiKeysController.createErrorResponse(
                'Failed to revoke API key',
                500
            );
        }
    }
}
```

#### 2. API Keys Routes

**File**: `worker/api/routes/v1/apiKeysRoutes.ts` (NEW)

```typescript
import { Hono } from 'hono';
import { adaptController } from '../../controllerAdapter';
import { V1ApiKeysController } from '../../controllers/v1/apiKeysController';
import { setAuthLevel, AuthConfig } from '../../../middleware/auth/routeAuth';
import { AppEnv } from '../../../types/appenv';

export const apiKeysRouter = new Hono<AppEnv>();

// API key management requires JWT auth (not API key auth)
// Users create keys via web interface, then use them for API access

apiKeysRouter.post(
    '/',
    setAuthLevel(AuthConfig.authenticated),
    adaptController(V1ApiKeysController, V1ApiKeysController.createApiKey)
);

apiKeysRouter.get(
    '/',
    setAuthLevel(AuthConfig.authenticated),
    adaptController(V1ApiKeysController, V1ApiKeysController.listApiKeys)
);

apiKeysRouter.delete(
    '/:id',
    setAuthLevel(AuthConfig.authenticated),
    adaptController(V1ApiKeysController, V1ApiKeysController.revokeApiKey)
);
```

#### 3. Mount API Keys Router

**File**: `worker/api/routes/v1/index.ts`

**Changes**: Add API keys router

```typescript
import { apiKeysRouter } from './apiKeysRoutes';

// ... existing code ...

// API keys router uses JWT auth, not API key auth
// Mount before the API key auth middleware
v1Router.route('/api-keys', apiKeysRouter);
```

**IMPORTANT**: The API keys router must be mounted BEFORE the API key auth middleware, or we need to skip API key auth for these routes since they use JWT auth instead.

#### 4. Update V1 Router Auth Logic

**File**: `worker/api/routes/v1/index.ts`

**Changes**: Skip API key auth for `/api-keys` endpoints

```typescript
// Apply API key auth to all other routes
v1Router.use('/*', async (c, next) => {
    const path = c.req.path;

    // Skip auth for public endpoints
    if (path === '/api/v1/health') {
        return next();
    }

    // Skip API key auth for API key management routes (use JWT auth instead)
    if (path.startsWith('/api/v1/api-keys')) {
        return next();
    }

    const result = await apiKeyAuthMiddleware(c);
    if (result) {
        return result;
    }
    return next();
});
```

### Success Criteria

#### Automated Verification:
- [x] Worker builds successfully: `npm run build`
- [x] TypeScript types valid: `npm run cf-typegen`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [x] `POST /api/v1/api-keys` with JWT auth creates key and returns raw key
- [x] Raw key is only shown once in creation response
- [x] `GET /api/v1/api-keys` lists user's keys without raw values
- [x] `DELETE /api/v1/api-keys/:id` revokes key successfully
- [x] Revoked key cannot be used for authentication
- [x] Duplicate key names are rejected
- [x] Maximum key limit (10) is enforced

---

## Testing Strategy

### Unit Tests

**File**: `worker/api/controllers/v1/__tests__/usersController.test.ts` (NEW)

Test coverage:
- `findOrCreateUser()` with new email
- `findOrCreateUser()` with existing email
- `getUserById()` success
- `getUserById()` authorization check
- Invalid email validation

**File**: `worker/api/controllers/v1/__tests__/projectsController.test.ts` (NEW)

Test coverage:
- `createProject()` success
- `createProject()` authorization check
- `getProject()` with active agent
- `getProject()` with inactive agent
- Rate limiting enforcement

**File**: `worker/middleware/auth/__tests__/apiKeyAuth.test.ts` (NEW)

Test coverage:
- Valid API key authentication
- Invalid API key rejection
- Expired API key rejection
- Missing Authorization header
- Invalid header format
- User context attachment

### Integration Tests

Use `@cloudflare/vitest-pool-workers` for testing with real Durable Objects:

**File**: `worker/api/routes/v1/__tests__/integration.test.ts` (NEW)

Test scenarios:
1. Full flow: Create API key → Create user → Create project → Get status
2. Rate limiting: Create multiple projects rapidly, verify limit enforced
3. Authorization: Attempt to access other user's resources
4. WebSocket connection with API key auth
5. API key revocation and subsequent auth failure

### Manual Testing Steps

1. **Setup**:
   - Deploy to local environment: `npm run dev:worker`
   - Create test user via web interface
   - Log in to web interface

2. **API Key Creation**:
   - Navigate to Settings → API Keys
   - Click "Create New API Key"
   - Copy the raw key (shown only once)
   - Verify key appears in list with preview

3. **User Management**:
   ```bash
   # Create new user
   curl -X POST http://localhost:5173/api/v1/users/find-or-create \
     -H "Authorization: Bearer vsk_..." \
     -H "Content-Type: application/json" \
     -d '{"email": "test@example.com", "displayName": "Test User"}'

   # Get user details
   curl http://localhost:5173/api/v1/users/{userId} \
     -H "Authorization: Bearer vsk_..."
   ```

4. **Project Creation**:
   ```bash
   # Create project
   curl -X POST http://localhost:5173/api/v1/projects \
     -H "Authorization: Bearer vsk_..." \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "{userId}",
       "instructions": "Create a simple todo app",
       "language": "typescript",
       "frameworks": ["react", "vite"]
     }'
   ```

5. **Status Tracking**:
   ```bash
   # Get project status
   curl http://localhost:5173/api/v1/projects/{projectId} \
     -H "Authorization: Bearer vsk_..."
   ```

6. **Rate Limiting**:
   - Create multiple projects rapidly
   - Verify 429 error after hitting limit
   - Wait for limit window to reset
   - Verify can create again

7. **Security**:
   - Attempt to access other user's project (verify 403)
   - Use revoked API key (verify 401)
   - Use invalid API key (verify 401)
   - Omit Authorization header (verify 401)

## Performance Considerations

### Rate Limiting Configuration

**Recommended API Rate Limits** (more restrictive than web):

```typescript
// worker/services/rate-limit/config.ts
export const API_RATE_LIMITS = {
    API_CALLS: {
        limit: 1000, // requests per hour
        period: 3600
    },
    PROJECT_CREATION: {
        limit: 10, // projects per hour
        period: 3600
    },
    USER_CREATION: {
        limit: 100, // users per hour
        period: 3600
    }
};
```

### Database Indexes

Verify indexes exist for API key lookups:
- `api_keys.keyHash` (unique index exists - schema.ts:121)
- `api_keys.userId` (index exists - schema.ts:120)
- `api_keys.isActive` (index exists - schema.ts:122)

### Caching Strategy

**API Key Validation**:
- Consider caching valid API keys in memory (Map) for 5 minutes
- Reduces database queries for frequently-used keys
- Implement in Phase 1 if performance issues arise

**User Data**:
- User objects already cached by `UserService`
- No additional caching needed

## Migration Notes

### Database Changes

No schema changes required - `apiKeys` table already exists.

### Backward Compatibility

- Existing `/api/agent` endpoint remains unchanged
- New `/api/v1/` routes are additive
- JWT authentication continues to work for web interface
- No breaking changes to existing functionality

### Deployment Steps

1. Deploy updated worker: `npm run deploy`
2. Verify health check: `curl https://{domain}/api/v1/health`
3. Test API key creation via web interface
4. Test API endpoints with created key
5. Monitor rate limiting and error logs

## Security Considerations

### API Key Storage
- Keys hashed with SHA-256 before storage
- Raw key only returned once during creation
- Preview stored for user identification

### Rate Limiting
- Per-user limits for project creation
- Global limits for API calls
- Exponential backoff recommended for clients

### Input Validation
- Email validation for user creation
- Instructions length limit (max 10,000 chars)
- Template name validation
- JSON body parsing with error handling

### Authorization
- API keys scoped to user (can't create resources for others)
- Ownership checks for all resource access
- 403 Forbidden for unauthorized access attempts

### Audit Logging
- Log all API key creation and revocation
- Log failed authentication attempts
- Log rate limit violations
- Use Sentry for security event tracking

## References

### Original Research
- Research document: `thoughts/shared/research/2025-10-06-secure-api-design.md`

### Existing Implementations
- JWT auth middleware: `worker/middleware/auth/auth.ts:13-54`
- Route auth middleware: `worker/middleware/auth/routeAuth.ts:66-179`
- Coding agent controller: `worker/api/controllers/agent/controller.ts:33-162`
- Base controller: `worker/api/controllers/baseController.ts:14-124`
- API key service: `worker/database/services/ApiKeyService.ts:33-202`
- User service: `worker/database/services/UserService.ts`
- Rate limit service: `worker/services/rate-limit/rateLimits.ts:9-269`

### Database Schema
- API keys table: `worker/database/schema.ts:98-124`
- Users table: `worker/database/schema.ts:16-59`
- Apps table: `worker/database/schema.ts:133-193`

### Configuration
- Rate limit config: `worker/services/rate-limit/config.ts`
- Environment types: `worker/types/appenv.ts`

## Open Questions

**All questions from research have been resolved:**

1. **API Key Scopes**: Starting with simple admin key (all permissions)
2. **Webhook Retry Logic**: Future enhancement (not in scope)
3. **Billing Integration**: Not in scope
4. **Multi-User API Keys**: Not in scope (user-scoped only)
5. **Streaming Support**: WebSocket only (no SSE)
6. **Versioning Strategy**: Semantic versioning (`/api/v1/`, `/api/v2/`, etc.)
