'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { ChatList } from './chat-list'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'
import { ChatHeader } from './chat-header'
import { ChatInfoPanel } from './chat-info-panel'
import { MessageCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function ChatView() {
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const chatInfoOpen = useAppStore((s) => s.chatInfoOpen)

  // Preload channels so ChatHeader has data instantly
  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const activeChannel = groups
    ?.flatMap((g) => g.channels)
    .find((c) => c.id === activeChannelId)

  return (
    <div className="flex h-full relative">
      {/* Chat list — full width on mobile when no chat is open, sidebar on desktop */}
      <div
        className={
          activeChannelId
            ? 'hidden lg:flex w-80 xl:w-96 shrink-0 border-r h-full'
            : 'flex w-full lg:w-80 xl:w-96 shrink-0 lg:border-r h-full'
        }
      >
        <ChatList />
      </div>

      {/* Active chat — full screen on mobile (slides in over list), fills remaining on desktop */}
      <AnimatePresence>
        {activeChannelId && activeChannel ? (
          <motion.div
            key="chat"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col min-w-0 bg-background absolute inset-0 z-40 lg:static lg:inset-auto lg:z-auto lg:flex-1 h-full"
          >
            <ChatHeader channel={activeChannel} />
            <MessageList channelId={activeChannel.id} />
            <MessageComposer channelId={activeChannel.id} />
          </motion.div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center bg-background">
            <div className="text-center max-w-sm px-6">
              <div className="w-24 h-24 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-5 ring-1 ring-primary/15">
                <MessageCircle className="w-11 h-11 text-primary" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-semibold mb-1.5">Your messages</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Select a conversation from the list, or start a new one by tapping the + button.
              </p>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Chat info panel — desktop right panel / mobile Sheet */}
      {chatInfoOpen && <ChatInfoPanel channel={activeChannel} />}
    </div>
  )
}
