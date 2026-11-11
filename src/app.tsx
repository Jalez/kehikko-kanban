import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { TRACKER_REFRESH_WITHIN_MS, pickedParts, type PressValue } from 'kehikot-module-protocol'
import type { PressAnswer } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useFocus, useServerStanding } from 'kehikot-module-protocol/client/react'

import { HeaderMenus } from '@/components/header-menus'
import { openCard, openerOf } from '@/lib/links'
import { cn } from '@/lib/utils'

import type { Card } from './board/cards.ts'
import { MOVES_SAID, footerItems } from './footer.ts'
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

  /*
   * The view is what the host keeps for this container — this module on this kehikko — read on
   * every render and never copied into state: the same page serves every kehikko, and moving to
   * another one brings that one's view (or the defaults, when it kept none).
   */
  const view: View = host.kept ?? DEFAULT_VIEW
  const { remember, read } = host
  const change = useCallback(
    (next: Partial<View>) => remember({ ...(read().kept ?? DEFAULT_VIEW), ...next }),
    [remember, read],
  )

  const board = useBoard(host, api, now)
  const settings = board.kept?.settings
  const doneColumn = settings?.columns.done ?? true

  /* The header: declared whole on every change; the client replays it on every greeting. */
  const footed = host.where === 'hosted' && host.drawsFooter === true
  const items = useMemo(
    () => headerItems({ density: view.density, showDone: view.showDone, doneColumn, moves: board.moves, footed }),
    [view.density, view.showDone, doneColumn, board.moves, footed],
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

  /*
   * The footer the host draws, when it draws one (2.38.0): the cards in each column, the moves with
   * Put all cards back beside them, a read in flight, and the first note. The page then draws no
   * notes above the board and no line under it. An older host draws no footer, and the page keeps both.
   */
  const footerSaid = footed
    ? JSON.stringify(
        cover || !host.epic
          ? []
          : footerItems({
              columns: (board.board ?? [])
                .filter((one) => one.shown && (one.id !== 'done' || view.showDone))
                .map((one) => ({ id: one.id, name: one.name, count: one.cards.filter((placed) => shownRefs.has(placed.card.ref)).length })),
              moves: board.moves,
              refreshing: host.tracker.refreshing,
              lines,
              trouble: Boolean(board.readError || board.said),
            }),
      )
    : null
  const { footer } = host
  useEffect(() => {
    if (footerSaid) footer?.(JSON.parse(footerSaid))
  }, [footer, footerSaid])

  /* The host's cover is held until the page is drawn (protocol 2.70.0): once the board is read, or the read
     failed, or there is no epic to read, or a cover says why there is nothing to draw. */
  const drawn = cover !== null ? cover !== 'waiting' : !host.epic || board.board !== null || Boolean(board.readError)
  const { ready } = host
  useEffect(() => {
    if (drawn) ready?.()
  }, [drawn, ready])

  return (
    <div data-kehikot-page ref={measured} className="text-foreground flex h-screen min-w-0 flex-col text-sm">
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
            {(footed ? [] : lines).map((line) => (
              <p key={line} className={cn('text-xs', line === board.readError || line === board.said ? 'text-destructive' : 'text-muted-foreground')} data-testid="said">
                {line}
              </p>
            ))}
            {!board.board ? (
              null
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
            {footed ? null : (
              <p className="text-muted-foreground shrink-0 truncate text-[11px]" title={`${MOVES_SAID} ${KEYS_SAID}`} data-testid="footnote">
                {MOVES_SAID} {narrow ? null : KEYS_SAID}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground px-1 py-6 text-center text-xs">{children}</p>
}
