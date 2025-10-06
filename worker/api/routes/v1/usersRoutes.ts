import { Hono } from 'hono';
import { adaptController } from '../../honoAdapter';
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
