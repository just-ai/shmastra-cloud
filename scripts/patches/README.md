# Patches

One-shot scripts that run against existing sandboxes during the **patch** phase
of the update pipeline. Use them to retrofit changes that aren't covered by
pulling new code (apt packages, files written outside the repo, daemon env
vars, etc.). New sandboxes don't run patches — the template + provisioning
flow already produces the target state.

## How they're applied

Patches live in this directory as numbered `*.ts` files (e.g.
`007_install_foo.ts`). The runner at `manage/update/runner.mts`:

1. Lists every `.ts`/`.js` file here, sorted by filename.
2. Reads `sandboxes.version` (the numeric prefix of the last applied patch)
   from Supabase.
3. Imports and runs every patch whose id is **strictly greater** than the
   stored version, in order, calling its default export with `UpdateContext`.
4. After each patch succeeds, writes the new id to `sandboxes.version`.

Failures abort the pipeline and trigger the standard rollback (git reset,
`.duckdb` restore, pm2 revive on the old code). Patches must therefore be
idempotent: a partial run followed by a rollback and retry should converge.

## Writing a patch

Pick the next unused number, then create `<NNN>_<short_name>.ts`:

```ts
import type { UpdateContext } from "@/manage/update/runner.mjs";

export default async function ({ sandbox, run, log, env, addEnvs }: UpdateContext) {
  // ...
}
```

The `UpdateContext` gives you:

- `sandbox` — the live `e2b` `Sandbox` instance (use `sandbox.files.*` for I/O).
- `run(cmd, opts?)` — shell exec on the sandbox; supports `timeoutMs` and
  `throwOnError`. Honors the pipeline's abort signal automatically.
- `log(msg)` — line goes to the CLI and the SSE stream in `--serve` mode.
- `env` — `{ user, sandbox, appUrl }` resolved once before the patch phase.
  Use this instead of re-querying Supabase.
- `addEnvs(record)` — queue env vars for the daemon. They're merged and
  applied in the `restart` phase via a single pm2 reload, so multiple patches
  can each declare envs without each restarting pm2.

For env-only patches, prefer the `addDaemonEnvs` helper:

```ts
import type { UpdateContext } from "@/manage/update/runner.mjs";
import { addDaemonEnvs } from "@/manage/update/utils.mjs";

export default (ctx: UpdateContext) =>
  addDaemonEnvs(ctx, ({ user, appUrl }) => ({
    SOME_BASE_URL: `${appUrl}/api/gateway/foo`,
  }));
```

## Guidelines

- **Numbering is permanent.** Once a patch ships and runs against any sandbox,
  don't rename or renumber it — `sandboxes.version` would no longer match.
  If a patch is wrong, write a follow-up with a higher number.
- **Idempotent.** Re-running a patch must be safe (use `apt-get install -y`,
  overwrite files instead of appending, check before mutating).
- **No DB schema changes here.** Schema migrations belong in
  `supabase/migrations/`.
- **Don't restart pm2 yourself.** The `restart` phase handles it once, after
  all patches have declared their envs via `addEnvs` / `addDaemonEnvs`.
- **Keep them small and obvious.** A patch should do one thing; if it grows,
  factor the helper into `manage/update/utils.mts` and call it from the patch.

## Running

Patches run automatically during `npx tsx manage/index.mts <sandbox_id>` and
through the `--serve` web UI. There's no separate command — they execute as
part of the update pipeline (`fetch → merge → install → build → migrate →
apply → patch → restart`).
