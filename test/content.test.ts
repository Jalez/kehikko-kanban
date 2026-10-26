import { describe, expect, test } from 'bun:test'
import { CONTENT_HOST, CONTENT_STEPS, contentStamp, type ContentChange } from 'kehikot-module-protocol'

import { CONTENT_SOURCES } from '../src/wire/use-kehikot.ts'

/** The board re-reads when the epic's material moves: the host's, and any module's that keeps its steps (protocol 2.21.0). */
describe('what moves the board', () => {
  const at = (source: string, epic: string | null, when: string): ContentChange => ({ source, epic, at: when })
  const stamp = (content: ContentChange[]) => contentStamp(content, { sources: [...CONTENT_SOURCES], epic: 'share' })

  test('follows the host, any steps provider, and Journeys for a host from before 2.21.0', () => {
    expect(CONTENT_SOURCES).toEqual([CONTENT_HOST, CONTENT_STEPS, 'kehikot.journeys'])
  })

  test('a change a 2.21.0 host announces as CONTENT_STEPS moves the stamp, whichever module made it', () => {
    const before = stamp([])
    expect(stamp([at(CONTENT_STEPS, 'share', '2026-10-26T10:00:00.000Z')])).not.toBe(before)
    /* Another module's own id is not followed: a 2.21.0 host says CONTENT_STEPS beside it. */
    expect(stamp([at('kehikot.planner', 'share', '2026-10-26T10:00:00.000Z')])).toBe(before)
  })

  test('an older host’s Journeys change still moves it; another epic’s does not', () => {
    const before = stamp([])
    expect(stamp([at('kehikot.journeys', 'share', '2026-10-26T10:00:00.000Z')])).not.toBe(before)
    expect(stamp([at(CONTENT_STEPS, 'other', '2026-10-26T10:00:00.000Z')])).toBe(before)
  })
})
