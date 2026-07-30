'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface UserResult {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What are we inviting to? Shown in the dialog title/description */
  inviteType: 'call' | 'music'
  /** Extra context for display */
  inviteContext?: string
  /** Called when the user selects someone and clicks Send */
  onSendInvite: (targetUserId: string) => Promise<void>
}

/**
 * InviteDialog — a premium modal for searching users and sending invitations.
 *
 * Replaces browser `prompt()` calls. Shows a search input + user list with
 * avatars. When a user is selected, calls `onSendInvite(userId)`.
 *
 * Usage:
 *   <InviteDialog
 *     open={inviteOpen}
 *     onOpenChange={setInviteOpen}
 *     inviteType="call"
 *     inviteContext="voice call"
 *     onSendInvite={async (userId) => { await fetch('/api/invites', ...) }}
 *   />
 */
export function InviteDialog({
  open,
  onOpenChange,
  inviteType,
  inviteContext,
  onSendInvite,
}: InviteDialogProps) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null)
  const [sending, setSending] = useState(false)
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Fetch users (debounced)
  const fetchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(query.trim())}`)
      if (!res.ok) return
      const data = await res.json()
      setResults(data.users || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce search input
  useEffect(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!search.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(() => fetchUsers(search), 300)
    setDebounceTimer(timer)
    return () => clearTimeout(timer)
  }, [search, fetchUsers])

  // Reset on close
  const handleClose = (open: boolean) => {
    if (!open) {
      setSearch('')
      setResults([])
      setSelectedUser(null)
    }
    onOpenChange(open)
  }

  const handleSend = async () => {
    if (!selectedUser) return
    setSending(true)
    try {
      await onSendInvite(selectedUser.id)
      toast.success(`Invitation sent to ${selectedUser.displayName}`)
      handleClose(false)
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  const isCall = inviteType === 'call'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCall ? '📞' : '🎵'} Invite to {isCall ? 'Call' : 'Music Room'}
          </DialogTitle>
          <DialogDescription>
            {inviteContext
              ? `Search for a user to invite to ${inviteContext}.`
              : `Search for a user to invite.`}
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username..."
            className="pl-9"
            autoFocus
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setResults([]) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 && search.trim() ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No users found for "{search}"
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Start typing to search for users
            </div>
          ) : (
            results.map((user) => (
              <button
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className={cn(
                  'w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left',
                  selectedUser?.id === user.id
                    ? 'bg-primary/15 ring-1 ring-primary/30'
                    : 'hover:bg-accent/50'
                )}
              >
                <Avatar className="w-9 h-9 shrink-0">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                  <AvatarFallback className="text-xs">
                    {user.displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{user.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
                </div>
                {selectedUser?.id === user.id && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!selectedUser || sending}>
            {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
