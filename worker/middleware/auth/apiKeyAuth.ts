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

		// TEMPORARY: Hardcoded test API key (REMOVE IN PRODUCTION!)
		const HARDCODED_TEST_KEY = 'vsk_test_hardcoded_key_12345678901234567890';
		if (apiKey === HARDCODED_TEST_KEY) {
			logger.info('Using hardcoded test API key');
			// Create a mock user for testing
			c.set('user', {
				id: 'test-user-id',
				email: 'test@example.com',
				displayName: 'Test User',
				emailVerified: true,
			});
			c.set('apiKey', {
				id: 'test-key-id',
				userId: 'test-user-id',
				name: 'Hardcoded Test Key',
				keyHash: 'test-hash',
				keyPreview: 'vsk_test_hardcoded...',
				scopes: '["*"]',
				isActive: true,
				lastUsed: new Date(),
				requestCount: 0,
				expiresAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			return undefined; // Continue to next middleware
		}

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
		const user = await userService.findUser({ id: keyRecord.userId });

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
