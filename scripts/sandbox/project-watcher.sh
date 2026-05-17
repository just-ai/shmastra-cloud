#!/bin/bash
# Project auto-sync watcher (bash + inotifywait).
#
# Runs as a PM2 daemon inside the sandbox. Watches /home/user/shmastra for
# edits, debounces, then commits whatever changed and pushes to the
# `project` git remote. The remote points at the cloud's git proxy, which
# holds the GitLab service token server-side; this process only knows
# PROJECT_TOKEN (the per-user token already in its env).
#
# Update pipeline coordinates with us by `pm2 stop project-watcher` before
# the update and `pm2 start project-watcher` in `finally`. We don't read
# any sentinel files.
#
# Why bash + inotifywait instead of Node + fs.watch:
#   - fs.watch({recursive}) on Linux allocates one inotify watcher per
#     subdirectory. On a Mastra project that's ~77k handles and ~100 MiB
#     heap just to hold the JS FSWatcher wrappers.
#   - inotifywait's `@<path>` suppresses watch allocation at startup, so
#     we never spend a handle on node_modules/.mastra/etc.
#   - We derive the exclude list from `.gitignore` via `git ls-files`, so
#     the watcher inherits the user's gitignore semantics automatically.
#   - If `.gitignore` is edited, we exit 0 after the next push; pm2's
#     autorestart brings us back up with refreshed excludes.

set -u

REPO=/home/user/shmastra
ENV_FILE="$REPO/.env"
MANIFEST="$REPO/shmastra.json"
DEBOUNCE=3

log() {
  printf '[%s] %s\n' "$(date -uIs)" "$*"
}

# Rewrite the tracked manifest with the current set of env var names
# (names only — never values; .env itself is gitignored). Idempotent: if
# .env contents haven't changed, the new file is byte-identical to the
# previous one and git sees no diff.
regenerate_manifest() {
  local keys="[]"
  if [ -f "$ENV_FILE" ]; then
    keys=$(awk -F= '/^[A-Z_][A-Z0-9_]*[[:space:]]*=/ {print $1}' "$ENV_FILE" \
           | awk '!seen[$0]++' \
           | jq -R . | jq -s .)
  fi
  printf '{\n  "version": 1,\n  "env": %s\n}\n' "$keys" > "$MANIFEST"
}

push_changes() {
  cd "$REPO" || return
  # Refuse to push during an in-progress merge or with unresolved conflicts.
  # `git add -A` would otherwise stage files containing `<<<<<<<`/`>>>>>>>`
  # markers as if they were resolved, and `git commit --no-verify` would
  # finalize that as a merge commit. We've seen that path corrupt the
  # user's GitLab repo (see incident with sandbox i7qt53zl4t7iefg3djg0m,
  # 2026-05-17). Wait for someone — provision flow / update resolver / the
  # human — to finish the merge; we'll retry on the next fs event.
  if [ -e .git/MERGE_HEAD ] || [ -e .git/REBASE_HEAD ] \
     || [ -n "$(git ls-files -u 2>/dev/null)" ]; then
    log "merge in progress (unresolved conflicts), skipping push"
    return
  fi
  regenerate_manifest || log "manifest regen failed"
  git add -A
  if git diff --cached --quiet; then
    return
  fi
  local msg="Edit $(date -uIs)"
  # --no-verify skips client-side hooks (pre-commit, pre-push). This is a
  # background auto-sync, not a user-initiated push — we don't want the
  # project's test suite or linter running on every keystroke-debounced
  # commit.
  if git commit --no-verify -m "$msg" >/dev/null 2>&1 \
     && git push --no-verify project main >/dev/null 2>&1; then
    log "pushed: $msg"
  else
    log "push failed; will retry on next change"
  fi
}

# Pull the list of ignored directory paths from git itself and translate
# them into inotifywait @<path> exclusions. `--directory --ignored
# --exclude-standard` collapses each ignored subtree to a single trailing-
# slash entry, so we don't enumerate every individual file inside.
compute_excludes() {
  local excludes=""
  local p
  while IFS= read -r p; do
    [[ "$p" == */ ]] || continue
    p="${p%/}"
    excludes+=" @$REPO/$p"
  done < <(git -C "$REPO" ls-files --others --directory --ignored --exclude-standard 2>/dev/null)
  # .git is special: not present in .gitignore (it's internal to git) but
  # obviously must not be watched. Add it explicitly.
  excludes+=" @$REPO/.git"
  printf '%s\n' "$excludes"
}

if [ ! -d "$REPO" ]; then
  log "Repo dir $REPO not found, exiting"
  exit 1
fi

GITIGNORE_MTIME=$(stat -c %Y "$REPO/.gitignore" 2>/dev/null || echo 0)
EXCLUDES=$(compute_excludes)

shutdown() {
  log "shutdown on $1"
  push_changes
  exit 0
}
trap 'shutdown SIGTERM' SIGTERM
trap 'shutdown SIGINT' SIGINT

log "watching $REPO"

# Main loop. Outer `read` blocks until the first event arrives. The inner
# `read -t $DEBOUNCE` returns non-zero when no event arrives for that many
# seconds — exactly the "settle window after last edit" semantics chokidar
# provided in the Node version.
#
# shmastra.json is excluded so our own manifest rewrite doesn't feed the
# watcher its own write. Editor swap/temp files are excluded so they don't
# trigger empty push attempts.
#
# shellcheck disable=SC2086 — EXCLUDES is intentionally word-split.
while IFS= read -r _; do
  while IFS= read -r -t "$DEBOUNCE" _; do :; done
  push_changes
  new_mtime=$(stat -c %Y "$REPO/.gitignore" 2>/dev/null || echo 0)
  if [ "$new_mtime" != "$GITIGNORE_MTIME" ]; then
    log ".gitignore changed → restarting to refresh excludes"
    exit 0
  fi
done < <(inotifywait -m -r -q --format '%w%f' \
            --exclude '(^|/)(shmastra\.json|.*\.duckdb([-.][^/]*)?|.*\.swp|.*\.tmp|.*~)$' \
            $EXCLUDES \
            -e modify,create,delete,move \
            "$REPO")

log "inotifywait pipe closed, exiting"
