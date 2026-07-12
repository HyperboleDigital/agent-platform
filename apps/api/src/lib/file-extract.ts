import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']

export function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const lower = filename.toLowerCase()

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
