'use client'

import { useState, useEffect, useRef } from 'react'
import { useCall } from '@/hooks/useCall'
import { useAppStore } from '@/stores/useAppStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, Users, Wifi, Cloud, Shield, Video, VideoOff, SwitchCamera } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ActiveCallScreenProps {
  callName: string
  callAvatarUrl?: string
  isGroup: boolean
  isVideoCall: boolean
  onLeave: () => void
}

export function ActiveCallScreen({ callName, callAvatarUrl, isGroup, isVideoCall, onLeave }: ActiveCallScreenProps) {
  const { status, localMuted, videoEnabled, localStream, participants, toggleMute, toggleVideo, switchCamera, endCall } = useCall()
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

  const handleSpeaker = async () => {
    const newSpeakerOn = !speakerOn
    setSpeakerOn(newSpeakerOn)
    document.querySelectorAll('audio').forEach(el => { (el as HTMLAudioElement).volume = newSpeakerOn ? 1.0 : 0.0 })
  }

  const handleSwitchCamera = async () => {
    if (!await switchCamera()) toast.error('Could not switch camera')
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
        className="fixed inset-0 z-50 bg-black flex flex-col"
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
            <VideoCallButton onClick={handleSwitchCamera} icon={SwitchCamera} label="Flip" variant="neutral" />
            <VideoCallButton active={speakerOn} onClick={handleSpeaker} icon={speakerOn ? Volume2 : VolumeX} label="Speaker" variant="neutral" />
            <VideoCallButton onClick={handleLeave} icon={PhoneOff} label={leaving ? '...' : 'End'} variant="end" large disabled={leaving} />
          </div>
        </div>
      </motion.div>
    )
  }

  // ─── Voice call layout ───
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#1e1f22] flex flex-col items-center justify-between p-6 pt-safe pb-safe"
    >
      {/* Top bar */}
      <div className="w-full flex items-center justify-between text-white/50 text-sm pt-4">
        <div className="flex items-center gap-2">
          <ConnectionTypeBadge type={overallType} />
          {isGroup && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{totalParticipants}</span>}
        </div>
        {status === 'connecting' && (
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="text-xs text-primary">
            Connecting...
          </motion.span>
        )}
        {status === 'disconnected' && (
          <span className="text-xs text-yellow-400">Reconnecting...</span>
        )}
      </div>

      {/* Center: avatar + name + timer */}
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          {(status === 'connecting' || activeSpeaker) && (
            <>
              <motion.div className="absolute inset-0 rounded-full bg-primary/20" animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }} />
              <motion.div className="absolute inset-0 rounded-full bg-primary/10" animate={{ scale: [1, 1.3, 1.3], opacity: [0.5, 0, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }} />
            </>
          )}
          <Avatar className="w-32 h-32 relative border-4 border-white/5">
            <AvatarImage src={callAvatarUrl} />
            <AvatarFallback className="text-5xl bg-[#2b2d31] text-white/80">
              {callName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-semibold text-white">{callName}</h1>
          <p className="text-white/40 text-sm mt-1 font-mono">
            {status === 'connected' ? formatDuration(callDuration) : status}
          </p>
        </div>

        {isGroup && participantList.length > 0 && (
          <div className="flex gap-2 mt-2">
            {participantList.slice(0, 6).map((p) => {
              const level = audioLevels[p.peerId] || 0
              const isActive = level > 0.1
              return (
                <div
                  key={p.peerId}
                  className={cn('relative rounded-full transition-all', isActive && 'ring-2 ring-green-400 ring-offset-2 ring-offset-zinc-950')}
                  style={{ transform: isActive ? `scale(${1 + level * 0.2})` : 'scale(1)' }}
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

      {/* Controls — Discord-style pill */}
      <div className="w-full max-w-sm mx-auto pb-6">
        <div className="flex items-center justify-center gap-4 bg-[#2b2d31] rounded-2xl p-3">
          <CallButton active={localMuted} onClick={toggleMute} icon={localMuted ? MicOff : Mic} label={localMuted ? 'Unmute' : 'Mute'} variant={localMuted ? 'danger' : 'neutral'} />
          <CallButton onClick={handleLeave} icon={PhoneOff} label={leaving ? 'Ending...' : 'End'} variant="end" large disabled={leaving} />
          <CallButton active={speakerOn} onClick={handleSpeaker} icon={speakerOn ? Volume2 : VolumeX} label="Speaker" variant="neutral" />
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
    neutral: active ? 'bg-white text-zinc-900' : 'bg-white/10 text-white hover:bg-white/20',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    end: 'bg-red-500 text-white hover:bg-red-600',
  }[variant]
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button onClick={onClick} disabled={disabled} className={cn('rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-50', size, styles)}>
        <Icon className={iconSize} />
      </button>
      <span className="text-xs text-white/60">{label}</span>
    </div>
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
