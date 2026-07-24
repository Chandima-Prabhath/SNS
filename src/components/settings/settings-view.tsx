'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Loader2, Save, LogOut } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'

export function SettingsView() {
  const { data: session } = useSession()
  const qc = useQueryClient()

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      return data.user
    },
  })

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [customStatus, setCustomStatus] = useState('')
  const [lastSeenVisible, setLastSeenVisible] = useState(true)
  const [readReceipts, setReadReceipts] = useState(true)
  const [typingIndicators, setTypingIndicators] = useState(true)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName || '')
      setBio(me.bio || '')
      setAvatarUrl(me.avatarUrl || '')
      setCustomStatus(me.customStatus || '')
      setLastSeenVisible(me.lastSeenVisible ?? true)
      setReadReceipts(me.readReceiptsEnabled ?? true)
      setTypingIndicators(me.typingIndicatorsEnabled ?? true)
    }
  }, [me])

  const update = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Saved')
    },
    onError: () => toast.error('Failed to save'),
  })

  const handleSave = () => {
    update.mutate({
      displayName,
      bio,
      avatarUrl,
      customStatus,
      lastSeenVisible,
      readReceiptsEnabled: readReceipts,
      typingIndicatorsEnabled: typingIndicators,
    })
  }

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAvatarUrl(data.url)
      toast.success('Avatar uploaded — click Save to apply')
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile and privacy.
          </p>
        </div>

        {/* Profile */}
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Profile</h2>

          <div className="flex items-center gap-4">
            <Avatar className="w-20 h-20">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="text-2xl">
                {displayName?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <label className="cursor-pointer">
                <span className="inline-flex items-center justify-center bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm hover:bg-primary/90">
                  {uploading ? 'Uploading...' : 'Change avatar'}
                </span>
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatar} disabled={uploading} />
              </label>
              {avatarUrl && (
                <Button variant="ghost" size="sm" className="ml-2" onClick={() => setAvatarUrl('')}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={me?.username || ''} disabled />
            <p className="text-xs text-muted-foreground">Username cannot be changed.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={me?.email || ''} disabled />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell your friends a bit about yourself."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customStatus">Custom status</Label>
            <Input
              id="customStatus"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="🎧 Listening to lofi"
              maxLength={80}
            />
          </div>
        </Card>

        {/* Privacy */}
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Privacy</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="lastSeen">Last seen visible</Label>
                <p className="text-xs text-muted-foreground">Show when you were last active.</p>
              </div>
              <Switch id="lastSeen" checked={lastSeenVisible} onCheckedChange={setLastSeenVisible} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="readReceipts">Read receipts</Label>
                <p className="text-xs text-muted-foreground">Let others know when you've read their messages.</p>
              </div>
              <Switch id="readReceipts" checked={readReceipts} onCheckedChange={setReadReceipts} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="typingIndicators">Typing indicators</Label>
                <p className="text-xs text-muted-foreground">Show others when you're typing.</p>
              </div>
              <Switch id="typingIndicators" checked={typingIndicators} onCheckedChange={setTypingIndicators} />
            </div>
          </div>
        </Card>

        {/* Save + Sign out */}
        <div className="flex justify-between gap-3">
          <Button variant="outline" onClick={() => signOut({ callbackUrl: '/' })} className="text-red-600">
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
