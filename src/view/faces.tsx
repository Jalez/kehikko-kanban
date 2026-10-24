import { CircleAlert, CircleCheck, Eye, Hourglass } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { FACES_SHOWN, imageLoadable, initialsOf } from '@/lib/faces'

import type { CardPerson } from '../board/cards.ts'

/**
 * Tiny round avatars, overlapping, `+N` past three — as References draws them. A face with no
 * picture, one the page's image policy does not name, or one that fails to load is the person's
 * initials on a plain disc. A reviewer's face carries a badge whose SHAPE says their state (an
 * hourglass for asked, an eye for commented, a ring with a bang for changes, a ring with a tick
 * for approved), never its colour alone.
 */
type ReviewerState = 'requested' | 'approved' | 'changes' | 'commented'

const BADGE: Record<ReviewerState, { icon: ReactNode; tone?: string; word: string }> = {
  requested: { icon: <Hourglass className="size-2" aria-hidden strokeWidth={3} />, word: 'asked to review' },
  commented: { icon: <Eye className="size-2" aria-hidden strokeWidth={3} />, word: 'commented' },
  changes: { icon: <CircleAlert className="size-2" aria-hidden strokeWidth={3} />, tone: 'text-amber-700 dark:text-amber-400', word: 'asked for changes' },
  approved: { icon: <CircleCheck className="size-2" aria-hidden strokeWidth={3} />, tone: 'text-emerald-700 dark:text-emerald-400', word: 'approved' },
}

function Avatar({ person, state, z, size }: { person: CardPerson; state?: ReviewerState; z: number; size: 'sm' | 'md' }) {
  const [failed, setFailed] = useState(false)
  const src = !failed && imageLoadable(person.avatarUrl) ? person.avatarUrl : null
  const px = size === 'sm' ? 16 : 20
  return (
    <span data-face={person.login ?? person.name} data-state={state} className="relative -ml-1 inline-flex shrink-0 first:ml-0" style={{ zIndex: z }}>
      <span
        className="ring-background relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--muted-foreground)_22%,var(--background))] ring-1"
        style={{ width: px, height: px }}
      >
        {/* The initials are always there, under the picture: a picture still loading, or never loading, leaves them showing. */}
        <span role="img" aria-label={person.name} className="text-foreground text-[8px] leading-none font-semibold">
          {initialsOf(person.name)}
        </span>
        {src ? (
          <img
            src={src}
            alt=""
            aria-hidden
            width={px}
            height={px}
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute inset-0 object-cover"
            style={{ width: px, height: px }}
          />
        ) : null}
      </span>
      {state ? (
        <span className={cn('bg-background text-muted-foreground absolute -right-0.5 -bottom-0.5 inline-flex size-2.5 items-center justify-center rounded-full', BADGE[state].tone)}>
          {BADGE[state].icon}
        </span>
      ) : null}
    </span>
  )
}

export function Faces({
  people,
  label,
  size = 'md',
}: {
  people: ReadonlyArray<CardPerson & { state?: ReviewerState }>
  /** What the group is, for a screen reader and the tooltip: "Assigned", "Reviewers". */
  label: string
  size?: 'sm' | 'md'
}) {
  if (!people.length) return null
  const shown = people.slice(0, FACES_SHOWN)
  const more = people.length - shown.length
  const said = `${label}: ${people.map((one) => (one.state ? `${one.name} (${BADGE[one.state].word})` : one.name)).join(', ')}`
  return (
    <span className="inline-flex items-center" title={said} aria-label={said} role="group">
      {shown.map((person, i) => (
        <Avatar key={`${person.login ?? person.name}:${i}`} person={person} state={person.state} z={shown.length - i + 1} size={size} />
      ))}
      {more > 0 ? (
        <span aria-hidden className="text-foreground ring-background relative -ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--muted-foreground)_22%,var(--background))] px-0.5 text-[8px] font-semibold tabular-nums ring-1">
          +{more}
        </span>
      ) : null}
    </span>
  )
}
