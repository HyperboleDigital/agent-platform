import { ServerCrash, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ServerDownScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <ServerCrash className="h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Can't reach the server</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        You're still signed in — the API just isn't responding right now. Check that it's running, then try again.
      </p>
      <Button onClick={onRetry} disabled={retrying} className="mt-2">
        <RotateCw className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Checking…' : 'Retry'}
      </Button>
    </div>
  )
}
