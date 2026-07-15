import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SiteHealthTab } from './Seo'
import { AiVisibilityTab } from './Visibility'

export default function SeoVisibility() {
  const [tab, setTab] = useState('site-health')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">SEO + AI Visibility</h2>
        <p className="text-sm text-muted-foreground">Technical site health, keyword rankings, and how your brand shows up in AI search.</p>
      </div>

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
