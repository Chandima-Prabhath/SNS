'use client'

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSocket } from './useSocket'

export interface StoryGroup {
  userId: string
  user: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  stories: Array<{
    id: string
    mediaUrl: string
    mediaType: string
    caption: string | null
    createdAt: string
    expiresAt: string
    viewedByMe: boolean
    viewerCount: number
    viewers?: Array<{ userId: string; user: any; viewedAt: string }> // only for own stories
  }>
}

export function useStories() {
  const { socket, connected } = useSocket()
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['stories'],
    queryFn: async () => {
      const res = await fetch('/api/stories')
      if (!res.ok) throw new Error('failed to load stories')
      const data = await res.json()
      return data.stories as StoryGroup[]
    },
    refetchInterval: 60_000, // refresh every minute (stories expire)
  })

  // Real-time updates
  useEffect(() => {
    if (!socket || !connected) return
    const onPosted = () => qc.invalidateQueries({ queryKey: ['stories'] })
    const onViewed = () => qc.invalidateQueries({ queryKey: ['stories'] })
    socket.on('story:posted', onPosted)
    socket.on('story:viewed', onViewed)
    return () => {
      socket.off('story:posted', onPosted)
      socket.off('story:viewed', onViewed)
    }
  }, [socket, connected, qc])

  const upload = useMutation({
    mutationFn: async (params: { mediaUrl: string; mediaType?: string; caption?: string; audience?: string; audienceUserIds?: string[] }) => {
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('failed to upload story')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stories'] })
      if (socket) socket.emit('story:posted', {})
    },
  })

  const markViewed = useMutation({
    mutationFn: async (storyId: string) => {
      await fetch(`/api/stories/${storyId}`, { method: 'POST' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stories'] })
      if (socket) socket.emit('story:viewed', {})
    },
  })

  const remove = useMutation({
    mutationFn: async (storyId: string) => {
      await fetch(`/api/stories/${storyId}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stories'] })
    },
  })

  return {
    stories: query.data || [],
    isLoading: query.isLoading,
    upload: upload.mutateAsync,
    markViewed: markViewed.mutateAsync,
    remove: remove.mutateAsync,
  }
}
