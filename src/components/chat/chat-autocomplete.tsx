'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Bot, Hash } from 'lucide-react'

interface CommandInfo {
  name: string
  description: string
  botName: string
  botUsername: string
}

interface MentionableUser {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  isBot: boolean
}

interface AutocompleteSuggestion {
  type: 'command' | 'mention'
  label: string
  description?: string
  insertText: string
  avatarUrl?: string | null
  isBot?: boolean
}

interface ChatAutocompleteProps {
  channelId: string
  text: string
  cursorPosition: number
  onSuggestionSelect: (insertText: string, replaceFrom: number, replaceTo: number) => void
  onActiveChange: (active: boolean) => void
}

/**
 * ChatAutocomplete — Slack/Discord-style autocomplete for /commands and @mentions.
 *
 * Detects when the user is typing a command (starts with /) or mention (starts
 * with @) and shows a floating suggestion list above the composer. The user
 * can arrow-key through suggestions and press Enter to insert.
 *
 * The suggestions are fetched from /api/channels/[id]/commands which returns:
 *   - commands: extracted from visual bot flows + built-in bot modules
 *   - mentionable: all channel members (users + bots)
 */
export function ChatAutocomplete({
  channelId,
  text,
  cursorPosition,
  onSuggestionSelect,
  onActiveChange,
}: ChatAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['channel-commands', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/channels/${channelId}/commands`)
      if (!res.ok) return { commands: [], mentionable: [] }
      return res.json() as Promise<{ commands: CommandInfo[]; mentionable: MentionableUser[] }>
    },
    staleTime: 30_000, // commands don't change often
  })

  // Detect what the user is typing at the cursor position
  const detection = useMemo(() => {
    const beforeCursor = text.slice(0, cursorPosition)
    // Find the last / or @ that starts a word
    const match = beforeCursor.match(/(?:^|\s)([\/@])(\w*)$/)
    if (!match) return null
    const trigger = match[1] // '/' or '@'
    const query = match[2].toLowerCase()
    const replaceFrom = cursorPosition - match[2].length - 1 // include the / or @
    const replaceTo = cursorPosition
    return { trigger, query, replaceFrom, replaceTo }
  }, [text, cursorPosition])

  // Build filtered suggestions
  const suggestions: AutocompleteSuggestion[] = useMemo(() => {
    if (!detection || !data) return []

    if (detection.trigger === '/') {
      return data.commands
        .filter((cmd) => cmd.name.toLowerCase().includes(detection.query))
        .slice(0, 8)
        .map((cmd) => ({
          type: 'command' as const,
          label: `/${cmd.name}`,
          description: cmd.description,
          insertText: `/${cmd.name} `,
          isBot: true,
        }))
    }

    if (detection.trigger === '@') {
      return data.mentionable
        .filter((u) =>
          u.username.toLowerCase().includes(detection.query) ||
          u.displayName.toLowerCase().includes(detection.query)
        )
        .slice(0, 8)
        .map((u) => ({
          type: 'mention' as const,
          label: u.displayName,
          description: `@${u.username}`,
          insertText: `@${u.username} `,
          avatarUrl: u.avatarUrl,
          isBot: u.isBot,
        }))
    }

    return []
  }, [detection, data])

  const active = suggestions.length > 0

  // Notify parent of active state changes
  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0)
  }, [suggestions])

  // Handle keyboard navigation (called by parent via ref)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!active) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0)) {
        // Only intercept if the user is actively in autocomplete mode
        e.preventDefault()
        e.stopPropagation()
        const s = suggestions[selectedIndex]
        if (s && detection) {
          onSuggestionSelect(s.insertText, detection.replaceFrom, detection.replaceTo)
        }
      } else if (e.key === 'Escape') {
        // Let the parent handle Escape — just reset our selection
        setSelectedIndex(0)
      }
    }

    // Use capture phase so we intercept before the textarea's own handler
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [active, suggestions, selectedIndex, detection, onSuggestionSelect])

  if (!active || !detection) return null

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-2 glass-dark rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto"
    >
      <div className="p-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          {detection.trigger === '/' ? 'Commands' : 'Mention'}
        </div>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              if (detection) {
                onSuggestionSelect(s.insertText, detection.replaceFrom, detection.replaceTo)
              }
            }}
            className={cn(
              'w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors',
              i === selectedIndex ? 'bg-primary/20' : 'hover:bg-white/5'
            )}
          >
            {s.type === 'command' ? (
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                <Hash className="w-4 h-4 text-primary" />
              </div>
            ) : (
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarImage src={s.avatarUrl || undefined} />
                <AvatarFallback className="text-xs">
                  {s.isBot ? <Bot className="w-4 h-4" /> : s.label.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{s.label}</span>
                {s.isBot && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                    Bot
                  </span>
                )}
              </div>
              {s.description && (
                <div className="text-xs text-muted-foreground truncate">{s.description}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
