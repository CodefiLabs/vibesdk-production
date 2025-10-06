import { GlobalConfigurableSettings } from "../config";
import { AuthRequirement } from "../middleware/auth/routeAuth";
import { AuthUser } from "./auth-types";
import { ApiKey } from "../database/schema";


export type AppEnv = {
    Bindings: Env;
    Variables: {
        user: AuthUser | null;
        apiKey?: ApiKey;
        sessionId: string | null;
        config: GlobalConfigurableSettings;
        authLevel: AuthRequirement;
    }
}
