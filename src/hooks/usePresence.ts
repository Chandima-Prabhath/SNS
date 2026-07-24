'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSocket } from './useSocket'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface PresenceUser {
  userId: string
  username: string
  status: string
}

/**
 * Subscribes to presence updates from the realtime service.
 * Returns a map of userId → status.
 */
export function usePresence() {
  const { socket, connected } = useSocket()
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({})

  useEffect(() => {
    if (!socket || !connected) return

    const onUpdate = (list: PresenceUser[]) => {
      const next: Record<string, PresenceUser> = {}
      for (const p of list) next[p.userId] = p
      setPresence(next)
    }

    socket.on('presence:update', onUpdate)
    socket.emit('presence:request')

    return () => {
      socket.off('presence:update', onUpdate)
    }
  }, [socket, connected])

  // Tell the server our status when we go idle (visibilitychange)
  useEffect(() => {
    const handler = () => {
      if (!socket || !connected) return
      if (document.hidden) {
        socket.emit('presence:set', 'idle')
      } else {
        socket.emit('presence:set', 'online')
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [socket, connected])

  return presence
}
