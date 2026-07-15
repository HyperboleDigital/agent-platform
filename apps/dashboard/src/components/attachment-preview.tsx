import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import useSWR from 'swr'
import { FileText, X, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import type { RequestAttachment, KnowledgeFile } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

// Signed URLs are short-lived (5 min) but don't need to be re-minted while a
// thumbnail is just sitting on screen — without this, SWR's default
// revalidate-on-focus/reconnect swaps in a freshly-signed (but functionally
// identical) URL on every tab focus, which flashes the <img>/<object> as it
// reloads. One fetch per mount is enough; the Lightbox re-fetches fresh on
// open anyway since it's a separate mount.
const STABLE_URL_OPTS = { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false }

// Full-size in-page lightbox — opened by clicking a thumbnail. Never
// navigates away; a backdrop click or Escape closes it, and non-previewable
// files get an explicit "Open in new tab" link instead of auto-navigating.
// This is the only place a PDF is actually rendered — thumbnails never embed
// the live PDF viewer (see FileThumb below).
function Lightbox({ url, contentType, filename, onClose }: {
  url: string; contentType: string; filename: string; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isImage = contentType.startsWith('image/')
  const isPdf = contentType === 'application/pdf'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div className="relative flex max-h-full w-full max-w-4xl flex-col gap-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between text-sm text-white/80">
          <span className="truncate">{filename}</span>
          <div className="flex items-center gap-3">
            <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">
              <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
            </a>
            <button onClick={onClose} aria-label="Close" className="hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {isImage ? (
          <img src={url} alt={filename} className="max-h-[80vh] w-full rounded-md bg-black object-contain" />
        ) : isPdf ? (
          <iframe src={url} title={filename} className="h-[80vh] w-full rounded-md border-0 bg-white" />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md bg-card p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No inline preview for this file type.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Google-Drive-style thumbnail: images render directly; everything else
// (PDF included) shows a static file icon — thumbnails never embed a live
// PDF viewer, which would load the entire file just to fill a tiny box and
// re-flash it on every URL refresh. The real PDF render only happens in the
// Lightbox on click. `compact` shrinks to a small square with no filename
// caption and an optional inline `label` (e.g. a document title) rendered
// beside it, so a caller can make one combined click target.
function FileThumb({ url, contentType, filename, compact = false, label }: {
  url: string | undefined; contentType: string; filename: string; compact?: boolean; label?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isImage = contentType.startsWith('image/')
  const boxSize = compact ? 'h-9 w-9' : 'h-24 w-24'
  const iconSize = compact ? 'h-4 w-4' : 'h-8 w-8'

  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        disabled={!url}
        className={compact ? 'flex min-w-0 items-center gap-2.5 text-left' : 'flex w-24 flex-col items-center gap-1.5 text-center'}
        title={filename}
      >
        <div className={`flex ${boxSize} shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30`}>
          {!url ? (
            <Skeleton className="h-full w-full" />
          ) : isImage ? (
            <img src={url} alt={filename} className="h-full w-full object-cover" />
          ) : (
            <FileText className={`${iconSize} text-muted-foreground`} />
          )}
        </div>
        {compact ? (label ?? null) : <span className="w-full truncate text-xs text-muted-foreground">{filename}</span>}
      </button>
      {open && url && (
        <Lightbox url={url} contentType={contentType} filename={filename} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

export function AttachmentPreview({ clientId, requestId, attachment }: {
  clientId: string
  requestId: string
  attachment: RequestAttachment
}) {
  const { data } = useSWR(
    ['attachment-url', clientId, requestId, attachment.id],
    () => api.clients.requestAttachmentUrl(clientId, requestId, attachment.id),
    STABLE_URL_OPTS
  )
  return <FileThumb url={data?.url} contentType={attachment.contentType} filename={attachment.filename} />
}

export function KnowledgeFilePreview({ clientId, file, compact = false, label }: {
  clientId: string; file: KnowledgeFile; compact?: boolean; label?: ReactNode
}) {
  const { data } = useSWR(
    ['knowledge-file-url', clientId, file.id],
    () => api.clients.knowledgeFileUrl(clientId, file.id),
    STABLE_URL_OPTS
  )
  return <FileThumb url={data?.url} contentType={file.contentType} filename={file.filename} compact={compact} label={label} />
}
