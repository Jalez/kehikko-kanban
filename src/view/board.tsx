import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Card } from '../board/cards.ts'
import { COLUMN_MEANS, COLUMN_NAMES, neighbour, type ColumnId } from '../board/columns.ts'
import type { BoardColumn, Placed } from '../board/moves.ts'
import type { Density } from '../header.ts'
import { BoardCard } from './card.tsx'

/**
 * The board: the columns the settings show, side by side, or one at a time with a switcher when the
 * container is narrower than `NARROW_PX`. Done can be folded to a strip.
 *
 * A card moves three ways, each to the same place: dragged, from its menu, or with the keyboard —
 * with a card focused, Alt+← and Alt+→ move it to the column beside, Alt+↑ and Alt+↓ move it up and
 * down its column; ↑ ↓ ← → alone move the focus. A move is said in a live region.
 */

export const NARROW_PX = 420
const DRAG_TYPE = 'application/x-kehikot-kanban-card'

export interface BoardViewProps {
  board: BoardColumn<Card>[]
  /** The cards the parts let through, by ref. */
  shown: ReadonlySet<string>
  density: Density
  showDone: boolean
  onShowDone(open: boolean): void
  narrow: boolean
  /** Narrower still: the switcher takes two rows. */
  cramped?: boolean
  /** The column shown when narrow. */
  column: ColumnId | null
  onColumn(column: ColumnId): void
  onOpen(card: Card): void
  onMove(card: Card, to: ColumnId, seenIndex: number, seenRefs: readonly string[]): void
  onReset(card: Card): void
  /** The card the person is on (focused or opened): kept in sight when the parts change. */
  onHold?(card: Card): void
  /** Days Done keeps, for the line saying older items are left off. */
  doneDays: number
  /** Whether parts are picked: then nothing about what the pick leaves out is counted. */
  narrowed: boolean
}

