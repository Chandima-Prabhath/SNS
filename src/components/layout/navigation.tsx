'use client'

import { useAppStore, type ViewKey } from '@/stores/useAppStore'
import { useSession } from 'next-auth/react'
import { MessageCircle, Circle, Phone, Settings, Shield } from 'lucide-react'
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

/**
 * Bottom tab bar — mobile only.
 *
 * iOS/Android-style: 4 destinations, fixed to bottom, respects safe area.
 * Hidden on lg+ screens where the desktop sidebar takes over.
 */
export function BottomNav() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t pb-safe"
      aria-label="Primary"
    >
      <div className="grid grid-cols-4 max-w-md mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
                'active:scale-95 transition-transform',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon
                className="w-6 h-6"
                strokeWidth={active ? 2.4 : 2}
                fill={active && item.key === 'status' ? 'currentColor' : 'none'}
              />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * Desktop sidebar — left rail with the 4 destinations + brand.
 * Visible on lg+ screens.
 */
export function DesktopSidebar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { data: session } = useSession()
  const role = (session?.user as any)?.role

  return (
    <aside className="hidden lg:flex w-20 xl:w-60 shrink-0 flex-col items-center xl:items-stretch bg-sidebar border-r py-4">
      {/* Brand */}
      <div className="px-4 mb-6 flex items-center justify-center xl:justify-start">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-primary" />
        </div>
        <span className="hidden xl:block ml-2 font-semibold text-lg">SNS</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 px-2 xl:px-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'flex items-center justify-center xl:justify-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-current={active ? 'page' : undefined}
              title={item.label}
            >
              <Icon
                className="w-5 h-5 shrink-0"
                strokeWidth={active ? 2.4 : 2}
                fill={active && item.key === 'status' ? 'currentColor' : 'none'}
              />
              <span className="hidden xl:inline">{item.label}</span>
            </button>
          )
        })}

        {/* Admin — only for admins/owners */}
        {(role === 'admin' || role === 'owner') && (
          <button
            onClick={() => setView('settings' as ViewKey)}
            className={cn(
              'flex items-center justify-center xl:justify-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors mt-auto',
              'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            title="Admin (in Settings)"
          >
            <Shield className="w-5 h-5 shrink-0" />
            <span className="hidden xl:inline">Admin</span>
          </button>
        )}
      </nav>
    </aside>
  )
}
