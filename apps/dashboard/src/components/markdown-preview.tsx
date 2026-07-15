import { Fragment } from 'react'

// Small read-only renderer for the exact markdown subset the content engine
// produces (##/### headings, paragraphs, bullet lists, bold, links) — not a
// general-purpose renderer. Mirrors apps/api/src/lib/framer.ts's markdownToHtml.
function inline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*.+?\*\*|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*(.+)\*\*$/)
    if (bold) return <strong key={`${keyPrefix}-${i}`}>{bold[1]}</strong>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) return <a key={`${keyPrefix}-${i}`} href={link[2]} className="text-primary hover:underline">{link[1]}</a>
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
  })
}

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const lines = withoutComments.split('\n')
  const blocks: JSX.Element[] = []
  let list: string[] = []

  const flushList = (key: string) => {
    if (list.length) {
      blocks.push(
        <ul key={key} className="list-disc pl-5">
          {list.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>)}
        </ul>
      )
      list = []
    }
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    const key = `b${idx}`
    if (!line) { flushList(key); return }
    if (line.startsWith('### ')) { flushList(key); blocks.push(<h3 key={key} className="mt-4 text-sm font-semibold">{inline(line.slice(4), key)}</h3>); return }
    if (line.startsWith('## ')) { flushList(key); blocks.push(<h2 key={key} className="mt-5 text-base font-semibold">{inline(line.slice(3), key)}</h2>); return }
    if (line.startsWith('- ') || line.startsWith('* ')) { list.push(line.slice(2)); return }
    flushList(key)
    blocks.push(<p key={key} className="mt-2 text-sm leading-relaxed">{inline(line, key)}</p>)
  })
  flushList('end')

  return <div className="prose-sm max-w-none">{blocks}</div>
}
