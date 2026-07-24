'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useVoiceCall } from '@/hooks/useVoiceCall'
import { useAppStore } from '@/stores/useAppStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Phone, PhoneOff, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

interface IncomingCall {
  callId: string
  from: {
    userId: string
    username: string
    displayName: string
  }
  channelId?: string
  dmGroupId?: string
}

/**
 * Full-screen overlay that appears when someone is calling you (DM calls only).
 *
 * Listens for `sns:incoming-call` custom events dispatched by the VoiceCallManager
 * (which receives them via the socket's `call:incoming` event).
 *
 * Accept → start our WebRTC, join the call, notify caller we accepted.
 * Reject → notify caller we rejected, dismiss overlay.
 * Caller cancels → overlay dismisses automatically via `sns:call-cancelled`.
 */
export function IncomingCallOverlay() {
  const { data: session } = useSession()
  const { startCall, leaveCall } = useVoiceCall()
  const setView = useAppStore((s) => s.setView)

  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    const onIncoming = (e: Event) => {
      const detail = (e as CustomEvent).detail as IncomingCall
      // Don't show if we're already in a call
      setIncoming(detail)
    }
    const onCancelled = (e: Event) => {
      const detail = (e as CustomEvent).detail as { callId: string }
      if (incoming?.callId === detail.callId) {
        setIncoming(null)
        toast.info('Call cancelled')
      }
    }
    window.addEventListener('sns:incoming-call', onIncoming as EventListener)
    window.addEventListener('sns:call-cancelled', onCancelled as EventListener)
    return () => {
      window.removeEventListener('sns:incoming-call', onIncoming as EventListener)
      window.removeEventListener('sns:call-cancelled', onCancelled as EventListener)
    }
  }, [incoming?.callId])

  const handleAccept = async () => {
    if (!incoming || !session?.user) return
    setAccepting(true)
    try {
      // Start our WebRTC side
      await startCall({
        callId: incoming.callId,
        channelId: incoming.channelId,
        dmGroupId: incoming.dmGroupId,
      })

      // Notify the caller that we accepted (so their UI stops ringing)
      const { getSocket } = await import('@/lib/socket')
      const socket = await getSocket()
      socket.emit('call:accept', { callId: incoming.callId, byUserId: incoming.from.userId })

      // Switch to the voice view
      setView('voice')
      setIncoming(null)
    } catch (e: any) {
      toast.error('Failed to join call: ' + e.message)
      await leaveCall()
    } finally {
      setAccepting(false)
    }
  }

  const handleReject = async () => {
    if (!incoming) return
    try {
      const { getSocket } = await import('@/lib/socket')
      const socket = await getSocket()
      socket.emit('call:reject', { callId: incoming.callId, byUserId: incoming.from.userId })
    } catch {}
    setIncoming(null)
  }

  return (
    <AnimatePresence>
      {incoming && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex flex-col items-center text-center max-w-sm w-full"
          >
            {/* Avatar with pulsing ring */}
            <div className="relative mb-6">
              <motion.div
                className="absolute inset-0 rounded-full bg-primary/30"
                animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-primary/20"
                animate={{ scale: [1, 1.3, 1.3], opacity: [0.5, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
              />
              <Avatar className="w-32 h-32 relative">
                <AvatarImage src={undefined} />
                <AvatarFallback className="text-5xl bg-primary/15 text-primary">
                  {incoming.from.displayName?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            </div>

            <h2 className="text-2xl font-semibold mb-1">{incoming.from.displayName}</h2>
            <p className="text-muted-foreground mb-1">@{incoming.from.username}</p>
            <p className="text-sm text-muted-foreground mb-8 flex items-center gap-1.5">
              <motion.span
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                Incoming voice call...
              </motion.span>
            </p>

            {/* Action buttons */}
            <div className="flex gap-8">
              <button
                onClick={handleReject}
                disabled={accepting}
                className="flex flex-col items-center gap-2"
              >
                <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors active:scale-95">
                  <PhoneOff className="w-7 h-7 text-white" />
                </div>
                <span className="text-sm text-muted-foreground">Decline</span>
              </button>

              <button
                onClick={handleAccept}
                disabled={accepting}
                className="flex flex-col items-center gap-2"
              >
                <div className="w-16 h-16 rounded-full bg-status-online flex items-center justify-center hover:opacity-90 transition-opacity active:scale-95">
                  {accepting ? (
                    <Loader2 className="w-7 h-7 text-white animate-spin" />
                  ) : (
                    <Phone className="w-7 h-7 text-white" />
                  )}
                </div>
                <span className="text-sm text-muted-foreground">Accept</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
