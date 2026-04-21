import type { UpdateContext } from "@/manage/update/runner.mjs";
import { addDaemonEnvs } from "@/manage/update/utils.mjs";

export default (ctx: UpdateContext) =>
  addDaemonEnvs(ctx, ({ user, appUrl }) => ({
    CORS_ORIGIN: appUrl,
    MASTRA_AUTH_TOKEN: user.virtual_key!,
    OPENAI_BASE_URL: `${appUrl}/api/gateway/openai`,
    ANTHROPIC_BASE_URL: `${appUrl}/api/gateway/anthropic`,
    GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
    GOOGLE_GEMINI_BASE_URL: `${appUrl}/api/gateway/gemini`,
    GOOGLE_GENERATIVE_BASE_URL: `${appUrl}/api/gateway/gemini`,
    COMPOSIO_BASE_URL: `${appUrl}/api/gateway/composio`,
  }));
