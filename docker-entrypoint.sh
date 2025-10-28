#!/bin/sh
set -e

echo "[entrypoint] Running prisma generate..."
# Ensure prisma schema is present and generate client for the runtime platform
npx prisma generate

echo "[entrypoint] Starting application..."
exec node dist/container/index.js

