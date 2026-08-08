import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  // Red confirm button + warning icon for destructive actions (delete, revoke,
  // disconnect). Defaults to true — most confirms in this app guard a delete.
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

// In-app replacement for window.confirm() — same call-site shape
// (`if (!(await confirm('Delete this?'))) return`) but styled to match the
// rest of the dashboard instead of a native browser dialog stamped with the
// app's URL. Mounted once in main.tsx alongside <Toaster/>.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(typeof opts === 'string' ? { message: opts } : opts)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  function settle(result: boolean) {
    resolver.current?.(result)
    resolver.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              {options.destructive !== false && (
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              )}
              <div className="flex flex-col gap-1">
                {options.title && <h2 id="confirm-dialog-title" className="text-sm font-semibold">{options.title}</h2>}
                <p className="text-sm text-muted-foreground">{options.message}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={options.destructive !== false ? 'destructive' : 'default'}
                size="sm"
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
