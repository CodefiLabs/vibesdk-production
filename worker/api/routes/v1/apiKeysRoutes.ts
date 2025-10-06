import { Hono } from 'hono';
import { adaptController } from '../../honoAdapter';
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
