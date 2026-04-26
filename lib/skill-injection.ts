import type { Sandbox } from "e2b";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const SKILLS_SRC = path.join(process.cwd(), "lib/skills");
const SKILLS_DST = "/home/user/.mastracode/skills";

interface BundledSkill {
  name: string;
  files: Array<{ relativePath: string; content: string }>;
}

// Scan lib/skills/ at module load so we don't hit the disk on every sync.
// Each top-level directory is a skill; all files inside it (non-recursive) are
// shipped verbatim.
const SKILLS: ReadonlyArray<BundledSkill> = (() => {
  let entries: string[];
  try {
    entries = readdirSync(SKILLS_SRC);
  } catch {
    return [];
  }
  const out: BundledSkill[] = [];
  for (const name of entries) {
    const dir = path.join(SKILLS_SRC, name);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir)
      .filter((f) => statSync(path.join(dir, f)).isFile())
      .map((f) => ({
        relativePath: f,
        content: readFileSync(path.join(dir, f), "utf8"),
      }));
    if (files.length > 0) out.push({ name, files });
  }
  return out;
})();

/**
 * Write every bundled skill into ~/.mastracode/skills/<name>/ inside the
 * sandbox. mastracode's `restrictSkillPaths` allows both $CWD/.mastracode and
 * $HOME/.mastracode, so placing them under $HOME keeps the template
 * unchanged. Idempotent — we always overwrite, so newer cloud builds ship
 * newer skill text without needing a merge.
 */
export async function writeSkills(sandbox: Sandbox): Promise<void> {
  for (const skill of SKILLS) {
    const dir = `${SKILLS_DST}/${skill.name}`;
    await sandbox.files.makeDir(dir);
    for (const file of skill.files) {
      await sandbox.files.write(`${dir}/${file.relativePath}`, file.content);
    }
  }
}
