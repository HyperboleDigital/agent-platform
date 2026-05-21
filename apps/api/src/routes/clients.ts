import { Router } from 'express'
import { getAllClients, upsertClient, getClientById } from '../lib/clients'
import { addDocument } from '../tools/knowledge-base'

export const clientsRouter = Router()

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
    res.status(400).json({ error: String(err) })
  }
})

// Add a knowledge base document to a client
clientsRouter.post('/:id/knowledge', async (req, res) => {
  const { title, content } = req.body as { title: string; content: string }
  if (!title || !content) return res.status(400).json({ error: 'title and content required' })
  const docId = await addDocument(req.params.id, title, content)
  res.json({ id: docId })
})
