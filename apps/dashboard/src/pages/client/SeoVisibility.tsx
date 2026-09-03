import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { SetupBanner } from '@/components/setup-banner'
import { AutomationCard } from '@/components/automation-card'
import { SiteHealthTab } from './Seo'
import { AiVisibilityTab } from './Visibility'

export default function SeoVisibility() {
  // Setup-checklist deep links (?setup=<key>) land on the tab holding the
  // card that fixes the item; the card itself scrolls/highlights via
  // useSetupTarget.
  const [params] = useSearchParams()
  const setupKey = params.get('setup')
  const setupTab = setupKey ? (setupKey === 'visibilityQueries' ? 'ai-visibility' : 'site-health') : null
  const [tab, setTab] = useState(setupTab ?? 'site-health')
  useEffect(() => { if (setupTab) setTab(setupTab) }, [setupKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const { clientId } = useClientCtx()
  const { data: me } = useSWR('me', api.me)
  const isSuperadmin = me?.isSuperadmin ?? false

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">SEO + AI Visibility</h2>
        <p className="text-sm text-muted-foreground">Technical site health, keyword rankings, and how your brand shows up in AI search.</p>
      </div>

      <SetupBanner clientId={clientId} />
      {isSuperadmin && <AutomationCard clientId={clientId} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="site-health">Site health & rankings</TabsTrigger>
          <TabsTrigger value="ai-visibility">AI visibility</TabsTrigger>
        </TabsList>
        <TabsContent value="site-health">
          <SiteHealthTab />
        </TabsContent>
        <TabsContent value="ai-visibility">
          <AiVisibilityTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
