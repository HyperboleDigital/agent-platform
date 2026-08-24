import { clerkClient } from '@clerk/express'
import { supabase } from './supabase'
import { normalizeDomain, isPublicHost, type Client } from '@agent-platform/shared'
import { getNotificationSettings, updateNotificationSettings } from './notify'
import { getOrgLogoUrl } from './org-logo'

interface ClientRow {
  id: string
  name: string
  domain: string
  industry: string
  active: boolean
  agent_config: Client['agentConfig']
  created_at: string
  clerk_org_id: string | null
  portal_config: Client['portalConfig']
  widget_config: Client['widgetConfig']
  vertical: Client['vertical']
  tier_key: string | null
  hosting: Client['hosting'] | null
  slug: string
  logo_path: string | null
  logo_content_type: string | null
}

async function fromRow(row: ClientRow): Promise<Client> {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    active: row.active,
    agentConfig: row.agent_config ?? ({} as Client['agentConfig']),
    createdAt: row.created_at,
    clerkOrgId: row.clerk_org_id ?? null,
    portalConfig: row.portal_config ?? {},
    widgetConfig: row.widget_config ?? {},
    vertical: row.vertical ?? null,
    tierKey: row.tier_key ?? null,
    hosting: row.hosting ?? 'us',
    slug: row.slug,
    logoPath: row.logo_path,
    logoContentType: row.logo_content_type,
    logoUrl: row.logo_path ? await getOrgLogoUrl(row.logo_path) : null
  }
}

function toRow(client: Partial<Client>): Partial<ClientRow> {
  const row: Partial<ClientRow> = {}
  if (client.id !== undefined) row.id = client.id
  if (client.name !== undefined) row.name = client.name
  if (client.domain !== undefined) row.domain = client.domain
  if (client.industry !== undefined) row.industry = client.industry
  if (client.active !== undefined) row.active = client.active
  if (client.agentConfig !== undefined) row.agent_config = client.agentConfig
  if (client.clerkOrgId !== undefined) row.clerk_org_id = client.clerkOrgId
  if (client.portalConfig !== undefined) row.portal_config = client.portalConfig
  if (client.widgetConfig !== undefined) row.widget_config = client.widgetConfig
  if (client.vertical !== undefined) row.vertical = client.vertical
  if (client.tierKey !== undefined) row.tier_key = client.tierKey
  if (client.hosting !== undefined) row.hosting = client.hosting
  if (client.slug !== undefined) row.slug = client.slug
  if (client.logoPath !== undefined) row.logo_path = client.logoPath
  if (client.logoContentType !== undefined) row.logo_content_type = client.logoContentType
  return row
}

// Clean, URL-safe identifier derived from a client name, e.g. "Spec-ID" ->
// "spec-id". Deliberately independent of Clerk's own auto-generated org slug
// (which includes a long random suffix and reads poorly in a URL).
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client'
}

// Appends -2, -3, ... until the slug is free. Called only at creation time (or
// when a superadmin explicitly sets one), so the loop runs at most a handful
// of times even under heavy name collisions.
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base
  let n = 2
  for (;;) {
    let query = supabase.from('clients').select('id').eq('slug', candidate)
    if (excludeId) query = query.neq('id', excludeId)
    const { data } = await query.maybeSingle()
    if (!data) return candidate
    candidate = `${base}-${n++}`
  }
}

export async function getClientByOrgId(clerkOrgId: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('clerk_org_id', clerkOrgId)
    .single()
  if (error) return null
  return fromRow(data as ClientRow)
}

export async function getClientById(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return fromRow(data as ClientRow)
}

// Dashboard routing resolves /clients/:slug to a UUID via this lookup, then
// works with `id` everywhere downstream — see apps/dashboard's ClientLayout.
export async function getClientBySlug(slug: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('slug', slug)
    .single()
  if (error) return null
  return fromRow(data as ClientRow)
}

export async function getAllClients(): Promise<Client[]> {
  const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
  return Promise.all(((data ?? []) as ClientRow[]).map(fromRow))
}

