/**
 * PM2 Ecosystem — production process manager for Adoo.
 *
 * WHY PM2 + NODE (instead of `bun run start`)?
 * ============================================
 * Bun's runtime has known issues streaming HTTP response bodies and piping
 * `fetch()` streams through Next.js route handlers in production mode. This
 * caused TTS audio to arrive at the client as a 0-length / unplayable file
 * even though generation succeeded. Switching to Node.js (via tsx, which
 * transpiles server.ts on the fly) eliminates the runtime-level streaming
 * bugs. PM2 adds auto-restart, log rotation, and boot-time startup.
 *
 * USAGE
 * =====
 *   # One-time: install PM2 globally + enable boot startup
 *   npm install -g pm2
 *   pm2 startup systemd    # follow the printed instruction
 *
 *   # Start / stop / restart / logs / status
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop adoo
 *   pm2 restart adoo
 *   pm2 reload adoo        # zero-downtime reload (cluster mode only)
 *   pm2 logs adoo
 *   pm2 status
 *
 *   # Deploy after a code update
 *   bun run build && pm2 restart adoo
 *
 *   # Save the running process list so PM2 restores it on VM reboot
 *   pm2 save
 *
 * ENVIRONMENT
 * ===========
 * The .env file is loaded by server.ts via the `dotenv` package. This
 * works for BOTH Bun (which also loads .env natively — the dotenv import
 * is a no-op) and Node/PM2/tsx (which don't load .env automatically).
 *
 * Required env vars (set in .env at the project root):
 *   NEXTAUTH_SECRET     — JWT signing secret (CRITICAL — socket auth fails without it)
 *   NEXTAUTH_URL        — e.g. https://your-domain.com (must include https://)
 *   DATABASE_URL        — SQLite path, e.g. file:/home/z/my-project/db/custom.db
 *   TTS_URL             — Pocket TTS server URL, e.g. http://localhost:8000
 *   OLLAMA_URL          — Ollama LLM URL, e.g. http://localhost:11434
 *   YTDLP_COOKIES_PATH  — path to cookies.txt for YouTube downloads (optional)
 */
module.exports = {
  apps: [
    {
      name: 'adoo',
      // Run server.ts with Node.js via tsx. tsx is a thin TypeScript loader
      // for Node that handles ESM + CJS + path aliases. We use `npx tsx` so
      // we don't need a global tsx install.
      script: 'server.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      // production env (base vars — secrets are loaded from .env by server.ts)
      env: {
        NODE_ENV: 'production',
        PORT: '3090',
        HOSTNAME: '0.0.0.0',
      },
      // Auto-restart on crash
      autorestart: true,
      // Wait 10s between an unexpected crash and a restart attempt
      restart_delay: 10_000,
      // Restart at most 10 times within a 60s window; if it keeps crashing,
      // something is seriously wrong and we don't want a restart loop.
      max_restarts: 10,
      min_uptime: '60s',
      // Logs — rotate to avoid disk fill
      log_file: './logs/adoo-out.log',
      error_file: './logs/adoo-error.log',
      merge_logs: true,
      time: true,
      // Don't run as root — PM2 will warn but still work
      kill_timeout: 5000,
      // Listen for changes (optional, off in prod — use `pm2 restart` after deploy)
      watch: false,
      // Max memory before PM2 restarts the process (1.5GB — generous for
      // Next.js + Socket.io + yt-dlp subprocesses + TTS proxy)
      max_memory_restart: '1500M',
    },
  ],
}
