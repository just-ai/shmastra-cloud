import type { Sandbox } from "e2b";
import { readFileSync } from "fs";
import path from "path";

export const SCHEDULER_SKILL_NAME = "shmastra-scheduler";
export const SCHEDULER_SKILL_DIR = `/home/user/.mastracode/skills/${SCHEDULER_SKILL_NAME}`;
export const SCHEDULER_SKILL_PATH = `${SCHEDULER_SKILL_DIR}/SKILL.md`;

// Read the shipped skill content at server startup, not at call-time, so we
// don't hit the disk on every provision.
const SKILL_CONTENT = readFileSync(
  path.join(process.cwd(), "lib/skills/shmastra-scheduler/SKILL.md"),
  "utf8",
);

/**
 * Write the shmastra-scheduler skill into ~/.mastracode/skills/ inside the
 * sandbox. mastracode's `restrictSkillPaths` (shmastra@7f9011c+) allows both
 * $CWD/.mastracode/skills and $HOME/.mastracode/skills, so placing it under
 * $HOME keeps the template unchanged.
 *
 * Idempotent: we always overwrite, so newer cloud builds ship newer skill
 * text without needing a merge.
 */
export async function writeSchedulerSkill(sandbox: Sandbox): Promise<void> {
  await sandbox.files.makeDir(SCHEDULER_SKILL_DIR);
  await sandbox.files.write(SCHEDULER_SKILL_PATH, SKILL_CONTENT);
}
