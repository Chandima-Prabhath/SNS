'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, MessageCircle, Sparkles, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [loading, setLoading] = useState(false)

  // Sign-in fields
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  // Sign-up fields (simplified — no email)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier.trim() || !password) {
      toast.error('Fill in all fields')
      return
    }
    setLoading(true)
    const res = await signIn('credentials', {
      identifier,
      password,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      toast.error('Invalid username or password')
    } else {
      window.location.reload()
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !displayName || !signupPassword) {
      toast.error('Fill in all fields')
      return
    }
    if (signupPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (signupPassword !== confirmPassword) {
      toast.error("Passwords don't match")
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName,
          password: signupPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Registration failed')
      } else {
        toast.success('Account created! Signing you in...')
        await signIn('credentials', { identifier: username, password: signupPassword, redirect: false })
        window.location.reload()
      }
    } catch (e) {
      toast.error('Something went wrong')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      {/* Decorative gradient backdrop */}
      <div
        className="absolute inset-0 -z-10 opacity-30 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 80% at 20% 0%, oklch(0.65 0.15 162 / 0.25), transparent 50%), radial-gradient(50% 70% at 80% 100%, oklch(0.55 0.15 162 / 0.2), transparent 50%)',
        }}
      />

      <Card className="w-full max-w-md border-border/60 shadow-xl">
        <CardHeader className="text-center space-y-3 pb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
            <MessageCircle className="w-7 h-7 text-primary" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl tracking-tight">SNS</CardTitle>
            <CardDescription className="flex items-center justify-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              A private space for you and your friends
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList className="grid w-full grid-cols-2 mb-5">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            {/* ─── Sign in ─── */}
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="identifier">Username</Label>
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    disabled={loading}
                    className="h-12"
                    placeholder="janedoe"
                    autoCapitalize="none"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={setPassword}
                    disabled={loading}
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Sign in
                </Button>
              </form>
            </TabsContent>

            {/* ─── Sign up ─── */}
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane Doe"
                    disabled={loading}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="janedoe"
                      autoCapitalize="none"
                      disabled={loading}
                      className="h-12 pl-7"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">3+ chars, letters/numbers/underscore only</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signupPassword">Password</Label>
                  <PasswordInput
                    id="signupPassword"
                    value={signupPassword}
                    onChange={setSignupPassword}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={loading}
                    autoComplete="new-password"
                    error={confirmPassword.length > 0 && confirmPassword !== signupPassword}
                  />
                  {confirmPassword.length > 0 && confirmPassword !== signupPassword && (
                    <p className="text-xs text-red-500">Passwords don't match</p>
                  )}
                </div>
                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Password input with show/hide toggle.
 */
function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  autoComplete,
  error,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  autoComplete?: string
  error?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn('h-12 pr-11', error && 'border-red-500 focus-visible:ring-red-500')}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
