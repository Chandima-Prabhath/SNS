'use client'

import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState, useEffect } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { useAppStore } from '@/stores/useAppStore'

export default function Home() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000, // Don't refetch within 30s
          },
        },
      })
  )

  // Read URL params for deep-linking from notifications
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const view = params.get('view')
    const channel = params.get('channel')
    const callId = params.get('callId')

    if (view && ['chats', 'status', 'voice', 'settings'].includes(view)) {
      useAppStore.getState().setView(view as any)
    }
    if (channel) {
      useAppStore.getState().setActiveChannel(channel)
    }

    // Clean the URL (remove query params) after processing
    if (view || channel || callId) {
      window.history.replaceState({}, '', '/')
    }
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SessionProvider>
        <QueryClientProvider client={qc}>
          <AppShell />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
