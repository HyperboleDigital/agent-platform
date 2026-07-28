import { Fragment, type ReactNode } from 'react'

// Minimal, dependency-free markdown for the small subset our content uses:
// `###` headings, `-`/`*` bullet lists (with one level of indented nesting),
// **bold**, _italic_, and bare URLs as links. Built entirely from React
// elements — never dangerouslySetInnerHTML — so it's safe to render
// user-submitted request text too.
//
// This exists because change-request descriptions (both the auto-generated SEO
// fixes and free-text requests) are stored as markdown; rendering them in a
// single <p> collapsed every newline into an unreadable wall of `###`/`**`.

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
}

// Splits a line into text / **bold** / _italic_ / URL tokens. URLs are matched
// before italic so an underscore inside a link never starts an emphasis span.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const src = decodeEntities(text)
  const nodes: ReactNode[] = []
  const token = /(\*\*[^*]+\*\*|_[^_]+_|https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = token.exec(src)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{src.slice(last, m.index)}</Fragment>)
    const t = m[0]
    if (t.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">{t.slice(2, -2)}</strong>)
    } else if (t.startsWith('_')) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{t.slice(1, -1)}</em>)
    } else {
      nodes.push(<a key={`${keyPrefix}-a${i}`} href={t} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{t}</a>)
    }
    last = m.index + t.length
    i++
  }
  if (last < src.length) nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{src.slice(last)}</Fragment>)
  return nodes
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks: ReactNode[] = []
  let list: { indent: number; text: string }[] = []
  let key = 0

  const flushList = () => {
    if (!list.length) return
    const items = list
    list = []
    const k = key++
    blocks.push(
      <ul key={`ul-${k}`} className="flex flex-col gap-0.5">
        {items.map((it, idx) => (
          <li key={idx} className={`flex gap-1.5 ${it.indent > 0 ? 'ml-4 text-muted-foreground' : ''}`}>
            <span className="select-none opacity-60">•</span>
            <span>{renderInline(it.text, `li-${k}-${idx}`)}</span>
          </li>
        ))}
      </ul>
    )
  }

  for (const raw of content.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { flushList(); continue }

    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      flushList()
      const k = key++
      blocks.push(<div key={`h-${k}`} className="mt-3 break-all font-semibold text-foreground first:mt-0">{renderInline(heading[1], `h-${k}`)}</div>)
      continue
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (bullet) {
      list.push({ indent: bullet[1].length >= 2 ? 1 : 0, text: bullet[2] })
      continue
    }

    flushList()
    const k = key++
    blocks.push(<p key={`p-${k}`}>{renderInline(line.trim(), `p-${k}`)}</p>)
  }
  flushList()

  return <div className={`flex flex-col gap-1.5 text-sm leading-relaxed ${className ?? ''}`}>{blocks}</div>
}
