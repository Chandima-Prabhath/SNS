'use client'

import { useConfirmStore } from '@/hooks/useConfirm'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

/**
 * Global confirm dialog — mounted once at the app root.
 * Triggered by the `useConfirm()` hook from any component.
 *
 * Usage:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete?', message: 'This cannot be undone.', variant: 'danger' })) {
 *     // user confirmed
 *   }
 */
export function ConfirmDialog() {
  const { open, options, resolve_ } = useConfirmStore()
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default' } = options

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) resolve_(false) }}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolve_(false)}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resolve_(true)}
            className={cn(variant === 'danger' && 'bg-red-500 hover:bg-red-600 text-white')}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
