'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Eye, EyeOff, Check, X, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [loading, setLoading] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier.trim() || !password) { toast.error('Fill in all fields'); return }
    setLoading(true)
    const res = await signIn('credentials', { identifier, password, redirect: false })
    setLoading(false)
    if (res?.error) toast.error('Invalid username or password')
    else window.location.reload()
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !displayName || !signupPassword) { toast.error('Fill in all fields'); return }
    if (signupPassword.length < 6) { toast.error('Password must be at least 6 characters'); return }
    if (signupPassword !== confirmPassword) { toast.error("Passwords don't match"); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password: signupPassword }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || 'Registration failed')
      else {
        toast.success('Account created!')
        await signIn('credentials', { identifier: username, password: signupPassword, redirect: false })
        window.location.reload()
      }
    } catch { toast.error('Something went wrong') }
    setLoading(false)
  }

  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === signupPassword
  const passwordMismatch = confirmPassword.length > 0 && confirmPassword !== signupPassword

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Gradient backdrop */}
      <div
        className="absolute inset-0 -z-10 opacity-40 pointer-events-none"
        style={{
          background: 'radial-gradient(50% 50% at 25% 25%, oklch(0.72 0.17 150 / 0.18), transparent 70%), radial-gradient(40% 40% at 75% 75%, oklch(0.62 0.17 150 / 0.10), transparent 70%)',
        }}
      />

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary/15 items-center justify-center mb-4 ring-1 ring-primary/20">
            <MessageCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Adoo</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            A private space for you and your friends
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 shadow-xl overflow-hidden">
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <div className="flex border-b">
              <TabsList className="grid grid-cols-2 w-full bg-transparent h-auto p-0 rounded-none">
                <TabsTrigger value="signin" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3.5 text-sm font-medium">
                  Sign in
                </TabsTrigger>
                <TabsTrigger value="signup" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3.5 text-sm font-medium">
                  Create account
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6">
              <TabsContent value="signin" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="identifier" className="text-sm font-medium">Username</Label>
                  <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" disabled={loading} className="h-12" placeholder="janedoe" autoCapitalize="none" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                  <PasswordInput id="password" value={password} onChange={setPassword} disabled={loading} autoComplete="current-password" />
                </div>
                <Button type="button" onClick={handleSignIn} className="w-full h-12 text-sm font-medium" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Sign in
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-sm font-medium">Display name</Label>
                  <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" disabled={loading} className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-medium">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">@</span>
                    <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="janedoe" autoCapitalize="none" disabled={loading} className="h-12 pl-8" />
                  </div>
                  <p className="text-xs text-muted-foreground">3+ chars, letters/numbers/underscore only</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signupPassword" className="text-sm font-medium">Password</Label>
                  <PasswordInput id="signupPassword" value={signupPassword} onChange={setSignupPassword} disabled={loading} autoComplete="new-password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</Label>
                  <PasswordInput id="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} disabled={loading} autoComplete="new-password" error={passwordMismatch} success={passwordsMatch} />
                  {passwordMismatch && <p className="text-xs text-red-500 flex items-center gap-1"><X className="w-3 h-3" />Passwords don't match</p>}
                  {passwordsMatch && <p className="text-xs text-status-online flex items-center gap-1"><Check className="w-3 h-3" />Passwords match</p>}
                </div>
                <Button type="button" onClick={handleSignUp} className="w-full h-12 text-sm font-medium" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create account
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          By continuing, you agree to use this app responsibly.
        </p>
      </div>
    </div>
  )
}

function PasswordInput({ id, value, onChange, disabled, autoComplete, error, success }: any) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} disabled={disabled} className={cn('h-12 pr-11', error && 'border-red-500 focus-visible:ring-red-500', success && 'border-status-online')} />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
