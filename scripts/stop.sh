#!/usr/bin/env bash
#
# stop.sh — stop the running Adoo server (PM2 or plain mode).
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Try PM2 first
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q adoo; then
  echo "▶ Stopping Adoo under PM2..."
  pm2 stop adoo
  echo "✓ Stopped (PM2). Use ./scripts/deploy.sh to restart."
  exit 0
fi

# Plain mode — kill via PID file
if [[ -f .adoo.pid ]]; then
  PID="$(cat .adoo.pid 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "▶ Stopping Adoo (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
    echo "✓ Stopped."
  else
    echo "▶ PID $PID not running — cleaning up stale PID file."
  fi
  rm -f .adoo.pid
else
  echo "▶ No PID file found. Trying to find adoo process by port..."
  # Fallback: find anything listening on port 3090
  PID=$(lsof -ti :3090 2>/dev/null || true)
  if [[ -n "$PID" ]]; then
    echo "▶ Found process on port 3090 (PID $PID) — killing..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
    echo "✓ Stopped."
  else
    echo "ℹ No running Adoo process found."
  fi
fi
