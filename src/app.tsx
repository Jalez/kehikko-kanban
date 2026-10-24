import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { TRACKER_REFRESH_WITHIN_MS, pickedParts, type PressValue } from 'kehikot-module-protocol'
import type { PressAnswer } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useFocus, useServerStanding } from 'kehikot-module-protocol/client/react'

import { HeaderMenus } from '@/components/header-menus'
import { openCard, openerOf } from '@/lib/links'
import { cn } from '@/lib/utils'

import type { Card } from './board/cards.ts'
import { headerItems, pressed } from './header.ts'
import { BoardView, NARROW_PX, useWidth } from './view/board.tsx'
import { useBoard } from './view/use-board.ts'
import { api as realApi, type Api } from './wire/api.ts'
import { missingSaid } from './wire/reading.ts'
import { DEFAULT_VIEW, useKehikot, type Host, type View } from './wire/use-kehikot.ts'

type Press = { item: string; value?: PressValue }

/** Where the host's presses and refreshes reach the screen, which owns the state they change. */
export interface Handlers {
  press: MutableRefObject<((press: Press) => PressAnswer | Promise<PressAnswer>) | null>
  refresh: MutableRefObject<(() => void) | null>
}

export const handlers = (): Handlers => ({ press: { current: null }, refresh: { current: null } })

export function App() {
  const bound = useRef<Handlers>(handlers()).current
  const host = useKehikot({
    onPress: (press) => (bound.press.current ? bound.press.current(press) : 'Kanban is not ready for that yet.'),
    onRefresh: () => bound.refresh.current?.(),
  })
  return <Screen host={host} handlers={bound} />
}

const MOVES_SAID = 'Moves stay on this board, kept in this project: GitHub and GitLab are not changed.'
const KEYS_SAID = 'Alt+arrows move the focused card.'

/**
 * Everything drawn, from a plain `Host`, so a test draws it with a made-up context
 * (test/render.test.tsx). It owns every bit of its state: the view, and the board as last read.
 */