// Partial update if `id` is provided (Supabase .upsert() replaces the whole row
// on conflict, which would null out any omitted columns — not what a "save this
// one field" call from the dashboard wants). Falls back to insert otherwise.
export async function upsertClient(client: Partial<Client>): Promise<Client> {
  const row = toRow(client)

  // The one persistent, validated website URL for this client — Site Health,
  // the SEO audit, and Search Console all key off it. Validated at this single
  // choke point (every save path funnels through here) so a bad value like
  // "localhost" can never get saved again, whatever form or API caller sets it.
  if (row.domain !== undefined) {
    const normalized = normalizeDomain(row.domain)
    if (normalized && !isPublicHost(normalized)) {
      throw new Error(`"${normalized}" isn't a public website address — Site Health and the SEO audit need a real, live domain (not localhost or a private/internal address).`)
    }
    row.domain = normalized
  }

  // A superadmin editing the slug explicitly still needs it de-duplicated —
  // re-run it through the same uniqueness check as auto-generation below.
  if (row.slug !== undefined) {
    row.slug = await uniqueSlug(slugify(row.slug ?? ''), client.id)
  }

  if (client.id) {
    const { data, error } = await supabase
      .from('clients')
      .update(row)
      .eq('id', client.id)
      .select()
      .single()
    if (!error) return fromRow(data as ClientRow)
    if (error.code !== 'PGRST116') throw error // PGRST116 = no matching row, fall through to insert
  }

  // New client, no slug given — derive one from the name so it never has to
  // be set by hand for the common case.
  if (row.slug === undefined) {
    row.slug = await uniqueSlug(slugify(row.name ?? ''))
  }

  const { data, error } = await supabase.from('clients').insert(row).select().single()
  if (error) throw error
  return fromRow(data as ClientRow)
}

// Clerk's org-invitation acceptance doesn't reliably create the membership in a
// custom SPA flow (the user can complete sign-up without consuming the invite
// ticket, leaving the invitation "pending" and the user with no org). This
// reconciles that: for a signed-in user with no membership, find a client whose
// org has a pending invitation for their email and add them to it. Returns the
// org id they were joined to, or null. Idempotent and safe to call on load.
export async function reconcileUserMembership(userId: string): Promise<string | null> {
  const memberships = await clerkClient.users.getOrganizationMembershipList({ userId })
  if (memberships.data.length) return memberships.data[0].organization.id // already scoped

  const user = await clerkClient.users.getUser(userId)
  const email = (user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '').toLowerCase()
  if (!email) return null

  // Scan clients that have an org for a pending invitation to this email. Fine
  // at our scale; revisit if the client count grows large.
  const clients = await getAllClients()
  for (const c of clients) {
    if (!c.clerkOrgId) continue
    try {
      const invs = await clerkClient.organizations.getOrganizationInvitationList({ organizationId: c.clerkOrgId })
      const match = invs.data.find(i => i.emailAddress.toLowerCase() === email && i.status === 'pending')
      if (!match) continue
      await clerkClient.organizations.createOrganizationMembership({ organizationId: c.clerkOrgId, userId, role: 'org:admin' })
      // Joining this way doesn't consume the ticket, so Clerk would leave the
      // invitation "pending" forever — the same person then shows up as both a
      // member and a pending invite, double-counting a seat on the Team screen.
      // Retire it explicitly. Best effort: the membership is what matters.
      try {
        await clerkClient.organizations.revokeOrganizationInvitation({
          organizationId: c.clerkOrgId,
          invitationId: match.id
        })
      } catch (err) {
        console.error('[clients] joined org but failed to retire invitation', match.id, err instanceof Error ? err.message : err)
      }
      return c.clerkOrgId
    } catch (err) {
      console.error('[clients] reconcile check failed for org', c.clerkOrgId, err instanceof Error ? err.message : err)
    }
  }
  return null
}

