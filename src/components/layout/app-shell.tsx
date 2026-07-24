'use client'

import { useSession } from 'next-auth/react'
import { AuthScreen } from '@/components/auth/auth-screen'
import { Sidebar, MobileTopBar } from '@/components/layout/sidebar'
import { ChatView } from '@/components/chat/chat-view'
import { StatusView } from '@/components/status/status-view'
import { VoiceView } from '@/components/voice/voice-view'
import { BotsView } from '@/components/bots/bots-view'
import { SettingsView } from '@/components/settings/settings-view'
import { AdminView } from '@/components/admin/admin-view'
import { useAppStore } from '@/stores/useAppStore'
import { useSocket } from '@/hooks/useSocket'
import { Toaster } from '@/components/ui/sonner'
import { Loader2 } from 'lucide-react'

export function AppShell() {
  const { data: session, status } = useSession()
  const view = useAppStore((s) => s.view)

  // Init the singleton socket connection (also drives presence + chat)
  useSocket()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status === 'unauthenticated' || !session?.user) {
    return (
      <>
        <AuthScreen />
        <Toaster />
      </>
    )
  }

  const user = session.user as any
  const isAdmin = user.role === 'admin' || user.role === 'owner'

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopBar />
        <main className="flex-1 min-h-0 overflow-hidden">
          {view === 'chat' && <ChatView />}
          {view === 'status' && <StatusView />}
          {view === 'voice' && <VoiceView />}
          {view === 'bots' && <BotsView />}
          {view === 'settings' && <SettingsView />}
          {view === 'admin' && isAdmin && <AdminView />}
          {view === 'admin' && !isAdmin && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Admin access required.
            </div>
          )}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
