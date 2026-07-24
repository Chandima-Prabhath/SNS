'use client'

import { useSession } from 'next-auth/react'
import { AuthScreen } from '@/components/auth/auth-screen'
import { BottomNav, DesktopSidebar } from '@/components/layout/navigation'
import { ChatView } from '@/components/chat/chat-view'
import { StatusView } from '@/components/status/status-view'
import { VoiceView } from '@/components/voice/voice-view'
import { SettingsView } from '@/components/settings/settings-view'
import { useAppStore } from '@/stores/useAppStore'
import { useSocket } from '@/hooks/useSocket'
import { Toaster } from '@/components/ui/sonner'
import { Loader2 } from 'lucide-react'

export function AppShell() {
  const { status } = useSession()
  const view = useAppStore((s) => s.view)
  const activeChannelId = useAppStore((s) => s.activeChannelId)

  // Init the singleton socket connection (also drives presence + chat)
  useSocket()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <>
        <AuthScreen />
        <Toaster />
      </>
    )
  }

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Desktop sidebar (left rail) */}
      <DesktopSidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 min-h-0 overflow-hidden">
          {/* On mobile, when a chat is active, the chat view goes full-screen
              (position: fixed, inset: 0, z-20) and covers the bottom nav. */}

          {view === 'chats' && <ChatView />}
          {view === 'status' && <StatusView />}
          {view === 'voice' && <VoiceView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Bottom tab bar — mobile only, hidden when a chat is active (chat covers it) */}
      <BottomNav />
      <Toaster />
    </div>
  )
}