export function BoardView(props: BoardViewProps) {
  const { board, shown, density, showDone, narrow, column, doneDays, narrowed } = props
  /* Narrow, a folded Done is left out of the switcher: Show Done brings it back. */
  const columns = useMemo(() => board.filter((one) => one.shown && !(narrow && one.id === 'done' && !showDone)), [board, narrow, showDone])
  const ids = useMemo(() => columns.map((one) => one.id), [columns])
  const seen = useMemo(
    () => Object.fromEntries(columns.map((one) => [one.id, one.cards.filter((placed) => shown.has(placed.card.ref))])) as Record<ColumnId, Placed<Card>[]>,
    [columns, shown],
  )
  const current = column && ids.includes(column) ? column : (ids[0] ?? null)
  const [dragging, setDragging] = useState<Card | null>(null)
  const [drop, setDrop] = useState<{ column: ColumnId; index: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [heard, setHeard] = useState('')
  const root = useRef<HTMLDivElement>(null)

  /* After a move by keys, the moved card keeps the focus wherever it went. */
  useLayoutEffect(() => {
    if (!focus) return
    const target = root.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(focus)}"]`)
    if (target && document.activeElement !== target) target.focus()
    setFocus(null)
  }, [focus, board, current])

  const placeOf = (card: Card) => {
    for (const id of ids) {
      const at = seen[id].findIndex((one) => one.card.ref === card.ref)
      if (at >= 0) return { column: id, index: at }
    }
    return null
  }

  const moveTo = (card: Card, to: ColumnId, index: number, byKeys: boolean) => {
    const refs = seen[to].map((one) => one.card.ref)
    props.onMove(card, to, index, refs)
    const back = to === card.tracked ? ', where the tracker has it' : ''
    setHeard(`${card.short} is in ${COLUMN_NAMES[to]}${back}. This board only: the tracker is not changed.`)
    if (byKeys) {
      if (narrow) props.onColumn(to)
      setFocus(card.ref)
    }
  }

  const onKey = (card: Card) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    const at = placeOf(card)
    if (!at) return
    const list = seen[at.column]
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      props.onOpen(card)
      return
    }
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
    if (!step) return
    event.preventDefault()
    const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    if (event.altKey) {
      if (sideways) {
        const to = neighbour(ids, at.column, step)
        if (!to) return setHeard(`${card.short} is in the ${step < 0 ? 'first' : 'last'} column.`)
        if (to === 'done' && !showDone) props.onShowDone(true)
        moveTo(card, to, Math.min(at.index, seen[to].length), true)
      } else {
        const index = at.index + step
        if (index < 0 || index >= list.length) return setHeard(`${card.short} is at the ${step < 0 ? 'top' : 'bottom'} of ${COLUMN_NAMES[at.column]}.`)
        /* Among the column without it, `index` is where it lands. */
        moveTo(card, at.column, index, true)
      }
      return
    }
    if (sideways) {
      const to = neighbour(ids, at.column, step)
      if (!to) return
      if (narrow) props.onColumn(to)
      const there = seen[to]
      const target = there[Math.min(at.index, there.length - 1)]
      if (target) setFocus(target.card.ref)
      return
    }
    const target = list[at.index + step]
    if (target) setFocus(target.card.ref)
  }

  const dropIndex = (event: DragEvent<HTMLElement>, id: ColumnId): number => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter((one) => one.dataset.card !== dragging?.ref)
    const y = event.clientY
    const at = items.findIndex((one) => {
      const box = one.getBoundingClientRect()
      return y < box.top + box.height / 2
    })
    return at < 0 ? seen[id].filter((one) => one.card.ref !== dragging?.ref).length : at
  }

  const dropOn = (id: ColumnId) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const index = dropIndex(event, id)
      if (drop?.column !== id || drop.index !== index) setDrop({ column: id, index })
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      if (dragging) moveTo(dragging, id, dropIndex(event, id), false)
      setDragging(null)
      setDrop(null)
    },
  })

  const drawn = narrow ? columns.filter((one) => one.id === current) : columns

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col gap-2">
      {narrow && columns.length > 1 ? (
        <div role="tablist" aria-label="Column" className={cn('bg-muted flex shrink-0 gap-0.5 rounded-md p-0.5', props.cramped && 'flex-wrap')}>
          {columns.map((one) => {
            const count = seen[one.id].length
            return (
              <button
                key={one.id}
                role="tab"
                type="button"
                aria-selected={one.id === current}
                aria-controls={`column-${one.id}`}
                title={`${one.name}: ${count}. ${COLUMN_MEANS[one.id]}`}
                onClick={() => props.onColumn(one.id)}
                {...dropOn(one.id)}
                className={cn(
                  'focus-visible:ring-ring/60 flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 py-1 text-xs outline-none focus-visible:ring-[3px]',
                  props.cramped && 'basis-[calc(50%-2px)]',
                  one.id === current ? 'bg-background text-foreground font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  drop?.column === one.id && 'ring-ring ring-2',
                )}
              >
                <span className="truncate">{one.name}</span>
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      <div
        className={cn('flex min-h-0 flex-1 gap-2', narrow ? 'flex-col' : 'overflow-x-auto pb-1')}
        style={narrow ? undefined : { scrollSnapType: 'x proximity' }}
      >
        {drawn.map((one) => {
          const folded = one.id === 'done' && !showDone && !narrow
          const list = seen[one.id]
          return (
            <section
              key={one.id}
              id={`column-${one.id}`}
              role={narrow ? 'tabpanel' : 'region'}
              aria-label={`${one.name}, ${list.length} card${list.length === 1 ? '' : 's'}`}
              data-column={one.id}
              className={cn(
                'bg-muted/50 flex min-h-0 flex-col rounded-lg border',
                narrow ? 'flex-1' : folded ? 'w-9 shrink-0' : 'w-[15rem] min-w-[11rem] flex-1 shrink-0',
              )}
              style={narrow ? undefined : { scrollSnapAlign: 'start' }}
            >
              <header className={cn('flex shrink-0 items-center gap-1 px-2 py-1.5', folded && 'h-full flex-col px-0', narrow && 'sr-only')}>
                {one.id === 'done' && !narrow ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-expanded={showDone}
                    aria-label={showDone ? 'Fold Done' : 'Show Done'}
                    onClick={() => props.onShowDone(!showDone)}
                  >
                    {showDone ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                  </Button>
                ) : null}
                <h2 className={cn('text-xs font-medium', folded && '[writing-mode:vertical-rl]')} title={COLUMN_MEANS[one.id]}>
                  {one.name}
                </h2>
                <span className="text-muted-foreground text-xs tabular-nums">{list.length}</span>
              </header>
              {folded ? null : (
                <ol {...dropOn(one.id)} className={cn('flex min-h-12 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5', narrow && 'pt-1.5')} aria-label={one.name}>
                  {list.map((placed, at) => (
                    <li key={placed.card.key} className="relative" onFocus={() => props.onHold?.(placed.card)}>
                      {drop?.column === one.id && drop.index === at ? <DropLine /> : null}
                      <BoardCard
                        card={placed.card}
                        column={placed.column}
                        move={placed.move}
                        density={density}
                        columns={ids}
                        dragging={dragging?.ref === placed.card.ref}
                        onOpen={() => props.onOpen(placed.card)}
                        onMove={(to) => moveTo(placed.card, to, 0, false)}
                        onReset={() => {
                          props.onReset(placed.card)
                          setHeard(`${placed.card.short} is back in ${COLUMN_NAMES[placed.card.tracked]}, where the tracker has it.`)
                        }}
                        onKey={onKey(placed.card)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_TYPE, placed.card.ref)
                          event.dataTransfer.setData('text/plain', placed.card.url)
                          event.dataTransfer.effectAllowed = 'move'
                          setDragging(placed.card)
                        }}
                        onDragEnd={() => {
                          setDragging(null)
                          setDrop(null)
                        }}
                      />
                    </li>
                  ))}
                  {drop?.column === one.id && drop.index >= list.filter((p) => p.card.ref !== dragging?.ref).length ? (
                    <li className="relative h-0">
                      <DropLine />
                    </li>
                  ) : null}
                  {!list.length ? <li className="text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs">Nothing here.</li> : null}
                  {one.id === 'done' && one.older && !narrowed ? (
                    <li className="text-muted-foreground px-1 text-[11px]">
                      {one.older} finished more than {doneDays} day{doneDays === 1 ? '' : 's'} ago {one.older === 1 ? 'is' : 'are'} left off.
                    </li>
                  ) : null}
                </ol>
              )}
            </section>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite" data-testid="heard">
        {heard}
      </p>
    </div>
  )
}

function DropLine() {
  return <span aria-hidden className="bg-ring absolute -top-1 right-0 left-0 h-0.5 rounded" />
}

/** The container's width, measured; 0 until it is, which is read as wide. */
export function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
