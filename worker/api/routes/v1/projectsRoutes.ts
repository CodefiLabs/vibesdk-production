import { Hono } from 'hono';
import { adaptController } from '../../honoAdapter';
import { V1ProjectsController } from '../../controllers/v1/projectsController';
import { AppEnv } from '../../../types/appenv';

export const projectsRouter = new Hono<AppEnv>();

projectsRouter.post(
	'/',
	adaptController(V1ProjectsController, V1ProjectsController.createProject)
);

projectsRouter.get(
	'/:id',
	adaptController(V1ProjectsController, V1ProjectsController.getProject)
);
