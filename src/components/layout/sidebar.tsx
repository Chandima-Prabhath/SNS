'use client'

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
import { useAppStore, type ViewKey } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import {
  MessageCircle,
  Circle,
  Phone,
  Bot,
  Settings,
  Shield,
  LogOut,
  Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  key: ViewKey
  label: string
  icon: typeof MessageCircle
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'chat', label: 'Chat', icon: MessageCircle },
  { key: 'status', label: 'Status', icon: Circle },
  { key: 'voice', label: 'Voice', icon: Phone },
  { key: 'bots', label: 'Bots', icon: Bot },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'admin', label: 'Admin', icon: Shield, adminOnly: true },
]

export function Sidebar() {
  const { data: session } = useSession()
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const presence = usePresence()

  const user = session?.user as any
  const role = user?.role || 'member'
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || role === 'admin' || role === 'owner')

  const myStatus = user ? presence[user.id]?.status || 'offline' : 'offline'

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed md:sticky top-0 left-0 h-screen w-16 md:w-64 bg-card border-r z-50',
          'flex flex-col items-center md:items-stretch p-2 md:p-4 gap-2',
          'transition-transform md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo / Brand */}
        <div className="h-12 flex items-center justify-center md:justify-start md:px-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
          <span className="hidden md:block ml-2 font-semibold">SNS</span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col gap-1 w-full">
          {items.map((item) => {
            const Icon = item.icon
            const active = view === item.key
            return (
              <button
                key={item.key}
                onClick={() => {
                  setView(item.key)
                  setSidebarOpen(false)
                }}
                className={cn(
                  'flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  'hover:bg-accent',
                  active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                )}
                title={item.label}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="hidden md:inline">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent w-full justify-center md:justify-start">
              <div className="relative">
                <Avatar className="w-9 h-9">
                  <AvatarImage src={user?.avatarUrl || undefined} />
                  <AvatarFallback>
                    {(user?.displayName || user?.username || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card',
                    myStatus === 'online' && 'bg-green-500',
                    myStatus === 'idle' && 'bg-yellow-500',
                    myStatus === 'dnd' && 'bg-red-500',
                    myStatus === 'offline' && 'bg-gray-400'
                  )}
                />
              </div>
              <div className="hidden md:block text-left flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user?.displayName}</div>
                <div className="text-xs text-muted-foreground truncate">@{user?.username}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="truncate">
              <div>{user?.displayName}</div>
              <div className="text-xs text-muted-foreground font-normal truncate">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setView('settings')}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
            {(role === 'admin' || role === 'owner') && (
              <DropdownMenuItem onClick={() => setView('admin')}>
                <Shield className="w-4 h-4 mr-2" />
                Admin Panel
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: '/' })}
              className="text-red-600 focus:text-red-600"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>
    </>
  )
}

export function MobileTopBar() {
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const view = useAppStore((s) => s.view)
  const current = NAV_ITEMS.find((i) => i.key === view)
  return (
    <div className="md:hidden flex items-center gap-2 p-3 border-b bg-card sticky top-0 z-30">
      <Button variant="ghost" size="icon" onClick={() => useAppStore.getState().setSidebarOpen(true)}>
        <Menu className="w-5 h-5" />
      </Button>
      <span className="font-medium">{current?.label || 'SNS'}</span>
    </div>
  )
}
