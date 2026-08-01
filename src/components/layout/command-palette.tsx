'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, User, Hash, Bot, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

interface SearchResult {
  users: { id: string; username: string; displayName: string; avatarUrl: string | null; status: string }[]
  channels: { groupId: string; groupName: string; iconUrl: string | null; isDm: boolean; channelId: string; channelName: string }[]
  bots: { id: string; name: string; username: string; module: string; enabled: boolean }[]
}

/**
 * CommandPalette — Cmd+K / Ctrl+K global search.
 *
 * Searches across users, channels, and bots. Selecting a result navigates
 * to the corresponding view (DM, channel, or bot builder).
 *
 * Mounted once at the app root (in AppShell).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const setView = useAppStore((s) => s.setView)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)

  // Listen for Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Debounced search
  const { data } = useQuery<SearchResult>({
    queryKey: ['global-search', query],
    queryFn: async () => {
      if (!query || query.length < 2) return { users: [], channels: [], bots: [] }
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) return { users: [], channels: [], bots: [] }
      return res.json()
    },
    staleTime: 10_000,
  })

  const results = data || { users: [], channels: [], bots: [] }

  // Flatten all results into a single list for keyboard navigation
  const flatResults = [
    ...results.users.map((u) => ({ type: 'user' as const, data: u })),
    ...results.channels.map((c) => ({ type: 'channel' as const, data: c })),
    ...results.bots.map((b) => ({ type: 'bot' as const, data: b })),
  ]

  const handleSelect = useCallback((item: typeof flatResults[0]) => {
    if (!item) return
    if (item.type === 'user') {
      // Navigate to DM — need to create or find DM channel
      // For now, just switch to chats view and let user click
      setView('chats')
      setOpen(false)
    } else if (item.type === 'channel') {
      setSelectedGroupId(item.data.groupId)
      setActiveChannel(item.data.channelId)
      setView('chats')
      setOpen(false)
    } else if (item.type === 'bot') {
      router.push(`/bot-builder/${item.data.id}`)
      setOpen(false)
    }
  }, [router, setView, setActiveChannel, setSelectedGroupId])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(flatResults[selectedIndex])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-lg gap-0 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search users, chats, bots..."
            className="border-0 focus-visible:ring-0 px-0 h-auto"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {flatResults.length === 0 && query.length >= 2 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          )}
          {flatResults.length === 0 && query.length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Start typing to search...
            </div>
          )}

          {flatResults.map((item, i) => (
            <button
              key={`${item.type}-${(item.data as any).id || (item.data as any).channelId}`}
              onClick={() => handleSelect(item)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                i === selectedIndex ? 'bg-primary/15' : 'hover:bg-accent/50'
              )}
            >
              {item.type === 'user' && (
                <>
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarImage src={item.data.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs">{item.data.displayName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.data.displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">@{item.data.username}</div>
                  </div>
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </>
              )}
              {item.type === 'channel' && (
                <>
                  <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Hash className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.data.groupName}</div>
                    <div className="text-xs text-muted-foreground truncate">#{item.data.channelName}</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </>
              )}
              {item.type === 'bot' && (
                <>
                  <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.data.name}</div>
                    <div className="text-xs text-muted-foreground truncate">@{item.data.username}</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 rounded">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 rounded">↵</kbd> select
            </span>
          </div>
          <span>Press <kbd className="bg-muted px-1 rounded">⌘K</kbd> anytime</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
