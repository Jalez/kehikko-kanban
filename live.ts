import { existsSync, watch, type FSWatcher } from 'node:fs'

import { events, publish, watching } from 'kehikot-module-protocol/serve'

/**
 * Telling the page that a project's board changed, over one held stream: the page never asks on a
 * clock (protocol 2.32.0, `events`/`subscribe`). What travels is that there IS news; the page reads
 * `/api/board` again, the door it already reads.
 *
 * A change is published where it happens: every write of this module's files (`changed`, from
 * `store.ts` — the page's move, an agent's `move_card`, the host's settings form), and a watcher over
 * the project's `.kehikot/kanban/` while a page follows it, for a file somebody edited by hand.
 */

export const EVENTS_PATH = '/api/board/events'

/** The news itself. The page re-reads on any event; the first is sent as a stream opens. */
export const NEWS = { changed: true } as const

export const topicOf = (project: string) => `board:${project}`

/* Several writes in one breath (a write, then the watcher seeing it) are one piece of news. */
const SETTLE_MS = 50
const settling = new Map<string, ReturnType<typeof setTimeout>>()

/** Say that `project`'s board changed. Nothing is sent when no page follows it. */
export function changed(project: string | null | undefined): void {
  if (!project || settling.has(project)) return
  if (watching(topicOf(project)) === 0) return
  settling.set(
    project,
    setTimeout(() => {
      settling.delete(project)
      publish(topicOf(project), NEWS)
    }, SETTLE_MS),
  )
}

const watchers = new Map<string, FSWatcher>()

/**
 * Watch `folder` for `project` while a page follows it. A watcher whose topic nobody follows any
 * more is closed at its next event; one for a folder that does not exist yet is not made (the first
 * write through this server publishes by itself).
 */
function watchFolder(project: string, folder: string | null): void {
  if (!folder || watchers.has(project) || !existsSync(folder)) return
  try {
    const watcher = watch(folder, () => {
      if (watching(topicOf(project)) === 0) {
        watcher.close()
        watchers.delete(project)
        return
      }
      changed(project)
    })
    watcher.on('error', () => {
      watcher.close()
      watchers.delete(project)
    })
    watchers.set(project, watcher)
  } catch {
    /* A folder that cannot be watched: writes through this server still publish. */
  }
}

/** Stop every watcher (tests, and a server that stops). */
export function stopWatching(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  for (const timer of settling.values()) clearTimeout(timer)
  settling.clear()
}

/** The doors' `stream` option: `/api/board/events?project=…`. */
export const makeStream = (folderOf: (project: string) => string | null) =>
  events((path, query) => {
    if (path !== EVENTS_PATH) return null
    const project = query.get('project')
    if (!project) return null
    watchFolder(project, folderOf(project))
    return { topic: topicOf(project), initial: NEWS }
  })
