'use client'

import { create } from 'zustand'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  resolve_: (value: boolean) => void
}

/**
 * Global confirm dialog store. Usage:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete?', message: 'Are you sure?', variant: 'danger' })) { ... }
 *
 * Renders the dialog via <ConfirmDialog /> mounted once at the app root.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: { title: '' },
  resolve: null,
  confirm: (options) => {
    return new Promise<boolean>((resolve) => {
      set({ open: true, options, resolve })
    })
  },
  resolve_: (value) => {
    const { resolve } = get()
    resolve?.(value)
    set({ open: false, resolve: null })
  },
}))

/** Hook to get the confirm function */
export function useConfirm() {
  return useConfirmStore((s) => s.confirm)
}
