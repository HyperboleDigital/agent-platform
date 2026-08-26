// Spot-check for the Spec-ID agent's support-routing rules (see the client's
// agentConfig.systemPromptExtra). Runs the REAL agent against the live client
// config + knowledge base and asserts the routing behavior:
//
//   1. Support request, no customer context → phone number only, no email.
//   2. Existing-customer support → project-list-view + support-icon wording,
//      no links/URLs.
//   3. "Give me an email for pricing" → no raw email address handed out.
//
// ⚠️ Live side effects: this calls the LLM (small cost) and, if the model
// chooses to escalate, notifyEscalation emails the client's configured
// escalation recipient. Sessions use throwaway sess_spotcheck_* ids.
//
// Run: pnpm spot-check-spec-id
import 'dotenv/config'
import { getClientBySlug } from '../lib/clients'
import { runAgent } from '../lib/orchestrator'

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/
const URL_RE = /https?:\/\/|www\./i

interface Case {
  name: string
  message: string
  check: (reply: string) => string[] // returned strings are failures
}

const cases: Case[] = [
  {
    name: 'support request, unknown customer status → phone only',
    message: 'How do I get support?',
    check: reply => {
      const fails: string[] = []
      if (!reply.includes('578-0881')) fails.push('missing support phone (312) 578-0881')
      if (EMAIL_RE.test(reply)) fails.push(`gave out an email address: ${reply.match(EMAIL_RE)![0]}`)
      return fails
    }
  },
  {
    name: 'existing customer support → project list view + support icon, no URLs',
    message: "I'm a customer and my submittal won't upload. How do I get help?",
    check: reply => {
      const fails: string[] = []
      if (!/project list/i.test(reply)) fails.push('missing "project list view" instruction')
      if (!/support icon/i.test(reply)) fails.push('missing "support icon" instruction')
      if (URL_RE.test(reply)) fails.push('exposed a link/URL')
      if (EMAIL_RE.test(reply)) fails.push(`gave out an email address: ${reply.match(EMAIL_RE)![0]}`)
      return fails
    }
  },
  {
    name: 'email request for pricing → no raw email address',
    message: "Can I get someone's email to talk about pricing?",
    check: reply => {
      const fails: string[] = []
      if (EMAIL_RE.test(reply)) fails.push(`gave out an email address: ${reply.match(EMAIL_RE)![0]}`)
      return fails
    }
  }
]

async function main() {
  const client = await getClientBySlug('spec-id')
  if (!client) throw new Error('spec-id client not found')

  let failed = 0
  for (const c of cases) {
    // Fresh session per case so no case's history bleeds into the next.
    const from = `sess_spotcheck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { reply } = await runAgent({ clientId: client.id, channel: 'chat', from, body: c.message })
    const fails = c.check(reply)
    const status = fails.length ? '✗ FAIL' : '✓ pass'
    console.log(`\n${status}  ${c.name}`)
    console.log(`  visitor: ${c.message}`)
    console.log(`  agent:   ${reply.replace(/\n/g, '\n           ')}`)
    for (const f of fails) console.log(`  ⚠ ${f}`)
    if (fails.length) failed++
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
