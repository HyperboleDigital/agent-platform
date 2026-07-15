// "AI Search Health" (GEO) check — the differentiator. Cheap to compute: fetch
// robots.txt to see whether the site blocks AI crawlers, and check for an
// llms.txt file (the emerging AI-guidance standard). No DataForSEO cost. This is
// our answer to SEMrush's paid "AI Search Health", built on our GEO thesis.

// The AI crawlers that matter for GEO. Blocking these means ChatGPT, Perplexity,
// Claude, Google's AI, etc. can't read the site — a direct hit to AI visibility.
const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',                 // OpenAI
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', // Anthropic
  'PerplexityBot', 'Perplexity-User',                        // Perplexity
  'Google-Extended',                                         // Google AI (Gemini/AI Overviews)
  'Applebot-Extended',                                       // Apple Intelligence
  'Amazonbot', 'Bytespider', 'CCBot', 'meta-externalagent',  // Amazon, TikTok, Common Crawl, Meta
]

export interface AiSearchIssue {
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
}

export interface AiSearchResult {
  score: number // 0-100
  hasLlmsTxt: boolean
  blockedBots: string[]
  issues: AiSearchIssue[]
}

async function fetchText(url: string, timeoutMs = 8000): Promise<{ ok: boolean; contentType: string; body: string } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'HyperboleSEO/1.0' }, signal: ctrl.signal })
    const body = await res.text()
    return { ok: res.ok, contentType: res.headers.get('content-type') ?? '', body }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Parse robots.txt into user-agent -> disallow rules, honoring the grouping rule
// (consecutive user-agent lines share the rules that follow, until the next group).
function parseRobots(txt: string): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  let current: string[] = []
  let sawRule = false
  for (const raw of txt.split('\n')) {
    const line = raw.split('#')[0].trim()
    if (!line || !line.includes(':')) continue
    const idx = line.indexOf(':')
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (sawRule) { current = []; sawRule = false }
      current.push(value.toLowerCase())
    } else if (field === 'disallow' || field === 'allow') {
      sawRule = true
      if (field === 'disallow') {
        for (const a of current) {
          if (!groups.has(a)) groups.set(a, [])
          groups.get(a)!.push(value)
        }
      }
    }
  }
  return groups
}

// A bot is "fully blocked" if its own group (or the wildcard * group, when the
// bot has no own group) disallows the site root.
function isFullyBlocked(groups: Map<string, string[]>, bot: string): boolean {
  const own = groups.get(bot.toLowerCase())
  if (own) return own.some(d => d === '/')
  const star = groups.get('*')
  return star ? star.some(d => d === '/') : false
}

export async function checkAiSearch(rawTarget: string): Promise<AiSearchResult> {
  const base = 'https://' + rawTarget.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()

  const robots = await fetchText(`${base}/robots.txt`)
  const groups = robots?.ok && robots.body ? parseRobots(robots.body) : new Map<string, string[]>()
  const blockedBots = AI_BOTS.filter(b => isFullyBlocked(groups, b))

  // llms.txt: require a 200 that isn't just an HTML soft-404 (SPA catch-all).
  const llms = await fetchText(`${base}/llms.txt`)
  const hasLlmsTxt = !!llms?.ok && !llms.contentType.includes('text/html') && !llms.body.trimStart().startsWith('<')

  // Score: 90% weighted on AI-crawler accessibility, 10% on having llms.txt.
  const allowed = AI_BOTS.length - blockedBots.length
  const score = Math.round((allowed / AI_BOTS.length) * 90 + (hasLlmsTxt ? 10 : 0))

  const issues: AiSearchIssue[] = []
  if (blockedBots.length) {
    issues.push({
      severity: 'high',
      title: `Blocking ${blockedBots.length} AI crawler${blockedBots.length > 1 ? 's' : ''}`,
      detail: `robots.txt disallows: ${blockedBots.join(', ')}. These AI engines can't read the site, so it can't be cited in their answers.`,
    })
  }
  if (!hasLlmsTxt) {
    issues.push({
      severity: 'low',
      title: 'No llms.txt file',
      detail: 'llms.txt is an emerging standard that tells AI engines how to use your content. Adding one is a low-effort GEO win.',
    })
  }
  return { score, hasLlmsTxt, blockedBots, issues }
}
