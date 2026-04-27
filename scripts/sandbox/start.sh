#!/bin/bash
set -e

# Symlink node_modules so healer can resolve @mastra/* imports
ln -sf /home/user/shmastra/node_modules /home/user/node_modules

# Compile healer.mts → healer.cjs (single process, no tsx overhead)
/home/user/shmastra/node_modules/.bin/esbuild /home/user/healer.mts \
  --bundle --platform=node --format=cjs --target=node20 \
  --external:pm2 \
  --outfile=/home/user/healer.cjs

# Configure pm2-logrotate by writing module_conf.json directly. Cheaper and
# safer than three `pm2 set` calls — each of those forks a node CLI and
# restarts the logrotate module, which has OOM-killed the third call on
# memory-tight resumed sandboxes (exit 137).
node -e '
const fs = require("fs");
const path = require("path");
const file = path.join(process.env.HOME, ".pm2", "module_conf.json");
let conf = {};
try { conf = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
conf["pm2-logrotate"] = {
  ...(conf["pm2-logrotate"] || {}),
  max_size: "5M",
  retain: 5,
  compress: true,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(conf, null, 2));
'

# Start or reload apps via pm2 ecosystem config.
# --update-env forces PM2 to re-read the config's env (including daemon envs
# extracted inside ecosystem.config.cjs) instead of reusing cached values.
pm2 startOrReload /home/user/ecosystem.config.cjs --update-env

echo "Shmastra server is starting"
