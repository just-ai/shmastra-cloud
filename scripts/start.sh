#!/bin/bash
set -e

# Start app via pm2 ecosystem config
pm2 start /home/user/ecosystem.config.cjs

# Configure log rotation (pm2-logrotate installed at build time)
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true

echo "Shmastra server is starting"
