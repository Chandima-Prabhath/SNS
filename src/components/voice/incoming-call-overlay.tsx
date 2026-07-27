'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useCall } from '@/hooks/useCall'
import { unlockAudio } from '@/lib/call-manager'
import { CallSounds } from '@/lib/call-sounds'
import { useAppStore } from '@/stores/useAppStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Phone, PhoneOff, Loader2, Video } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

interface IncomingCall {
  callId: string
  from: { userId: string; username: string; displayName: string }
  channelId?: string
  dmGroupId?: string
  video?: boolean
}

/**
 * Full-screen incoming call overlay.
 * Plays an incoming ring tone (Web Audio API synthesis — no audio files).
 */
export function IncomingCallOverlay() {
  const { data: session } = useSession()
  const { startCall, endCall } = useCall()
  const setView = useAppStore((s) => s.setView)

  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    const onIncoming = (e: Event) => {
      const detail = (e as CustomEvent).detail as IncomingCall
      setIncoming(detail)
      // Play incoming ring tone
      CallSounds.unlock()
      CallSounds.startIncoming()
    }
    const onCancelled = (e: Event) => {
      const detail = (e as CustomEvent).detail as { callId: string }
      // Always stop the ring sound and close the overlay on cancel
      CallSounds.stop()
      if (incoming?.callId === detail.callId || !detail.callId) {
        setIncoming(null)
      } else {
        // Even if callId doesn't match, close anyway — likely a race
        setIncoming(null)
      }
    }
    // Also handle call:reject and call:ended (in case the caller hangs up)
    const onRejected = () => {
      CallSounds.stop()
      setIncoming(null)
    }
    const onEnded = () => {
      CallSounds.stop()
      setIncoming(null)
    }
    window.addEventListener('sns:incoming-call', onIncoming as EventListener)
    window.addEventListener('sns:call-cancelled', onCancelled as EventListener)
    window.addEventListener('sns:call-rejected', onRejected as EventListener)
    window.addEventListener('sns:call-ended', onEnded as EventListener)
    return () => {
      window.removeEventListener('sns:incoming-call', onIncoming as EventListener)
      window.removeEventListener('sns:call-cancelled', onCancelled as EventListener)
      window.removeEventListener('sns:call-rejected', onRejected as EventListener)
      window.removeEventListener('sns:call-ended', onEnded as EventListener)
    }
  }, [incoming?.callId])

  const handleAccept = async () => {
    if (!incoming || !session?.user) return
    setAccepting(true)
    CallSounds.stop()
    try {
      await startCall({
        callId: incoming.callId,
        channelId: incoming.channelId,
        dmGroupId: incoming.dmGroupId,
        enableVideo: incoming.video ?? false,
      })
      unlockAudio()
      const { getSocket } = await import('@/lib/socket')
      const socket = await getSocket()
      socket.emit('call:accept', { callId: incoming.callId, byUserId: incoming.from.userId })
      setView('voice')
      setIncoming(null)
    } catch (e: any) {
      toast.error('Could not join call')
      await endCall()
    } finally {
      setAccepting(false)
    }
  }

  const handleReject = async () => {
    if (!incoming) return
    CallSounds.stop()
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
          className="fixed inset-0 z-[100] bg-gradient-to-b from-zinc-900 via-zinc-950 to-black flex flex-col items-center justify-between p-6 pt-safe pb-safe"
        >
          <div className="w-full text-center pt-12">
            <motion.p
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="text-white/60 text-sm font-medium flex items-center justify-center gap-1.5"
            >
              {incoming.video && <Video className="w-4 h-4" />}
              Incoming {incoming.video ? 'video' : 'voice'} call
            </motion.p>
          </div>

          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="relative">
              <motion.div
                className="absolute inset-0 rounded-full bg-white/10"
                animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-white/5"
                animate={{ scale: [1, 1.3, 1.3], opacity: [0.5, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
              />
              <Avatar className="w-36 h-36 relative border-4 border-white/10">
                <AvatarFallback className="text-5xl bg-white/10 text-white">
                  {incoming.from.displayName?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            </div>

            <div className="text-center">
              <h1 className="text-2xl font-semibold text-white">{incoming.from.displayName}</h1>
              <p className="text-white/60 text-sm mt-1">@{incoming.from.username}</p>
            </div>
          </motion.div>

          <div className="w-full max-w-sm mx-auto pb-8">
            <div className="flex items-center justify-center gap-16">
              <button
                onClick={handleReject}
                disabled={accepting}
                className="flex flex-col items-center gap-2"
              >
                <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors active:scale-95">
                  <PhoneOff className="w-7 h-7 text-white" />
                </div>
                <span className="text-sm text-white/60">Decline</span>
              </button>

              <button
                onClick={handleAccept}
                disabled={accepting}
                className="flex flex-col items-center gap-2"
              >
                <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors active:scale-95">
                  {accepting ? (
                    <Loader2 className="w-7 h-7 text-white animate-spin" />
                  ) : (
                    <Phone className="w-7 h-7 text-white" />
                  )}
                </div>
                <span className="text-sm text-white/60">Accept</span>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
