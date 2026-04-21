import type { UpdateContext } from "@/manage/update/runner.mjs";
import { addDaemonEnvs } from "@/manage/update/utils.mjs";

export default (ctx: UpdateContext) =>
  addDaemonEnvs(ctx, ({ user }) => ({
    GOOGLE_GEMINI_API_KEY: user.virtual_key!,
    GOOGLE_GENERATIVE_AI_API_KEY: user.virtual_key!,
  }));
