import type { UpdateContext } from "@/manage/update/runner.mjs";
import { writeSchedulerSkill, SCHEDULER_SKILL_PATH } from "@/lib/skill-injection";

export default async function ({ sandbox, log }: UpdateContext) {
  log(`Writing scheduler skill to ${SCHEDULER_SKILL_PATH}`);
  await writeSchedulerSkill(sandbox);
}
