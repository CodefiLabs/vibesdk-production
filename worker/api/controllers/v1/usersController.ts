import { BaseController } from '../baseController';
import { UserService } from '../../../database/services/UserService';
import { generateId } from '../../../utils/idGenerator';
import type { RouteContext } from '../../types/route-context';
import type { ControllerResponse, ApiResponse } from '../types';

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
