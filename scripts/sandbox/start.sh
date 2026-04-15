#!/bin/bash
set -e

# Symlink node_modules so healer.mts (in /home/user/) can resolve @mastra/* imports
ln -sf /home/user/shmastra/node_modules /home/user/node_modules

# Start app via pm2 ecosystem config
pm2 start /home/user/ecosystem.config.cjs

# Configure log rotation (pm2-logrotate installed at build time)
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true

echo "Shmastra server is starting"
