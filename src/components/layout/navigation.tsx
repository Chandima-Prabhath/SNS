'use client'

import { useAppStore, type ViewKey } from '@/stores/useAppStore'
import { useUnreadCounts } from '@/hooks/useUnreadCounts'
import { useCall } from '@/hooks/useCall'
import { useSession } from 'next-auth/react'
import { signOut } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MessageCircle, Circle, Phone, Settings, Shield, LogOut, Phone as PhoneIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  key: ViewKey
  label: string
  icon: typeof MessageCircle
}

const NAV_ITEMS: NavItem[] = [
  { key: 'chats', label: 'Chats', icon: MessageCircle },
  { key: 'status', label: 'Status', icon: Circle },
  { key: 'voice', label: 'Calls', icon: Phone },
  { key: 'settings', label: 'Settings', icon: Settings },
]

export function BottomNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const { data: unreadData } = useUnreadCounts()
  const { status: callStatus } = useCall()

  const totalUnread = unreadData?.total || 0

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 glass border-t pb-safe"
        aria-label="Primary"
      >
        <div className="grid grid-cols-4 max-w-md mx-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = view === item.key
            const showBadge = item.key === 'chats' && totalUnread > 0
            const showCallIndicator = item.key === 'voice' && callStatus !== 'idle'
            return (
              <button
                key={item.key}
                onClick={() => { setView(item.key); setSidebarOpen(false) }}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 py-2.5 transition-all active:scale-95',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <div className="relative">
                  <Icon
                    className="w-6 h-6"
                    strokeWidth={active ? 2.4 : 2}
                    fill={active && item.key === 'status' ? 'currentColor' : 'none'}
                  />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                  {showCallIndicator && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-pulse border-2 border-background" />
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

export function DesktopSidebar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { data: session } = useSession()
  const { data: unreadData } = useUnreadCounts()
  const { status: callStatus } = useCall()
  const role = (session?.user as any)?.role
  const totalUnread = unreadData?.total || 0

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-sidebar border-r">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight">SNS</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">Friends Social</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          const showBadge = item.key === 'chats' && totalUnread > 0
          const showCallIndicator = item.key === 'voice' && callStatus !== 'idle'
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <div className="relative">
                <Icon
                  className="w-5 h-5 shrink-0"
                  strokeWidth={active ? 2.4 : 2}
                  fill={active && item.key === 'status' ? 'currentColor' : 'none'}
                />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
                {showCallIndicator && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-pulse border-2 border-sidebar" />
                )}
              </div>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* User menu */}
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent transition-colors">
              <Avatar className="w-9 h-9">
                <AvatarImage src={(session?.user as any)?.avatarUrl || undefined} />
                <AvatarFallback>
                  {(session?.user as any)?.displayName?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium truncate">
                  {(session?.user as any)?.displayName}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  @{(session?.user as any)?.username}
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="truncate">
              <div>{(session?.user as any)?.displayName}</div>
              <div className="text-xs text-muted-foreground font-normal truncate">
                {(session?.user as any)?.email}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setView('settings')}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
            {(role === 'admin' || role === 'owner') && (
              <DropdownMenuItem onClick={() => setView('settings')}>
                <Shield className="w-4 h-4 mr-2" />
                Admin Panel
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: '/' })}
              className="text-red-500 focus:text-red-500"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

export function MobileTopBar() {
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const view = useAppStore((s) => s.view)
  const current = NAV_ITEMS.find((i) => i.key === view)
  return (
    <div className="md:hidden flex items-center gap-2 p-3 border-b bg-card sticky top-0 z-30">
      <Button variant="ghost" size="icon" onClick={() => useAppStore.getState().setSidebarOpen(true)}>
        <MessageCircle className="w-5 h-5" />
      </Button>
      <span className="font-medium">{current?.label || 'SNS'}</span>
    </div>
  )
}
