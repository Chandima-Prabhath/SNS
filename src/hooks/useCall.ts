'use client'

import { useCallback } from 'react'
import { getCallManager, unlockAudio as unlockAudioFn } from '@/lib/call-manager'
import { useCallStore } from '@/stores/useCallStore'

/**
 * Thin hook over the call store + singleton manager.
 *
 * Components read state from the store and call actions on the manager.
 * There's only ONE manager instance for the whole app (singleton).
 */
export function useCall() {
  const store = useCallStore()

  const startCall = useCallback(async (params: {
    callId: string
    channelId?: string | null
    dmGroupId?: string | null
    enableVideo?: boolean
  }) => {
    const manager = getCallManager()
    useCallStore.getState().setVideoCall(params.enableVideo ?? false)
    useCallStore.getState().setCallId(params.callId)
    await manager.startCall(params)
  }, [])

  const toggleMute = useCallback(() => {
    getCallManager().toggleMute()
  }, [])

  const toggleVideo = useCallback(() => {
    getCallManager().toggleVideo()
  }, [])

  const switchCamera = useCallback(async () => {
    return getCallManager().switchCamera()
  }, [])

  const endCall = useCallback(async () => {
    await getCallManager().endCall()
  }, [])

  const unlockAudio = useCallback(() => {
    unlockAudioFn()
  }, [])

  return {
    status: store.status,
    callId: store.callId,
    localStream: store.localStream,
    localMuted: store.localMuted,
    videoEnabled: store.videoEnabled,
    isVideoCall: store.isVideoCall,
    participants: store.participants,
    startCall,
    toggleMute,
    toggleVideo,
    switchCamera,
    endCall,
    unlockAudio,
  }
}