// Permanently removes a client and everything owned by it. Every table that
// references clients(id) is ON DELETE CASCADE, so the single delete tears down
// leads, requests, crawls, subscriptions, citations, etc. with it. Also removes
// the Clerk Organization (the client's tenant + logins) if one exists — best
// effort, so a Clerk hiccup doesn't leave the DB row un-deletable.
export async function deleteClient(clientId: string): Promise<void> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  if (client.clerkOrgId) {
    try {
      await clerkClient.organizations.deleteOrganization(client.clerkOrgId)
    } catch (err) {
      console.error('[clients] failed to delete Clerk org (continuing)', err instanceof Error ? err.message : err)
    }
  }

  const { error } = await supabase.from('clients').delete().eq('id', clientId)
  if (error) throw new Error(`Failed to delete client: ${error.message}`)
}

// Onboards a real client user: creates the client's Clerk Organization if it
// doesn't have one yet (this IS their tenant boundary — canAccessClient checks
// clerkOrgId), then sends a Clerk-hosted invitation email to `email`. Clerk
// owns the whole accept flow (set password, etc.) — nothing custom to build.
// SENDS A REAL EMAIL. Callers must treat this as a deliberate, confirmed
// action, never a side effect of another operation.
export async function inviteClientUser(clientId: string, email: string): Promise<{ clerkOrgId: string; invitationId: string }> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  let orgId = client.clerkOrgId

  // A stored org can be deleted out from under us (test churn, manual cleanup,
  // toggling Organizations). If so, every invite would 404 forever — so verify
  // it still exists and, if not, fall through and create a fresh one.
  if (orgId) {
    try {
      await clerkClient.organizations.getOrganization({ organizationId: orgId })
    } catch (err: any) {
      if (err?.errors?.[0]?.code === 'resource_not_found' || err?.status === 404) {
        orgId = null
      } else {
        throw err
      }
    }
  }

  if (!orgId) {
    let org
    try {
      org = await clerkClient.organizations.createOrganization({ name: client.name })
    } catch (err: any) {
      // The most common real-world failure: Organizations aren't turned on for
      // the Clerk instance yet. Clerk returns a bare 403 "Forbidden" otherwise,
      // which is useless to whoever clicked "Send invite".
      const code = err?.errors?.[0]?.code
      if (code === 'organization_not_enabled_in_instance') {
        throw new Error('Client logins need the Organizations feature enabled in Clerk. Turn it on at dashboard.clerk.com → Organizations, then try again.')
      }
      throw err
    }
    orgId = org.id
    await upsertClient({ id: clientId, clerkOrgId: orgId })
  }

  // 'org:admin' so the client can manage their own org membership later if we
  // ever expose that — our own authz doesn't check org roles today, only
  // clerkOrgId membership, so this choice isn't load-bearing yet.
  // redirectUrl sends them straight into OUR dashboard after they accept +
  // set a password — otherwise Clerk drops them on its hosted "default-redirect"
  // welcome page, which looks broken to a client.
  // Must land on /sign-up: Clerk appends `__clerk_ticket` to this URL and only
  // <SignUp> consumes it. Pointing at the dashboard root sends the invitee
  // through ProtectedLayout's RedirectToSignIn, which strips the query string
  // and silently loses the ticket — they just get a plain login form.
  const dashboardUrl = (process.env.DASHBOARD_URL ?? 'http://localhost:5173').replace(/\/$/, '')
  const invitation = await clerkClient.organizations.createOrganizationInvitation({
    organizationId: orgId,
    emailAddress: email,
    role: 'org:admin',
    redirectUrl: `${dashboardUrl}/sign-up`
  })

  // Default the escalation + notification email to whoever's being onboarded
  // — this function is the only path that invites a NEW client's first user
  // (adding more people later goes through lib/team.ts's inviteMember, which
  // never touches these), so in practice this always means "the first user in
  // the org." Guarded by "only if unset" so it's idempotent, never overwrites
  // a value someone already configured, and a later re-invite can't reset it.
  if (!client.agentConfig?.escalationEmail) {
    await upsertClient({ id: clientId, agentConfig: { ...client.agentConfig, escalationEmail: email } })
  }
  const notifSettings = await getNotificationSettings(clientId)
  if (!notifSettings.email_to) {
    await updateNotificationSettings(clientId, { email_enabled: true, email_to: email })
  }

  return { clerkOrgId: orgId, invitationId: invitation.id }
}
