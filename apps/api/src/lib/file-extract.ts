import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']

export function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// Verify the file's actual bytes match its claimed extension, so a hostile
// upload can't smuggle (say) a zip-bomb in as "notes.txt" or hand the PDF
// parser bytes it never expects. txt/md are treated as plain text (no reliable
// magic), but we reject anything that's clearly a binary container.
function magicBytesOk(lower: string, buf: Buffer): boolean {
  const head = buf.subarray(0, 8)
  if (lower.endsWith('.pdf')) return head.toString('latin1', 0, 5) === '%PDF-'
  if (lower.endsWith('.docx')) return head[0] === 0x50 && head[1] === 0x4b // 'PK' zip container
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    // Reject if it looks like a binary (NUL byte or a known container magic).
    if (buf.subarray(0, 1024).includes(0x00)) return false
    if (head[0] === 0x50 && head[1] === 0x4b) return false // zip
    if (head.toString('latin1', 0, 5) === '%PDF-') return false
    return true
  }
  return false
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

  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buffer.toString('utf-8')
  }

  throw new Error(`Unsupported file type: ${filename}`)
}
