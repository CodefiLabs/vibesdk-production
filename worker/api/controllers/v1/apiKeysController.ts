import { BaseController } from '../baseController';
import { ApiKeyService, ApiKeyInfo } from '../../../database/services/ApiKeyService';
import { sha256 } from '../../../utils/cryptoUtils';
import type { RouteContext } from '../../types/route-context';
import type { ControllerResponse, ApiResponse } from '../types';

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
	apiKeys: ApiKeyInfo[];
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
				return bodyResult.response as ControllerResponse<ApiResponse<CreateApiKeyResponse>>;
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
		_request: Request,
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
