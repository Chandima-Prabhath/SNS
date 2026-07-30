'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { BotBuilderEditor } from '@/components/bots/bot-builder-editor'
import type { BotFlow } from '@/lib/bot/flow-types'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Standalone bot builder page — opens in a full-width tab without the app
 * shell, sidebar, or bottom nav. This gives the canvas maximum space and
 * makes the builder usable on mobile.
 *
 * Because it's a standalone route (not rendered through the main page.tsx
 * which sets up providers), we wrap it in SessionProvider + QueryClientProvider
 * + ThemeProvider here so the editor's useQuery hooks work.
 */
function BotBuilderContent() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [bot, setBot] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [initialFlow, setInitialFlow] = useState<BotFlow | undefined>(undefined)

  useEffect(() => {
    if (!params.id) return
    fetch('/api/bots')
      .then((r) => r.json())
      .then((data) => {
        const found = data.bots?.find((b: any) => b.id === params.id)
        if (!found) {
          toast.error('Bot not found')
          router.push('/')
          return
        }
        setBot(found)
        try {
          setInitialFlow(found.flow ? JSON.parse(found.flow) : undefined)
        } catch {
          setInitialFlow(undefined)
        }
      })
      .finally(() => setLoading(false))
  }, [params.id, router])

  const handleSave = async (flow: BotFlow) => {
    try {
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow }),
      })
      if (!res.ok) throw new Error('failed')
      toast.success('Bot flow saved')
      setInitialFlow(flow)
    } catch {
      toast.error('Failed to save flow')
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading bot builder…</div>
      </div>
    )
  }

  if (!bot) return null

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-border/50 bg-card/50 backdrop-blur-xl">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => router.push('/')} title="Back to app">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">{bot.name}</h1>
          <p className="text-[11px] text-muted-foreground truncate">@{bot.username} · Bot Builder</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
          Developer Mode
        </span>
      </header>

      <div className="flex-1 min-h-0">
        <BotBuilderEditor initialFlow={initialFlow} onSave={handleSave} bot={bot} />
      </div>
    </div>
  )
}

export default function BotBuilderPage() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      })
  )

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SessionProvider>
        <QueryClientProvider client={qc}>
          <BotBuilderContent />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
