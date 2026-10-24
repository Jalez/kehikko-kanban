import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Ellipsis,
  ExternalLink,
  Eye,
  FlaskConical,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Hand,
  Hourglass,
  KeyRound,
  Layers,
  Siren,
  SquareCheck,
  Target,
  Ticket,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { DragEvent, KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { REVIEW_WORDS, TYPE_WORDS, type Card, type CardType, type ReviewWord } from '../board/cards.ts'
import { COLUMN_NAMES, type ColumnId } from '../board/columns.ts'
import { movedSaid, type Move } from '../board/moves.ts'
import type { Density } from '../header.ts'
import { Faces } from './faces.tsx'

/**
 * One card. Everything on it is text a tracker or a person wrote, drawn as text: never markup, never
 * a link but the card's own address, which is opened through the canvas.
 *
 * Its type is an icon AND a word (for a screen reader, and in the tooltip); its review state is an
 * icon of its own shape AND a word; a moved card says so in words. Nothing is told by colour alone.
 */

const TYPE_ICONS: Record<CardType, LucideIcon> = {
  issue: CircleDot,
  pr: GitPullRequest,
  mr: GitMerge,
  task: SquareCheck,
  incident: Siren,
  test_case: FlaskConical,
  requirement: ClipboardList,
  objective: Target,
  key_result: KeyRound,
  epic: Layers,
  ticket: Ticket,
}

const REVIEW_ICONS: Record<ReviewWord, LucideIcon> = { approved: CircleCheck, changes: CircleAlert, asked: Hourglass, needed: Eye }
const REVIEW_TONES: Record<ReviewWord, string> = {
  approved: 'text-emerald-700 dark:text-emerald-400',
  changes: 'text-amber-700 dark:text-amber-400',
  asked: 'text-muted-foreground',
  needed: 'text-muted-foreground',
}

export const LABELS_SHOWN = 4

export function typeIcon(card: Pick<Card, 'type' | 'draft'>): LucideIcon {
  return card.type === 'pr' && card.draft ? GitPullRequestDraft : TYPE_ICONS[card.type]
}

/** What a screen reader hears for a card, in one breath. */
export function cardSaid(card: Card, column: ColumnId, move: Move | null): string {
  return [
    `${card.draft ? 'Draft ' : ''}${TYPE_WORDS[card.type]} ${card.short}: ${card.title}`,
    `In ${COLUMN_NAMES[column]}`,
    move ? `${movedSaid(move)}; the tracker has it in ${COLUMN_NAMES[move.from]}` : card.why,
    card.review ? REVIEW_WORDS[card.review] : '',
  ]
    .filter(Boolean)
    .join('. ')
}

export interface CardProps {
  card: Card
  column: ColumnId
  move: Move | null
  density: Density
  /** The columns a card can be moved to from the menu, in order. */
  columns: readonly ColumnId[]
  dragging: boolean
  onOpen(): void
  onMove(to: ColumnId): void
  onReset(): void
  onKey(event: KeyboardEvent<HTMLElement>): void
  onDragStart(event: DragEvent<HTMLElement>): void
  onDragEnd(): void
}

export function BoardCard({ card, column, move, density, columns, dragging, onOpen, onMove, onReset, onKey, onDragStart, onDragEnd }: CardProps) {
  const Icon = typeIcon(card)
  const compact = density === 'compact'
  const Review = card.review ? REVIEW_ICONS[card.review] : null
  const said = cardSaid(card, column, move)
  const MoveIcon = move?.by.kind === 'agent' ? Bot : Hand
  return (
    <article
      data-card={card.ref}
      tabIndex={0}
      aria-label={said}
      aria-roledescription="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKey}
      onClick={(event) => {
        /* A press on the card opens it; a press inside its menu or on its reset does not. */
        if ((event.target as HTMLElement).closest('[data-no-open]')) return
        onOpen()
      }}
      className={cn(
        'group bg-card text-card-foreground focus-visible:ring-ring/60 relative flex cursor-pointer flex-col rounded-md border shadow-xs outline-none select-none hover:border-[color-mix(in_oklab,var(--ring)_60%,var(--border))] focus-visible:ring-[3px]',
        compact ? 'gap-0.5 px-2 py-1' : 'gap-1.5 p-2',
        dragging && 'opacity-40',
        move && 'border-dashed',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums" title={`${TYPE_WORDS[card.type]} ${card.short} in ${card.repo}`}>
          {card.short}
        </span>
        {compact ? <span className="min-w-0 flex-1 truncate text-xs">{card.title}</span> : <span className="flex-1" />}
        {Review ? (
          <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-[11px]', REVIEW_TONES[card.review!])} title={REVIEW_WORDS[card.review!]}>
            <Review className="size-3" aria-hidden />
            {compact ? <span className="sr-only">{REVIEW_WORDS[card.review!]}</span> : <span>{REVIEW_WORDS[card.review!]}</span>}
          </span>
        ) : null}
        {compact && move ? (
          <span className="text-muted-foreground inline-flex shrink-0" title={movedSaid(move)}>
            <MoveIcon className="size-3" aria-hidden />
          </span>
        ) : null}
        {compact ? <Faces people={card.assignees} label="Assigned" size="sm" /> : null}
        <CardMenu card={card} column={column} move={move} columns={columns} onOpen={onOpen} onMove={onMove} onReset={onReset} />
      </div>
      {compact ? null : (
        <>
          <p className="line-clamp-3 text-[13px] leading-snug break-words">{card.title}</p>
          {card.labels.length ? (
            <ul className="flex flex-wrap gap-1" aria-label="Labels">
              {card.labels.slice(0, LABELS_SHOWN).map((label) => (
                <li key={label} className="text-muted-foreground max-w-full truncate rounded border px-1 text-[11px] leading-4">
                  {label}
                </li>
              ))}
              {card.labels.length > LABELS_SHOWN ? (
                <li className="text-muted-foreground text-[11px] leading-4" title={card.labels.slice(LABELS_SHOWN).join(', ')}>
                  +{card.labels.length - LABELS_SHOWN}
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <Faces people={card.assignees} label="Assigned" />
            {card.reviewers.length ? <Faces people={card.reviewers} label="Reviewers" /> : null}
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-right text-[11px]" title={card.why}>
              {move ? '' : card.why}
            </span>
          </div>
          {move ? (
            <div className="text-muted-foreground flex min-w-0 items-center gap-1 border-t pt-1 text-[11px]">
              <MoveIcon className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={`${movedSaid(move)}. The tracker has it in ${COLUMN_NAMES[move.from]}.`}>
                {movedSaid(move)}
              </span>
              <Button
                data-no-open
                variant="ghost"
                size="sm"
                className="h-5 gap-1 px-1 text-[11px]"
                aria-label={`Put ${card.short} back in ${COLUMN_NAMES[move.from]}, where the tracker has it`}
                onClick={onReset}
              >
                <Undo2 className="size-3" aria-hidden />
                Put back
              </Button>
            </div>
          ) : null}
        </>
      )}
    </article>
  )
}

function CardMenu({
  card,
  column,
  move,
  columns,
  onOpen,
  onMove,
  onReset,
}: Pick<CardProps, 'card' | 'column' | 'move' | 'columns' | 'onOpen' | 'onMove' | 'onReset'>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-no-open
          variant="ghost"
          size="icon"
          className="text-muted-foreground -my-0.5 size-5 shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`More for ${card.short}`}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Ellipsis className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-no-open align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onOpen}>
          <ExternalLink aria-hidden />
          Open {card.short}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move on this board</DropdownMenuLabel>
        {columns
          .filter((id) => id !== column)
          .map((id) => (
            <DropdownMenuItem key={id} onSelect={() => onMove(id)}>
              <span className="size-4" aria-hidden />
              {COLUMN_NAMES[id]}
            </DropdownMenuItem>
          ))}
        {move ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>
              <Undo2 aria-hidden />
              Put back in {COLUMN_NAMES[move.from]}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