export function Screen({
  host,
  api = realApi,
  handlers: bound = handlers(),
  width: forced,
  now,
}: {
  host: Host
  api?: Api
  handlers?: Handlers
  /** The container's width, for a test; measured otherwise. */
  width?: number
  now?: () => number
}) {
  const server = useServerStanding()
  const [again, setAgain] = useState(0)
  /* The one screen for every not-ready moment: waiting for a host, no host, no project, a stopped server. */
  const cover = coverFor({ ...host, server }, { project: true })

  const [view, setView] = useState<View>(host.kept ?? DEFAULT_VIEW)
  const restored = useRef(host.kept !== null)
  useEffect(() => {
    if (!restored.current && host.kept) {
      restored.current = true
      setView(host.kept)
    }
  }, [host.kept])
  const { remember } = host
  const viewNow = useRef(view)
  viewNow.current = view
  const change = useCallback(
    (next: Partial<View>) => {
      const now = { ...viewNow.current, ...next }
      viewNow.current = now
      setView(now)
      remember(now)
    },
    [remember],
  )

  const board = useBoard(host, api, now)
  const settings = board.kept?.settings
  const doneColumn = settings?.columns.done ?? true

  /* The header: declared whole on every change; the client replays it on every greeting. */
  const items = useMemo(
    () => headerItems({ density: view.density, showDone: view.showDone, doneColumn, moves: board.moves }),
    [view.density, view.showDone, doneColumn, board.moves],
  )
  const { header } = host
  useEffect(() => header(items), [header, items])

  const { resetAll } = board
  const onPress = useCallback(
    (press: Press): PressAnswer | Promise<PressAnswer> => {
      const asked = pressed(press.item, press.value)
      if (typeof asked === 'string') return asked
      if ('density' in asked) return void change({ density: asked.density })
      if ('showDone' in asked) return void change({ showDone: asked.showDone })
      return resetAll()
    },
    [change, resetAll],
  )
  bound.press.current = onPress

  /* The host's refresh control reads the trackers again, for this epic — spending the person's rate limit, on their press only. */
  const { refreshable, request, answers, epic, tracker } = host
  const canRefresh = Boolean(epic) && answers?.includes('tracker.refresh') === true
  useEffect(() => refreshable({ can: canRefresh, at: tracker.at, busy: tracker.refreshing }), [refreshable, canRefresh, tracker.at, tracker.refreshing])
  bound.refresh.current = () => {
    if (canRefresh) void request('tracker.refresh', { epic }, { within: TRACKER_REFRESH_WITHIN_MS }).catch(() => {})
  }

  const opener = openerOf(host)
  const open = useCallback(
    (card: Card) => {
      setHeld(card.ref)
      void openCard(card.url, card.title, opener)
    },
    [opener],
  )

  const [measured, measuredWidth] = useWidth()
  const width = forced ?? measuredWidth
  const narrow = width > 0 && width < NARROW_PX

  /* THE rule for parts: a card is anchored to its refs, every spelling. */
  const focus = useFocus({ parts: host.parts, epic: host.epic, projectPath: host.projectPath })
  const placed = useMemo(() => board.board?.filter((one) => one.shown).flatMap((one) => one.cards) ?? [], [board.board])
  const [held, setHeld] = useState<string | null>(null)
  const { shown, empty } = focus.narrow(placed, (one) => one.card.refs.map((ref) => ({ ref })), { noun: 'card', keep: (one) => one.card.ref === held })
  const shownRefs = useMemo(() => new Set(shown.map((one) => one.card.ref)), [shown])

  const lines = [board.readError, board.said, board.reading ? missingSaid(board.reading.missing) : null, ...(board.reading?.failed ?? []), board.kept?.problem].filter(
    (line): line is string => Boolean(line),
  )

  return (
    <div ref={measured} className="bg-background text-foreground flex h-screen min-w-0 flex-col text-sm">
      {/* Hosted, the host draws the header items in the container's own header. Alone, the page does. */}
      {host.where === 'unhosted' ? (
        <header className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2">
          <span className="text-xs font-medium">Kanban</span>
          <HeaderMenus items={items} onPress={(press) => void onPress(press)} />
        </header>
      ) : null}
      <main className={cn('flex min-h-0 flex-1 flex-col gap-2', narrow ? 'p-2' : 'p-3')}>
        {cover ? (
          <Cover state={cover} name="Kanban" onRetry={() => setAgain((n) => n + 1)} key={again} />
        ) : !host.epic ? (
          <Empty>Open an epic, and its issues, pull requests and merge requests show here as a board.</Empty>
        ) : (
          <>
            {lines.map((line) => (
              <p key={line} className={cn('text-xs', line === board.readError || line === board.said ? 'text-destructive' : 'text-muted-foreground')} data-testid="said">
                {line}
              </p>
            ))}
            {!board.board ? (
              board.readError ? null : <Empty>Reading the epic’s work…</Empty>
            ) : !board.cards.length ? (
              <Empty>This epic names no issue, pull request or merge request yet. Add them to its steps, and they show here.</Empty>
            ) : empty ? (
              <Empty>{empty}</Empty>
            ) : (
              <BoardView
                board={board.board}
                shown={shownRefs}
                density={view.density}
                showDone={view.showDone}
                onShowDone={(showDone) => change({ showDone })}
                narrow={narrow}
                cramped={narrow && width < 340}
                column={view.column}
                onColumn={(column) => change({ column })}
                onOpen={open}
                onMove={board.move}
                onReset={board.reset}
                onHold={(card) => setHeld(card.ref)}
                doneDays={settings?.doneDays ?? 14}
                narrowed={pickedParts(host.parts).length > 0}
              />
            )}
            <p className="text-muted-foreground shrink-0 truncate text-[11px]" title={`${MOVES_SAID} ${KEYS_SAID}`} data-testid="footnote">
              {MOVES_SAID} {narrow ? null : KEYS_SAID}
            </p>
          </>
        )}
      </main>
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground px-1 py-6 text-center text-xs">{children}</p>
}
