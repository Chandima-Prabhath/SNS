'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useBots() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['bots'],
    queryFn: async () => {
      const res = await fetch('/api/bots')
      if (!res.ok) throw new Error('failed to load bots')
      const data = await res.json()
      return data as { bots: any[]; modules: any[] }
    },
  })

  const create = useMutation({
    mutationFn: async (params: { name: string; username: string; description?: string; module?: string; avatarUrl?: string }) => {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  const update = useMutation({
    mutationFn: async (params: { id: string; data: any }) => {
      const res = await fetch(`/api/bots/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/bots/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  return {
    bots: query.data?.bots || [],
    modules: query.data?.modules || [],
    isLoading: query.isLoading,
    create: create.mutateAsync,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
  }
}
