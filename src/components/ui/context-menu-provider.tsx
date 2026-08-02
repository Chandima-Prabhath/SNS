'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
}

const ContextMenuContext = createContext<{
  show: (x: number, y: number, items: ContextMenuItem[]) => void
} | null>(null)

export function useContextMenu() {
  const ctx = useContext(ContextMenuContext)
  return ctx
}

/**
 * Global context menu provider. Wraps the app and provides a `show` function
 * via context that any component can call to display a custom context menu
 * at a given x/y position.
 *
 * Usage:
 *   const { show } = useContextMenu()
 *   <div onContextMenu={(e) => { e.preventDefault(); show(e.clientX, e.clientY, [...] ) }} />
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Disable the browser's default context menu globally so our custom one
  // is the only one that appears. We do this here (in a client component)
  // rather than on <body> in the root layout (which is a server component
  // and can't pass event handlers).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Only prevent if the target isn't an input/textarea (let those keep
      // their native context menu for copy/paste)
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  const show = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    // Adjust position so the menu doesn't go off-screen
    const menuWidth = 200
    const menuHeight = items.length * 40 + 16
    const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8)
    const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8)
    setMenu({ x: adjustedX, y: adjustedY, items })
  }, [])

  const hide = useCallback(() => setMenu(null), [])

  return (
    <ContextMenuContext.Provider value={{ show }}>
      {children}
      <AnimatePresence>
        {menu && (
          <>
            {/* Invisible backdrop to catch outside clicks */}
            <div
              className="fixed inset-0 z-[300]"
              onClick={hide}
              onContextMenu={(e) => { e.preventDefault(); hide() }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -8 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="fixed z-[301] min-w-[180px] py-1.5 rounded-xl glass-dark shadow-xl"
              style={{ left: menu.x, top: menu.y }}
            >
              {menu.items.map((item, i) => (
                <button
                  key={`${item.label}-${i}`}
                  onClick={() => { item.onClick(); hide() }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors hover:bg-accent/50 ${
                    item.variant === 'danger' ? 'text-red-400 hover:text-red-300' : 'text-foreground'
                  }`}
                >
                  {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ContextMenuContext.Provider>
  )
}

/**
 * Hook for detecting long-press on touch devices.
 * Returns handlers to spread on the target element.
 */
export function useLongPress(callback: () => void, duration = 500) {
  // MUST be a ref, not state. The previous implementation used useState,
  // which (a) caused stale-closure bugs because callback couldn't see the
  // latest timer, and (b) had no unmount cleanup — if the component
  // unmounted with a pending timer, the callback fired on an unmounted
  // component (React warning + potential bug).
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the callback in a ref so the timer always fires the latest version
  // without needing to re-create the timer on every callback change.
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const start = useCallback((e: React.TouchEvent) => {
    const timer = setTimeout(() => {
      callbackRef.current()
    }, duration)
    timeoutRef.current = timer
  }, [duration])

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Clear pending timer on unmount — prevents the callback firing after the
  // component is gone (e.g. user scrolls a long list and the row unmounts).
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
  }
}
