import { useMemo } from 'react'

import { CONTENT_HOST, CONTENT_STEPS, contentStamp, type TrackerSignal } from 'kehikot-module-protocol'
import type { HostEvents } from 'kehikot-module-protocol/client'
import { useHost, type Host as ProtocolHost, type KeptCodec } from 'kehikot-module-protocol/client/react'

import { ID } from '../../manifest.ts'
import { isColumn, type ColumnId } from '../board/columns.ts'
import { DENSITIES, type Density } from '../header.ts'

/**
 * The view a person left the board in, kept by the host for this container (`state.set`, capability
 * `state:keep`): an opaque string to the host, read back here and checked field by field.
 */
export interface View {
  density: Density
  showDone: boolean
  /** The column shown when the container is too narrow for all of them. */
  column: ColumnId | null
}

export const DEFAULT_VIEW: View = { density: 'comfortable', showDone: true, column: null }

export const VIEW_CODEC: KeptCodec<View> = {
  read: (state) => {
    if (!state) return null
    try {
      const raw = JSON.parse(state) as Partial<View> | null
      return {
        density: DENSITIES.includes(raw?.density as Density) ? (raw!.density as Density) : DEFAULT_VIEW.density,
        showDone: typeof raw?.showDone === 'boolean' ? raw.showDone : DEFAULT_VIEW.showDone,
        column: isColumn(raw?.column) ? raw.column : null,
      }
    } catch {
      return null
    }
  },
  write: (view) => JSON.stringify(view),
}

/**
 * What the screen needs from the host: the protocol's `useHost` — which has already put the theme
 * on <html> and flattened the context — with the tracker's signal and the content stamp the board
 * re-reads on. A plain object, so a screen renders in a test without a host.
 */
export interface Host
  extends Pick<
    ProtocolHost<View>,
    'where' | 'project' | 'projectPath' | 'epic' | 'parts' | 'theme' | 'header' | 'request' | 'answers' | 'openAddress' | 'refreshable' | 'remember' | 'kept'
  > {
  /** When the host's tracker reading last changed, and whether a read is in flight. */
  tracker: TrackerSignal
  /** Moves when the epic's own material changes: a ref added to a step. */
  content: string
}

/**
 * Whose changes move the board's content stamp: the host's own material, and an epic's steps. From
 * protocol 2.21.0 a host announces a change by ANY module that keeps steps as `CONTENT_STEPS`, so
 * the board follows whichever does. `kehikot.journeys` stays beside it for a host from before
 * 2.21.0, which announces only the module's own id; it goes when those hosts are gone.
 */
export const CONTENT_SOURCES: readonly string[] = [CONTENT_HOST, CONTENT_STEPS, 'kehikot.journeys']

export function useKehikot(events: HostEvents = {}): Host {
  const host = useHost<View>(ID, events, { kept: VIEW_CODEC })
  const at = host.context?.tracker?.at ?? null
  const refreshing = host.context?.tracker?.refreshing ?? false
  const content = contentStamp(host.context?.content, { sources: [...CONTENT_SOURCES], epic: host.epic })
  const tracker = useMemo(() => ({ at, refreshing }), [at, refreshing])
  return useMemo(() => ({ ...host, tracker, content }), [host, tracker, content])
}
