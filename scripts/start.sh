#!/bin/bash
set -e

cd "/home/user/shmastra"

# Manual helper for starting the app inside a running sandbox.
pnpm dev &

echo "Mastra server is starting on port 4111..."

# Keep the process alive
wait
