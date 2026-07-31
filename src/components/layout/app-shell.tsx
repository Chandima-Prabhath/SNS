'use client'

import { useSession } from 'next-auth/react'
import { AuthScreen } from '@/components/auth/auth-screen'
import { BottomNav } from '@/components/layout/navigation'
import { ServerRail } from '@/components/chat/server-rail'
import { ChatView } from '@/components/chat/chat-view'
import { StatusView } from '@/components/status/status-view'
import { VoiceView } from '@/components/voice/voice-view'
import { SettingsView } from '@/components/settings/settings-view'
import { MusicView } from '@/components/music/music-view'
import { CinemaView } from '@/components/cinema/cinema-view'
import { GlobalMusicPlayer } from '@/components/music/global-music-player'
import { EntertainmentDrawer } from '@/components/layout/entertainment-drawer'
import { IncomingCallOverlay } from '@/components/voice/incoming-call-overlay'
import { CallController } from '@/components/voice/call-controller'
import { FirefoxBanner } from '@/components/voice/firefox-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OfflineBanner } from '@/components/layout/offline-banner'
import { useAppStore } from '@/stores/useAppStore'
import { useSocket } from '@/hooks/useSocket'
import { useNotifications } from '@/hooks/useNotifications'
import { useGlobalTyping } from '@/hooks/useGlobalTyping'
import { usePermissionManager } from '@/hooks/usePermissionManager'
import { useOfflineSession, getCachedSession } from '@/hooks/useOfflineSession'
import { Toaster } from '@/components/ui/sonner'
import { Loader2 } from 'lucide-react'

export function AppShell() {
  const { status } = useSession()
  const view = useAppStore((s) => s.view)

  // Cache the session for offline use
  useOfflineSession()

  useSocket()
  useNotifications()
  useGlobalTyping()
  usePermissionManager()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  // If next-auth says unauthenticated, check if we're offline and have a
  // cached session — if so, let the user in with cached data.
  if (status === 'unauthenticated') {
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine
    const cached = getCachedSession()
    if (!isOffline || !cached) {
      return (
        <>
          <AuthScreen />
          <Toaster />
        </>
      )
    }
    // Offline with cached session — fall through to the main app
    console.log('[offline] using cached session, app is in offline mode')
  }

  return (
    <CallController>
      <GlobalMusicPlayer>
        <FirefoxBanner />
        <UpdateBanner />
        <OfflineBanner />
        <div className="h-dvh flex flex-col bg-background overflow-hidden">
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* ServerRail is the single primary sidebar on desktop.
                Contains: DMs, server icons, create/join, bottom nav (Status/Calls/Settings), user avatar.
                On mobile it's hidden — BottomNav handles navigation there. */}
            <ServerRail />
            <div className="flex-1 flex flex-col min-w-0">
              <main className="flex-1 min-h-0 overflow-hidden">
                {view === 'chats' && <ChatView />}
                {view === 'status' && <StatusView />}
                {view === 'voice' && <VoiceView />}
                {view === 'music' && <MusicView />}
                {view === 'cinema' && <CinemaView />}
                {view === 'settings' && <SettingsView />}
              </main>
            </div>
          </div>
          <BottomNav />
          <EntertainmentDrawer />
          <IncomingCallOverlay />
          <Toaster />
        </div>
      </GlobalMusicPlayer>
    </CallController>
  )
}
