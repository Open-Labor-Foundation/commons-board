#!/bin/sh
# commons-board web entrypoint
# Checks for a rebuild signal written by the API when a pack with pages is installed.
# If the signal is present: runs `next build`, removes signal, then starts the server.
# Normal restarts (no signal) skip the build and start immediately.

SIGNAL_FILE="/app/signals/rebuild-web"

if [ -f "$SIGNAL_FILE" ]; then
  echo "[CB] Pack pages rebuild triggered. Building Next.js app..."
  cd /app/apps/web
  npm run build
  if [ $? -eq 0 ]; then
    cp -r .next/static .next/standalone/apps/web/.next/static
    cp -r public .next/standalone/apps/web/public 2>/dev/null || true
    echo "[CB] Rebuild complete."
  else
    echo "[CB] Rebuild failed — starting with previous build."
  fi
  rm -f "$SIGNAL_FILE"
fi

exec node /app/apps/web/.next/standalone/apps/web/server.js
