'use client'

import { useState, useEffect, useRef } from 'react'
import { useCall } from '@/hooks/useCall'
import { useAppStore } from '@/stores/useAppStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, Users, Wifi, Cloud, Shield, Video, VideoOff, SwitchCamera, Monitor, MonitorOff, UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ActiveCallScreenProps {
  callName: string
  callAvatarUrl?: string
  isGroup: boolean
  isVideoCall: boolean
  callId?: string
  channelId?: string
  onLeave: () => void
}

export function ActiveCallScreen({ callName, callAvatarUrl, isGroup, isVideoCall, callId, channelId, onLeave }: ActiveCallScreenProps) {
  const { status, localMuted, videoEnabled, localStream, participants, toggleMute, toggleVideo, switchCamera, startScreenShare, stopScreenShare, isScreenSharing, endCall } = useCall()
  const [callDuration, setCallDuration] = useState(0)
  const [connectionTypes, setConnectionTypes] = useState<Record<string, 'p2p' | 'turn' | 'unknown'>>({})
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({})
  const [speakerOn, setSpeakerOn] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const startTimeRef = useRef<number>(Date.now())
  const localVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (status === 'connected') {
      startTimeRef.current = Date.now()
      const interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [status])

  useEffect(() => {
    if (localVideoRef.current && localStream && isVideoCall) {
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.muted = true
      localVideoRef.current.play().catch(() => {})
    }
  }, [localStream, isVideoCall])

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
    if (leaving) return
    setLeaving(true)
    try { await endCall() } catch (e) { console.error('[call] error leaving:', e) }
    finally { setLeaving(false); onLeave() }
  }

  // Invite a user to the current call — opens a prompt for their username
  const handleInvite = async () => {
    const username = prompt('Enter the username of the person to invite:')
    if (!username?.trim()) return
    try {
      // Find the user by username
      const searchRes = await fetch(`/api/users?search=${encodeURIComponent(username.trim())}`)
      if (!searchRes.ok) throw new Error('Failed to search users')
      const searchData = await searchRes.json()
      const targetUser = searchData.users?.find((u: any) => u.username === username.trim())
      if (!targetUser) {
        toast.error(`User "${username}" not found`)
        return
      }
      // Send the invite
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetUser.id,
          type: 'call',
          targetId: callId,
          channelId,
          isVideo: isVideoCall,
        }),
      })
      if (!res.ok) throw new Error('Failed to send invite')
      toast.success(`Invitation sent to ${targetUser.displayName}`)
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite')
    }
  }

  const handleSpeaker = async () => {
    const newSpeakerOn = !speakerOn
    setSpeakerOn(newSpeakerOn)
    document.querySelectorAll('audio').forEach(el => { (el as HTMLAudioElement).volume = newSpeakerOn ? 1.0 : 0.0 })
  }

  const handleSwitchCamera = async () => {
    if (!await switchCamera()) toast.error('Could not switch camera')
  }

  const handleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare()
    } else {
      if (!await startScreenShare()) toast.error('Could not start screen share')
    }
  }

  const connTypeValues = Object.values(connectionTypes)
  const overallType: 'p2p' | 'turn' | 'mixed' | 'unknown' =
    connTypeValues.length === 0 ? 'unknown'
    : connTypeValues.every((t) => t === 'p2p') ? 'p2p'
    : connTypeValues.every((t) => t === 'turn') ? 'turn'
    : 'mixed'

  const participantList = participants
  const totalParticipants = participantList.length + 1
  const activeSpeaker = participantList.find((p) => (audioLevels[p.peerId] || 0) > 0.1)

  // ─── Video call layout ───
  if (isVideoCall) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black flex flex-col"
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between text-white/80 text-sm p-4 pt-safe bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-2">
            <ConnectionTypeBadge type={overallType} />
            {isGroup && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{totalParticipants}</span>}
          </div>
          <span className="text-white/60 text-xs font-mono">
            {status === 'connected' ? formatDuration(callDuration) : status}
          </span>
        </div>

        {/* Remote video — fills the screen, object-contain prevents cropping */}
        <div className="flex-1 min-h-0 relative bg-black flex items-center justify-center">
          {participantList.length > 0 ? (
            <RemoteVideoGrid participants={participantList} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Avatar className="w-32 h-32 mx-auto mb-4 border-4 border-white/10">
                  <AvatarFallback className="text-4xl bg-white/10 text-white">
                    {callName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="text-white/80 text-sm">Connecting video...</p>
              </div>
            </div>
          )}
        </div>

        {/* Local video PiP — top right, selfie-cropped */}
        {videoEnabled && (
          <div className="absolute top-16 right-4 w-28 h-40 md:w-36 md:h-52 rounded-2xl overflow-hidden border-2 border-white/20 bg-zinc-900 shadow-2xl z-10">
            <video
              ref={localVideoRef}
              autoPlay playsInline muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          </div>
        )}

        {/* Bottom controls — Discord-style pill */}
        <div className="absolute bottom-0 left-0 right-0 z-10 p-6 pb-safe bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-center gap-3 max-w-md mx-auto bg-[#2b2d31]/80 backdrop-blur-xl rounded-2xl p-2.5">
            <VideoCallButton active={localMuted} onClick={toggleMute} icon={localMuted ? MicOff : Mic} label="Mute" variant={localMuted ? 'danger' : 'neutral'} />
            <VideoCallButton active={!videoEnabled} onClick={toggleVideo} icon={videoEnabled ? Video : VideoOff} label="Video" variant={!videoEnabled ? 'danger' : 'neutral'} />
            {/* Invite button — sends a call invitation to a user's DM */}
            <VideoCallButton onClick={handleInvite} icon={UserPlus} label="Invite" variant="neutral" />
            {/* Screen share — desktop only (getDisplayMedia not available on mobile) */}
            {typeof navigator !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && (
              <VideoCallButton active={isScreenSharing} onClick={handleScreenShare} icon={isScreenSharing ? MonitorOff : Monitor} label="Share" variant={isScreenSharing ? 'danger' : 'neutral'} />
            )}
            <VideoCallButton onClick={handleSwitchCamera} icon={SwitchCamera} label="Flip" variant="neutral" />
            <VideoCallButton active={speakerOn} onClick={handleSpeaker} icon={speakerOn ? Volume2 : VolumeX} label="Speaker" variant="neutral" />
            <VideoCallButton onClick={handleLeave} icon={PhoneOff} label={leaving ? '...' : 'End'} variant="end" large disabled={leaving} />
          </div>
        </div>
      </motion.div>
    )
  }

  // ─── Voice call layout — premium phone-call style ───
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden"
    >
      {/* Animated gradient backdrop — deep navy with primary glow */}
      <div className="absolute inset-0 bg-[oklch(0.13_0.008_264)]" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60% 40% at 50% 25%, oklch(0.62 0.20 264 / 0.18), transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(50% 30% at 80% 80%, oklch(0.55 0.14 200 / 0.12), transparent 70%)',
        }}
      />

      {/* Top bar — connection info + status */}
      <div className="relative w-full flex items-center justify-between px-6 pt-8 pt-safe">
        <div className="flex items-center gap-2 text-white/50 text-xs">
          <ConnectionTypeBadge type={overallType} />
          {isGroup && (
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {totalParticipants}
            </span>
          )}
        </div>
        {status === 'connecting' && (
          <div className="flex items-center gap-2 text-white/60 text-xs font-medium">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Calling…
          </div>
        )}
        {status === 'disconnected' && (
          <span className="text-xs text-yellow-400 font-medium">Reconnecting…</span>
        )}
        {status === 'connected' && (
          <span className="text-xs text-white/40 font-medium uppercase tracking-wider">
            Voice Call
          </span>
        )}
      </div>

      {/* Center: avatar + name + timer + waveform */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-8">
        {/* Avatar with animated rings */}
        <div className="relative">
          {/* Outer glow ring — always present when connected */}
          {status === 'connected' && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: '0 0 80px oklch(0.62 0.20 264 / 0.35)' }}
              animate={{ scale: [1, 1.04, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          {/* Expanding rings while connecting */}
          {status === 'connecting' && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-primary/40"
                animate={{ scale: [1, 1.6], opacity: [0.7, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-primary/30"
                animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-primary/20"
                animate={{ scale: [1, 1.6], opacity: [0.3, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 1.2 }}
              />
            </>
          )}
          <Avatar className="w-40 h-40 relative ring-4 ring-white/5">
            <AvatarImage src={callAvatarUrl} />
            <AvatarFallback className="text-6xl bg-gradient-to-br from-primary/40 via-primary/20 to-transparent text-white border border-white/10 font-light">
              {callName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {/* Active speaker pulse */}
          {status === 'connected' && activeSpeaker && (
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green-500 border-2 border-[oklch(0.13_0.008_264)] flex items-center justify-center pulse-glow">
              <div className="w-2.5 h-2.5 rounded-full bg-white" />
            </div>
          )}
        </div>

        {/* Name + duration */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-semibold text-white tracking-tight">{callName}</h1>
          <p className="text-white/40 text-base font-mono tabular-nums tracking-wider">
            {status === 'connected' ? formatDuration(callDuration) : status === 'connecting' ? '' : ''}
          </p>
        </div>

        {/* Audio waveform — animated bars showing audio activity */}
        {status === 'connected' && (
          <AudioWaveform active={!!activeSpeaker} levels={audioLevels} participants={participantList} />
        )}

        {/* Group participants — small avatar row */}
        {isGroup && participantList.length > 0 && (
          <div className="flex gap-2.5 mt-2">
            {participantList.slice(0, 6).map((p) => {
              const level = audioLevels[p.peerId] || 0
              const isActive = level > 0.1
              return (
                <div
                  key={p.peerId}
                  className={cn(
                    'relative rounded-full transition-all duration-200',
                    isActive && 'ring-2 ring-green-400'
                  )}
                  style={{ transform: isActive ? `scale(${1 + level * 0.15})` : 'scale(1)' }}
                >
                  <Avatar className="w-11 h-11 border-2 border-white/10">
                    <AvatarFallback className="text-sm bg-white/8 text-white/80">
                      {p.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </div>
              )
            })}
            {participantList.length > 6 && (
              <div className="w-11 h-11 rounded-full bg-white/8 border-2 border-white/10 flex items-center justify-center text-white/60 text-xs font-medium">
                +{participantList.length - 6}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom controls — refined glass pill */}
      <div className="relative px-6 pb-10 pb-safe">
        <div className="max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-4 glass-dark rounded-[28px] p-3.5 shadow-2xl">
            <CallButton
              active={localMuted}
              onClick={toggleMute}
              icon={localMuted ? MicOff : Mic}
              label=""
              variant={localMuted ? 'danger' : 'neutral'}
            />
            {/* Invite button — sends a call invitation to a user's DM */}
            <CallButton
              onClick={handleInvite}
              icon={UserPlus}
              label=""
              variant="neutral"
            />
            <CallButton
              onClick={handleLeave}
              icon={PhoneOff}
              label=""
              variant="end"
              large
              disabled={leaving}
            />
            <CallButton
              active={speakerOn}
              onClick={handleSpeaker}
              icon={speakerOn ? Volume2 : VolumeX}
              label=""
              variant="neutral"
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * Remote video grid — fills the screen with remote participant videos.
 * Uses object-contain to prevent cropping on desktop.
 * Videos are centered with max dimensions to fit any aspect ratio.
 */
function RemoteVideoGrid({ participants }: { participants: any[] }) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  useEffect(() => {
    for (const p of participants) {
      const el = videoRefs.current.get(p.peerId)
      if (el && p.stream && el.srcObject !== p.stream) {
        el.srcObject = p.stream
        el.play().catch(() => {})
      }
    }
  }, [participants])

  if (participants.length === 1) {
    const p = participants[0]
    return (
      <video
        key={p.peerId}
        ref={(el) => { if (el) videoRefs.current.set(p.peerId, el) }}
        autoPlay
        playsInline
        className="max-w-full max-h-full w-full h-full object-contain"
      />
    )
  }

  return (
    <div className={cn('w-full h-full grid', participants.length === 2 ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2')}>
      {participants.slice(0, 4).map((p) => (
        <div key={p.peerId} className="relative bg-zinc-900 flex items-center justify-center overflow-hidden">
          <video
            ref={(el) => { if (el) videoRefs.current.set(p.peerId, el) }}
            autoPlay
            playsInline
            className="max-w-full max-h-full w-full h-full object-contain"
          />
          <div className="absolute bottom-2 left-2 text-white text-xs font-medium bg-black/60 px-2 py-1 rounded-md backdrop-blur-sm">
            {p.username}
          </div>
        </div>
      ))}
    </div>
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

function CallButton({ active, onClick, icon: Icon, label, variant, large, disabled }: any) {
  const size = large ? 'w-16 h-16' : 'w-14 h-14'
  const iconSize = large ? 'w-7 h-7' : 'w-6 h-6'
  const styles = {
    neutral: active ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/15',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    end: 'bg-red-500 text-white hover:bg-red-600',
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled} className={cn('rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-50', size, styles)}>
      <Icon className={iconSize} />
    </button>
  )
}

function VideoCallButton({ active, onClick, icon: Icon, label, variant, large, disabled }: any) {
  const size = large ? 'w-14 h-14' : 'w-12 h-12'
  const iconSize = large ? 'w-6 h-6' : 'w-5 h-5'
  const styles = {
    neutral: active ? 'bg-white text-zinc-900' : 'bg-white/10 text-white hover:bg-white/20',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    end: 'bg-red-500 text-white hover:bg-red-600',
  }[variant]
  return (
    <div className="flex flex-col items-center gap-1">
      <button onClick={onClick} disabled={disabled} className={cn('rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-50', size, styles)}>
        <Icon className={iconSize} />
      </button>
      <span className="text-[10px] text-white/60">{label}</span>
    </div>
  )
}

/**
 * Audio waveform — a row of vertical bars that animate based on the active
 * speaker's audio level. Purely decorative; gives the voice call screen a
 * premium, "live audio" feel.
 */
function AudioWaveform({
  active,
  levels,
  participants,
}: {
  active: boolean
  levels: Record<string, number>
  participants: any[]
}) {
  // Find the dominant audio level across all participants
  const maxLevel = participants.reduce((max, p) => {
    const l = levels[p.peerId] || 0
    return Math.max(max, l)
  }, 0)

  const bars = 28
  return (
    <div className="flex items-center justify-center gap-1 h-8 max-w-xs">
      {Array.from({ length: bars }).map((_, i) => {
        // Each bar gets a phase offset so they dance independently
        const phase = (i / bars) * Math.PI * 2
        const wave = active ? (0.3 + Math.sin(phase + Date.now() / 200) * 0.4 + maxLevel * 0.6) : 0.15
        const height = Math.max(4, Math.min(32, wave * 32))
        return (
          <motion.div
            key={i}
            className="w-1 rounded-full bg-gradient-to-t from-primary/40 to-primary"
            animate={{ height }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ height: `${height}px` }}
          />
        )
      })}
    </div>
  )
}
