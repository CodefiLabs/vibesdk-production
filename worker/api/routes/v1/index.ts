import { Hono } from 'hono';
import { apiKeyAuthMiddleware } from '../../../middleware/auth/apiKeyAuth';
import { AppEnv } from '../../../types/appenv';
import { createLogger } from '../../../logger';
import { AuthConfig, setAuthLevel } from '../../../middleware/auth/routeAuth';
import { usersRouter } from './usersRoutes';
import { projectsRouter } from './projectsRoutes';
import { apiKeysRouter } from './apiKeysRoutes';

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

// Mount sub-routers
v1Router.route('/users', usersRouter);
v1Router.route('/projects', projectsRouter);
v1Router.route('/api-keys', apiKeysRouter);

export function setupV1Routes(app: Hono<AppEnv>): void {
	logger.info('Setting up V1 API routes');

	// V1 routes use API key auth, not JWT auth - set to public to skip JWT middleware
	app.use('/api/v1/*', setAuthLevel(AuthConfig.public));

	app.route('/api/v1', v1Router);
}
