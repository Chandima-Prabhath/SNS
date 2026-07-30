#!/usr/bin/env bash
#
# deploy.sh — foolproof production deploy for Adoo on the Azure VM.
#
# Runs the Next.js + Socket.io server with Node.js + tsx (NOT Bun) to avoid
# Bun's streaming HTTP response issues that caused TTS audio to arrive as
# 0-length in production.
#
# Two modes:
#   PM2 mode (preferred): auto-restart, log rotation, boot-time startup
#   Plain mode (fallback): Node.js + nohup + PID file (if PM2 can't install)
#
# Usage:
#   ./scripts/deploy.sh             # full deploy (build + restart)
#   ./scripts/deploy.sh --no-build  # just restart (after a code-only change)
#   ./scripts/deploy.sh --plain     # force plain Node.js mode (no PM2)
#
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
echo "▶ Project root: $PROJECT_ROOT"

# ─── 0. Ensure Node.js is available ──────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install it first:"
  echo "    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -"
  echo "    sudo apt install -y nodejs"
  exit 1
fi
echo "▶ Node.js version: $(node --version)"

# ─── 1. Build (unless --no-build) ────────────────────────────────────────────
if [[ "${1:-}" != "--no-build" && "${2:-}" != "--no-build" ]]; then
  echo "▶ Building Next.js app (this can take a minute)..."
  # Use bun for the build step — it's fast and build doesn't have the
  # streaming runtime issue (only the long-running server does).
  bun run build
  echo "✓ Build complete"
else
  echo "▶ Skipping build (--no-build)"
fi

# ─── 2. Decide mode: PM2 or plain ────────────────────────────────────────────
FORCE_PLAIN=false
[[ "${1:-}" == "--plain" || "${2:-}" == "--plain" ]] && FORCE_PLAIN=true

USE_PM2=false
if [[ "$FORCE_PLAIN" == "false" ]]; then
  if command -v pm2 >/dev/null 2>&1; then
    USE_PM2=true
  else
    echo "▶ PM2 not found — attempting install..."
    # Try without sudo first (works if npm global prefix is user-writable)
    if npm install -g pm2 2>/dev/null; then
      USE_PM2=true
      echo "✓ PM2 installed (user-writable global prefix)"
    else
      echo "▶ PM2 install needs sudo — attempting with sudo..."
      if sudo npm install -g pm2 2>/dev/null; then
        USE_PM2=true
        echo "✓ PM2 installed (with sudo)"
      else
        echo "⚠ Could not install PM2. Falling back to plain Node.js mode."
        echo "  (To use PM2 later: sudo npm install -g pm2)"
        USE_PM2=false
      fi
    fi
  fi
fi

# ─── 3a. PM2 mode ────────────────────────────────────────────────────────────
if [[ "$USE_PM2" == "true" ]]; then
  echo "▶ PM2 version: $(pm2 --version)"
  echo "▶ (Re)starting Adoo under PM2 with Node.js runtime..."
  pm2 start ecosystem.config.cjs --update-env 2>/dev/null || pm2 reload ecosystem.config.cjs
  pm2 save 2>/dev/null || true

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo " ✓ Deploy complete. Adoo is running under PM2 on port 3090."
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  pm2 status adoo
  echo ""
  echo " Useful commands:"
  echo "   pm2 logs adoo              # tail logs"
  echo "   pm2 restart adoo           # restart after a code update"
  echo "   pm2 stop adoo              # stop the app"
  echo "   pm2 monit                  # live CPU/memory dashboard"
  echo ""
  echo " First-time only — enable boot startup:"
  echo "   pm2 startup systemd"
  echo "   (then run the command PM2 prints, then: pm2 save)"
  exit 0
fi

# ─── 3b. Plain Node.js mode (fallback) ───────────────────────────────────────
echo "▶ Starting Adoo with plain Node.js + tsx (no PM2)..."
mkdir -p logs

# Stop any existing adoo process
if [[ -f .adoo.pid ]]; then
  OLD_PID="$(cat .adoo.pid 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "▶ Stopping previous Adoo process (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f .adoo.pid
fi

# Start with nohup — survives SSH disconnect
# npx tsx runs server.ts under Node.js with TypeScript support
nohup npx tsx server.ts > logs/adoo-out.log 2> logs/adoo-error.log &
NEW_PID=$!
echo "$NEW_PID" > .adoo.pid
sleep 3

# Verify it's running
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo " ✓ Deploy complete. Adoo running with Node.js on port 3090."
  echo "   PID: $NEW_PID"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo " Logs:"
  echo "   tail -f logs/adoo-out.log    # stdout"
  echo "   tail -f logs/adoo-error.log  # stderr"
  echo ""
  echo " Manage:"
  echo "   kill \$(cat .adoo.pid)        # stop"
  echo "   ./scripts/deploy.sh          # restart (rebuild + relaunch)"
  echo "   ./scripts/deploy.sh --no-build  # restart without rebuilding"
  echo ""
  echo " To survive VM reboots, add to crontab (crontab -e):"
  echo "   @reboot cd $PROJECT_ROOT && ./scripts/deploy.sh --no-build"
else
  echo "✗ Failed to start Adoo. Check logs/adoo-error.log"
  exit 1
fi
