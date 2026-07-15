import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.pptx']

export function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// Verify the file's actual bytes match its claimed extension, so a hostile
// upload can't smuggle (say) a zip-bomb in as "notes.txt" or hand the PDF
// parser bytes it never expects. txt/md/csv are treated as plain text (no
// reliable magic), but we reject anything that's clearly a binary container.
// docx/xlsx/pptx are all zip containers ('PK' header) — same as docx today.
function magicBytesOk(lower: string, buf: Buffer): boolean {
  const head = buf.subarray(0, 8)
  if (lower.endsWith('.pdf')) return head.toString('latin1', 0, 5) === '%PDF-'
  if (lower.endsWith('.docx') || lower.endsWith('.xlsx') || lower.endsWith('.pptx')) {
    return head[0] === 0x50 && head[1] === 0x4b // 'PK' zip container
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    // Reject if it looks like a binary (NUL byte or a known container magic).
    if (buf.subarray(0, 1024).includes(0x00)) return false
    if (head[0] === 0x50 && head[1] === 0x4b) return false // zip
    if (head.toString('latin1', 0, 5) === '%PDF-') return false
    return true
  }
  return false
}

// Slide text lives in ppt/slides/slideN.xml as <a:t>...</a:t> runs. Extracted
// with a regex rather than a full XML parser — pptx text runs are simple
// enough that this is reliable and avoids another dependency.
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numOf = (n: string) => Number(n.match(/slide(\d+)\.xml/)?.[1] ?? 0)
      return numOf(a) - numOf(b)
    })

  const decodeEntities = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

  const slides: string[] = []
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async('string')
    const runs = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(m => decodeEntities(m[1]))
    if (runs.length) slides.push(`## Slide ${i + 1}\n${runs.join(' ')}`)
  }
  return slides.join('\n\n')
}

// Each sheet becomes a CSV-shaped block so tabular data (pricing, catalogs)
// reads as text the model can reason about, prefixed with the sheet name.
function extractXlsxText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  return workbook.SheetNames
    .map(name => `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n')
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const lower = filename.toLowerCase()

  if (!magicBytesOk(lower, buffer)) {
    throw new Error("File contents don't match its extension.")
  }

  if (lower.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (lower.endsWith('.xlsx')) {
    return extractXlsxText(buffer)
  }

  if (lower.endsWith('.pptx')) {
    return extractPptxText(buffer)
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    return buffer.toString('utf-8')
  }

  throw new Error(`Unsupported file type: ${filename}`)
}
