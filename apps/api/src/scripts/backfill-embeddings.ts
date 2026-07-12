import 'dotenv/config'
import { supabase } from '../lib/supabase'
import { embeddingsEnabled, embedDocuments } from '../lib/embeddings'

// Backfills embeddings for existing knowledge_base rows that don't have one yet.
// Run: pnpm --filter api backfill
async function main() {
  if (!embeddingsEnabled()) {
    console.error('VOYAGE_API_KEY is not set — nothing to do.')
    process.exit(1)
  }

  const BATCH = 50
  let total = 0

  for (;;) {
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('id, content')
      .is('embedding', null)
      .limit(BATCH)

    if (error) throw error
    if (!data?.length) break

    const embeddings = await embedDocuments(data.map(r => r.content as string))

    await Promise.all(
      data.map((row, i) =>
        supabase.from('knowledge_base').update({ embedding: embeddings[i] }).eq('id', row.id)
      )
    )

    total += data.length
    console.log(`Embedded ${total} rows…`)

    if (data.length < BATCH) break
  }

  console.log(`Done. Backfilled ${total} rows.`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
