import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// Drag-to-reorder for short editable lists (widget teaser prompts, quick-reply
// buttons). Native HTML5 drag and drop rather than a library — these are two
// small vertical lists in a desktop admin tool, not worth a dependency.
//
// Only the grip handle starts a drag. The rows contain text inputs, and making
// the whole row draggable would hijack click-and-drag text selection inside
// them, so `draggable` is toggled on just while the handle is held.
//
// Arrow keys on a focused handle move the row too, so this is usable without a
// mouse — native DnD has no keyboard equivalent of its own.
export function ReorderableList<T>({ items, onReorder, itemLabel, children }: {
  items: T[]
  onReorder: (next: T[]) => void
  /** Used for the handle's accessible name, e.g. "prompt" -> "Reorder prompt 2". */
  itemLabel: string
  children: (item: T, index: number) => React.ReactNode
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [armed, setArmed] = useState<number | null>(null)

  function commit(to: number) {
    if (dragIndex !== null) onReorder(move(items, dragIndex, to))
    setDragIndex(null)
    setOverIndex(null)
    setArmed(null)
  }

  return (
    <>
      {items.map((item, i) => (
        <div
          key={i}
          draggable={armed === i}
          onDragStart={() => setDragIndex(i)}
          onDragOver={e => { e.preventDefault(); setOverIndex(i) }}
          onDrop={e => { e.preventDefault(); commit(i) }}
          onDragEnd={() => { setDragIndex(null); setOverIndex(null); setArmed(null) }}
          className={cn(
            'flex items-center gap-2 rounded-md transition-colors',
            dragIndex === i && 'opacity-40',
            overIndex === i && dragIndex !== null && dragIndex !== i && 'ring-2 ring-primary/60'
          )}
        >
          <button
            type="button"
            aria-label={`Reorder ${itemLabel} ${i + 1}. Use arrow up and arrow down to move.`}
            onMouseDown={() => setArmed(i)}
            onMouseUp={() => setArmed(null)}
            onKeyDown={e => {
              if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); onReorder(move(items, i, i - 1)) }
              if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); onReorder(move(items, i, i + 1)) }
            }}
            className="shrink-0 cursor-grab rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          {children(item, i)}
        </div>
      ))}
    </>
  )
}
