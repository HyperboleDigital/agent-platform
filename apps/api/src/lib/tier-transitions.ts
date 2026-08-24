import { supabase } from './supabase'
import { tierForKey } from './tiers'

// The one choke point for changing a client's tier — used by BOTH the Stripe
// webhook (a paid tier subscription syncing) and the superadmin "Save tier"
// path, so the downgrade side-effects below can't be skipped by either.
//
// Chatbot persistence at Care (business decision 2026-08-18): a client who
// downgrades OFF a chat-including tier keeps a previously-built chatbot LIVE —
// still answering, logging conversations, capturing leads. What stops is the
// managed work (KB retraining, new document ingestion, the unanswered-questions
// review, prompt changes). Deliberate retention design: the widget on their
// site keeps working, they just stop getting the ongoing care of it.
//
// Implemented as a comp grant at downgrade time rather than putting 'chat' in
// Care's `includes` — otherwise every Care client who never had a bot would be
// entitled to a widget that doesn't exist.
export async function applyTierTransition(clientId: string, newTierKey: string | null): Promise<void> {
  const { data: row, error } = await supabase
    .from('clients')
    .select('tier_key, agent_config')
    .eq('id', clientId)
    .single()
  if (error || !row) {
    console.error('[tiers] transition: failed to load client', clientId, error?.message)
    return
  }

  const oldTier = tierForKey(row.tier_key as string | null)
  const newTier = tierForKey(newTierKey)
  const resolvedKey = newTier?.key ?? null // legacy keys normalize to the consolidated catalog

  const hadChat = oldTier?.includes.includes('chat') ?? false
  const hasChat = newTier?.includes.includes('chat') ?? false

  // "Previously built" = a knowledge base was ever ingested for this client's
  // assistant. A client who never had a bot gets no grant — there's nothing to
  // keep live.
  const agentConfig = (row.agent_config ?? {}) as { knowledgeBaseIds?: string[] } & Record<string, unknown>
  const botBuilt = (agentConfig.knowledgeBaseIds?.length ?? 0) > 0

  if (hadChat && !hasChat && botBuilt) {
    // Same upsert shape as billing.ts's grantService — inlined here (not
    // imported) to keep billing.ts → tier-transitions.ts one-directional.
    const { error: grantErr } = await supabase.from('service_grants').upsert({
      client_id: clientId,
      service_key: 'chat',
      source: 'comp',
      granted_by: 'system:tier-downgrade',
      revoked_at: null
    }, { onConflict: 'client_id,service_key' })
    if (grantErr) console.error('[tiers] transition: failed to grant chat persistence', grantErr.message)
    // Live-but-unmanaged: the widget answers and captures, but KB retraining /
    // content updates / the unanswered-questions review stop. The dashboard
    // shows this as a quiet notice on the assistant section.
    agentConfig.chatUnmanaged = true
  }
  if (hasChat) {
    // Back on a managed tier — the bot is actively managed again. The comp
    // grant (if one exists) is left in place: it's redundant while the tier
    // grants chat, and it's exactly what should survive a future downgrade.
    delete agentConfig.chatUnmanaged
  }

  const { error: updErr } = await supabase
    .from('clients')
    .update({ tier_key: resolvedKey, agent_config: agentConfig })
    .eq('id', clientId)
  if (updErr) console.error('[tiers] transition: failed to update tier_key', updErr.message)

  // Tier changed -> the promised deliverable set changed. Reconcile the
  // client's scheduled jobs now rather than waiting for the hourly sweep.
  // Lazy import: scheduled-jobs imports report-scheduler which imports tiers,
  // and a static import here would close that cycle.
  const { reconcileClientJobs } = await import('./scheduled-jobs')
  await reconcileClientJobs(clientId).catch(err =>
    console.error('[tiers] job reconcile after transition failed:', err instanceof Error ? err.message : err))
}
