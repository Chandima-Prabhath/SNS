import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

/**
 * GET /api/music/debug
 *
 * Diagnostic endpoint that checks the yt-dlp setup from within the Next.js
 * process. This helps identify why downloads fail when the manual test works.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // H4 fix: gate behind admin/owner only — leaks server config, paths, cookies
  const userRole = (session.user as any).role
  if (userRole !== 'admin' && userRole !== 'owner') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 })
  }

  const results: any = {
    timestamp: new Date().toISOString(),
    process: {
      PATH: process.env.PATH,
      HOME: os.homedir(),
      YTDLP_COOKIES_PATH: process.env.YTDLP_COOKIES_PATH,
    },
    checks: {},
  }

  // 1. Check yt-dlp
  try {
    const { stdout } = await execFileAsync('yt-dlp', ['--version'])
    results.checks.yt_dlp = { installed: true, version: stdout.trim() }
  } catch (e: any) {
    results.checks.yt_dlp = { installed: false, error: e.message }
  }

  // 2. Check Deno
  try {
    const { stdout } = await execFileAsync('deno', ['--version'])
    results.checks.deno = { installed: true, version: stdout.split('\n')[0] }
  } catch (e: any) {
    results.checks.deno = { installed: false, error: 'Deno not found in PATH' }
    const denoPath = `${os.homedir()}/.deno/bin/deno`
    if (existsSync(denoPath)) {
      results.checks.deno.found_at = denoPath
    }
  }

  // 3. Check yt-dlp-ejs
  try {
    const { stdout } = await execFileAsync('python3', ['-c', 'import yt_dlp_ejs; print(yt_dlp_ejs.__version__)'])
    results.checks.yt_dlp_ejs = { installed: true, version: stdout.trim() }
  } catch (e: any) {
    results.checks.yt_dlp_ejs = { installed: false, error: 'not found' }
  }

  // 4. Check PO Token provider
  try {
    const res = await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(2000) })
    results.checks.pot_provider = { running: res.ok }
  } catch {
    results.checks.pot_provider = { running: false }
  }

  // 5. Check cookies
  const cookiesPath = process.env.YTDLP_COOKIES_PATH || './cookies.txt'
  if (existsSync(cookiesPath)) {
    const content = readFileSync(cookiesPath, 'utf-8')
    results.checks.cookies = {
      exists: true,
      size: content.length,
      has_header: content.startsWith('#'),
      has_keys: ['SID', 'SSID', 'HSID', 'APISID', 'SAPISID'].filter(k => content.includes(k)),
    }
  } else {
    results.checks.cookies = { exists: false, path: cookiesPath }
  }

  // 6. Run yt-dlp -v with Deno in PATH
  const home = os.homedir()
  const env = { ...process.env }
  if (existsSync(`${home}/.deno/bin`)) {
    env.PATH = `${home}/.deno/bin:${env.PATH || ''}`
  }

  try {
    const { stderr } = await execFileAsync('yt-dlp', [
      '-v', '--simulate', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    ], { env, timeout: 30000 })

    const debugLines = stderr.split('\n').filter(line =>
      line.includes('JS runtimes') ||
      line.includes('JS Challenge') ||
      line.includes('PO Token') ||
      line.includes('EJS') ||
      line.includes('n challenge') ||
      line.includes('optional libraries')
    )
    results.checks.verbose_output = debugLines
  } catch (e: any) {
    const stderr = e.stderr || ''
    results.checks.verbose_output = stderr.split('\n').filter((line: string) =>
      line.includes('JS runtimes') || line.includes('ERROR') || line.includes('PO Token')
    )
  }

  // 7. Diagnosis
  const diagnosis: string[] = []
  if (!results.checks.deno?.installed) {
    diagnosis.push('❌ Deno NOT in PATH — root cause. The stream route now adds ~/.deno/bin automatically.')
  } else {
    diagnosis.push('✅ Deno in PATH')
  }
  if (!results.checks.yt_dlp_ejs?.installed) {
    diagnosis.push('❌ yt-dlp-ejs not found — may be in a different Python venv')
  } else {
    diagnosis.push('✅ yt-dlp-ejs installed')
  }
  results.diagnosis = diagnosis

  return NextResponse.json(results)
}
