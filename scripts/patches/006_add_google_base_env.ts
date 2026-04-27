import type { UpdateContext } from "@/manage/update/runner.mjs";
import { addDaemonEnvs } from "@/manage/update/utils.mjs";

export default (ctx: UpdateContext) =>
    addDaemonEnvs(ctx, ({ appUrl }) => ({
        GOOGLE_BASE_URL: `${appUrl}/api/gateway/google`,
    }));
