#!/bin/bash
set -e

# Symlink node_modules so healer can resolve @mastra/* imports
ln -sf /home/user/shmastra/node_modules /home/user/node_modules

# Compile healer.mts → healer.cjs (single process, no tsx overhead)
/home/user/shmastra/node_modules/.bin/esbuild /home/user/healer.mts \
  --bundle --platform=node --format=cjs --target=node20 \
  --external:pm2 \
  --outfile=/home/user/healer.cjs

# Start or reload apps via pm2 ecosystem config.
# --update-env forces PM2 to re-read the config's env (including daemon envs
# extracted inside ecosystem.config.cjs) instead of reusing cached values.
pm2 startOrReload /home/user/ecosystem.config.cjs --update-env

# Configure log rotation (pm2-logrotate installed at build time)
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true

# Save process list so pm2 resurrect works after daemon restart
pm2 save

echo "Shmastra server is starting"
