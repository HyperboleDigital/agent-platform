import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

// Deep-link target for the setup-checklist banner. Each incomplete item links
// to the SEO page with ?setup=<item key>; the card that fixes that item calls
// this hook with its key(s) and gets a ref to attach plus a highlight class,
// and is scrolled into view when the link is followed. SeoVisibility reads the
// same param to pick the right tab, so the scroll fires as the card mounts.
export function useSetupTarget(...keys: string[]) {
  const [params] = useSearchParams()
  const setup = params.get('setup')
  const active = !!setup && keys.includes(setup)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [active])
  return { ref, highlight: active ? 'ring-2 ring-primary/50' : '' }
}
