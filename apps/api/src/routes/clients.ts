import { Router } from 'express'
import multer from 'multer'
import { getAllClients, upsertClient, getClientById } from '../lib/clients'
import { addDocument, listDocuments } from '../tools/knowledge-base'
import { extractText, isSupportedFile, SUPPORTED_EXTENSIONS } from '../lib/file-extract'
import { getLeads } from '../tools/crm'
import { getStats } from '../lib/logs'
import { getConnectorStatus } from '../lib/connectors'

export const clientsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
})

clientsRouter.get('/', async (_req, res) => {
  const clients = await getAllClients()
  res.json(clients)
})

clientsRouter.get('/:id', async (req, res) => {
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  res.json(client)
})

clientsRouter.post('/', async (req, res) => {
  try {
    const client = await upsertClient(req.body)
    res.json(client)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Dashboard summary stats for a client
clientsRouter.get('/:id/stats', async (req, res) => {
  res.json(await getStats(req.params.id))
})

// Leads captured for a client
clientsRouter.get('/:id/leads', async (req, res) => {
  res.json(await getLeads(req.params.id))
})

// List knowledge base documents for a client
clientsRouter.get('/:id/knowledge', async (req, res) => {
  res.json(await listDocuments(req.params.id))
})

// Add a knowledge base document to a client
clientsRouter.post('/:id/knowledge', async (req, res) => {
  const { title, content, url } = req.body as { title: string; content: string; url?: string }
  if (!title || !content) return res.status(400).json({ error: 'title and content required' })
  const ids = await addDocument(req.params.id, title, content, url)
  res.json({ ids, chunks: ids.length })
})

// Upload a document file (PDF, Word, txt, md) to a client's knowledge base
clientsRouter.post('/:id/knowledge/upload', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  if (!isSupportedFile(file.originalname)) {
    return res.status(400).json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}` })
  }

  try {
    const text = await extractText(file.originalname, file.buffer)
    if (!text.trim()) return res.status(400).json({ error: 'No extractable text found in file' })
    const ids = await addDocument(req.params.id, file.originalname, text)
    res.json({ ids, chunks: ids.length })
  } catch (err) {
    console.error('[knowledge upload] extraction error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to process file' })
  }
})

// Connector status (Gmail, Slack, Calendly) for a client
clientsRouter.get('/:id/connectors', async (req, res) => {
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  res.json(await getConnectorStatus(req.params.id, client.agentConfig))
})
