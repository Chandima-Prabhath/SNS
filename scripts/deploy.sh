#!/usr/bin/env bash
#
# deploy.sh — foolproof production deploy for Adoo on the Azure VM.
#
# What it does:
#   1. Installs PM2 globally if missing
#   2. Enables PM2 to start on VM boot (systemd)
#   3. Builds the Next.js app (next build)
#   4. (Re)starts the app under PM2 with Node.js + tsx (NOT bun)
#   5. Saves the PM2 process list so it survives reboots
#
# Usage:
#   ./scripts/deploy.sh           # full deploy (build + restart)
#   ./scripts/deploy.sh --no-build  # just restart PM2 (after a code-only change)
#
# After the first deploy, set up boot-time startup ONCE:
#   pm2 startup systemd
#   (run the command PM2 prints, then `pm2 save`)
#
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
echo "▶ Project root: $PROJECT_ROOT"

# ─── 1. Ensure PM2 is installed ──────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  echo "▶ PM2 not found — installing globally..."
  npm install -g pm2
fi
echo "▶ PM2 version: $(pm2 --version)"

# ─── 2. Build (unless --no-build) ────────────────────────────────────────────
if [[ "${1:-}" != "--no-build" ]]; then
  echo "▶ Building Next.js app (this can take a minute)..."
  # Use bun for the build step — it's fast and build doesn't have the
  # streaming runtime issue (only the long-running server does).
  bun run build
  echo "✓ Build complete"
else
  echo "▶ Skipping build (--no-build)"
fi

# ─── 3. (Re)start under PM2 ──────────────────────────────────────────────────
echo "▶ (Re)starting Adoo under PM2 with Node.js runtime..."
# `pm2 start` is idempotent: if the app is already running, it reloads it;
# if not, it starts fresh. We use `pm2 startOrReload` semantics via start.
pm2 start ecosystem.config.cjs --update-env 2>/dev/null || pm2 reload ecosystem.config.cjs

# ─── 4. Save process list (so PM2 restores on reboot) ────────────────────────
echo "▶ Saving PM2 process list..."
pm2 save

# ─── 5. Status ───────────────────────────────────────────────────────────────
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
