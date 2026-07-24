'use client'

import { useState, useEffect, useRef } from 'react'
import { useVoiceCall } from '@/hooks/useVoiceCall'
import { useAppStore } from '@/stores/useAppStore'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, PhoneOff, Volume2, Users, Wifi, Cloud, Shield } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ActiveCallScreenProps {
  callName: string
  callAvatarUrl?: string
  isGroup: boolean
  onLeave: () => void
}

/**
 * WhatsApp-style full-screen active call UI.
 * Shows: large avatar, call name, call timer, connection type, participant count,
 * and bottom-docked controls (mute, speaker, end call).
 *
 * For group calls, shows participant tiles in a grid below the avatar.
 */
export function ActiveCallScreen({ callName, callAvatarUrl, isGroup, onLeave }: ActiveCallScreenProps) {
  const { status, localMuted, participants, toggleMute, leaveCall } = useVoiceCall()
  const [callDuration, setCallDuration] = useState(0)
  const [connectionTypes, setConnectionTypes] = useState<Record<string, 'p2p' | 'turn' | 'unknown'>>({})
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({})
  const startTimeRef = useRef<number>(Date.now())

  // Timer
  useEffect(() => {
    if (status === 'connected') {
      startTimeRef.current = Date.now()
      const interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [status])

  // Listen for connection type and audio level events
  useEffect(() => {
    const onConnType = (e: Event) => {
      const { peerId, type } = (e as CustomEvent).detail
      setConnectionTypes((prev) => ({ ...prev, [peerId]: type }))
    }
    const onAudioLevel = (e: Event) => {
      const { peerId, level } = (e as CustomEvent).detail
      setAudioLevels((prev) => ({ ...prev, [peerId]: level }))
    }
    window.addEventListener('sns:connection-type', onConnType as EventListener)
    window.addEventListener('sns:audio-level', onAudioLevel as EventListener)
    return () => {
      window.removeEventListener('sns:connection-type', onConnType as EventListener)
      window.removeEventListener('sns:audio-level', onAudioLevel as EventListener)
    }
  }, [])

  const handleLeave = async () => {
    await leaveCall()
    onLeave()
  }

  const connTypeValues = Object.values(connectionTypes)
  const overallType: 'p2p' | 'turn' | 'mixed' | 'unknown' =
    connTypeValues.length === 0
      ? 'unknown'
      : connTypeValues.every((t) => t === 'p2p')
        ? 'p2p'
        : connTypeValues.every((t) => t === 'turn')
          ? 'turn'
          : 'mixed'

  const participantList = Array.from(participants.entries())
  const totalParticipants = participantList.length + 1

  // Find the active speaker (highest audio level, above threshold)
  const activeSpeaker = participantList.find(([peerId]) => (audioLevels[peerId] || 0) > 0.1)?.[1]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black flex flex-col items-center justify-between p-6 pt-safe pb-safe"
    >
      {/* Top: connection info */}
      <div className="w-full flex items-center justify-between text-white/60 text-sm pt-4">
        <div className="flex items-center gap-2">
          <ConnectionTypeBadge type={overallType} />
          {isGroup && (
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {totalParticipants}
            </span>
          )}
        </div>
        {status === 'connecting' && (
          <motion.span
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-xs"
          >
            Connecting...
          </motion.span>
        )}
        {status === 'disconnected' && (
          <span className="text-xs text-yellow-400">Reconnecting...</span>
        )}
      </div>

      {/* Center: avatar + name + timer */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          {/* Pulsing rings when connecting or when someone speaks */}
          {(status === 'connecting' || activeSpeaker) && (
            <>
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
            </>
          )}
          <Avatar className="w-36 h-36 relative border-4 border-white/10">
            <AvatarImage src={callAvatarUrl} />
            <AvatarFallback className="text-5xl bg-white/10 text-white">
              {callName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-semibold text-white">{callName}</h1>
          <p className="text-white/60 text-sm mt-1">
            {status === 'connected' ? formatDuration(callDuration) : status}
          </p>
        </div>

        {/* For group calls, show participant avatars in a row */}
        {isGroup && participantList.length > 0 && (
          <div className="flex gap-2 mt-2">
            {participantList.slice(0, 6).map(([peerId, p]) => {
              const level = audioLevels[peerId] || 0
              const isActive = level > 0.1
              return (
                <div
                  key={peerId}
                  className={cn(
                    'relative rounded-full transition-all',
                    isActive && 'ring-2 ring-green-400 ring-offset-2 ring-offset-zinc-950'
                  )}
                  style={{
                    transform: isActive ? `scale(${1 + level * 0.2})` : 'scale(1)',
                  }}
                >
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="text-sm bg-white/10 text-white">
                      {p.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bottom: controls */}
      <div className="w-full max-w-sm mx-auto pb-6">
        <div className="flex items-center justify-center gap-6">
          <CallButton
            active={localMuted}
            onClick={toggleMute}
            icon={localMuted ? MicOff : Mic}
            label={localMuted ? 'Unmute' : 'Mute'}
            variant={localMuted ? 'danger' : 'neutral'}
          />
          <CallButton
            onClick={handleLeave}
            icon={PhoneOff}
            label="End"
            variant="end"
            large
          />
          <CallButton
            active={false}
            onClick={() => {/* speaker toggle — browser handles this via audio element */}}
            icon={Volume2}
            label="Speaker"
            variant="neutral"
          />
        </div>
      </div>
    </motion.div>
  )
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function ConnectionTypeBadge({ type }: { type: 'p2p' | 'turn' | 'mixed' | 'unknown' }) {
  if (type === 'unknown') return null
  const config = {
    p2p: { label: 'P2P', icon: Wifi, color: 'text-green-400' },
    turn: { label: 'TURN', icon: Cloud, color: 'text-blue-400' },
    mixed: { label: 'Mixed', icon: Shield, color: 'text-yellow-400' },
  }[type]
  const Icon = config.icon
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', config.color)}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  )
}

function CallButton({
  active,
  onClick,
  icon: Icon,
  label,
  variant,
  large,
}: {
  active?: boolean
  onClick: () => void
  icon: typeof Mic
  label: string
  variant: 'neutral' | 'danger' | 'end'
  large?: boolean
}) {
  const size = large ? 'w-16 h-16' : 'w-14 h-14'
  const iconSize = large ? 'w-7 h-7' : 'w-6 h-6'

  const styles = {
    neutral: active
      ? 'bg-white text-zinc-900'
      : 'bg-white/10 text-white hover:bg-white/20',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    end: 'bg-red-500 text-white hover:bg-red-600',
  }[variant]

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        className={cn(
          'rounded-full flex items-center justify-center transition-all active:scale-95',
          size,
          styles
        )}
      >
        <Icon className={iconSize} />
      </button>
      <span className="text-xs text-white/60">{label}</span>
    </div>
  )
}
