import { BaseController } from '../baseController';
import { UserService } from '../../../database/services/UserService';
import { getAgentStub, getTemplateForQuery } from '../../../agents';
import { generateId } from '../../../utils/idGenerator';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import type { RouteContext } from '../../types/route-context';
import type { ControllerResponse, ApiResponse } from '../types';
import { getPreviewDomain } from '../../../utils/urls';
import { ModelConfigService } from '../../../database/services/ModelConfigService';
import type { CodeGenState } from '../../../agents/core/state';

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

interface GetProjectResponse {
	project: {
		id: string;
		userId: string;
		title: string;
		description: string | null;
		status: string;
		previewUrl: string | null;
		productionUrl: string | null;
		progress?: {
			currentPhase: string;
			filesGenerated: number;
			totalFiles: number;
			percentComplete: number;
		};
		createdAt: Date | null;
		completedAt: Date | null;
		visibility: string;
		framework: string | null;
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
				return bodyResult.response as ControllerResponse<ApiResponse<CreateProjectResponse>>;
			}

			const {
				userId,
				instructions,
				language = 'typescript',
				frameworks = ['react', 'vite']
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
			const user = await userService.findUser({ id: userId });

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

	/**
	 * Get project status and details
	 * GET /api/v1/projects/:id
	 */
	static async getProject(
		_request: Request,
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
			const app = await appService.getAppDetails(projectId);

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
			let progress: {
				currentPhase: string;
				filesGenerated: number;
				totalFiles: number;
				percentComplete: number;
			} | undefined = undefined;
			let previewUrl: string | null = null;

			try {
				const agentStub = await getAgentStub(env, projectId, true, this.logger);
				if (await agentStub.isInitialized()) {
					const state = await agentStub.getFullState() as CodeGenState;
					previewUrl = await agentStub.getPreviewUrlCache();

					const totalFiles = state.blueprint?.phases?.reduce(
						(sum: number, phase: any) => sum + phase.files.length,
						0
					) || 0;

					const filesGenerated = Object.keys(state.generatedFilesMap).length;

					progress = {
						currentPhase: String(state.currentDevState),
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
