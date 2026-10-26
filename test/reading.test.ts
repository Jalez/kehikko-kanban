import { describe, expect, test } from 'bun:test'

import type { EpicPart } from 'kehikot-module-protocol'

import { cardsOf } from '../src/board/cards.ts'
import { missingSaid, readBoard } from '../src/wire/reading.ts'
import { ROWS } from './fixtures.ts'

const row = (ref: string) => ROWS.find((one) => one.ref === ref)!

/**
 * A host whose epic names these refs; everything else is asked by ref. Records each question. A host
 * before protocol 2.19.0 strips `parts`; a newer one answers the parts' refs too (`partRefs`).
 */
function host(epicRefs: string[], partRefs: string[] | null = null) {
  const asked: Array<Record<string, unknown>> = []
  const request = async (method: string, params: Record<string, unknown> = {}) => {
    expect(method).toBe('tracker.get')
    asked.push(params)
    const refs = params.epic ? [...epicRefs, ...(params.parts === true && partRefs ? partRefs : [])] : (params.refs as string[])
    const rows = ROWS.filter((one) => refs.includes(one.ref))
    return {
      at: params.epic ? '2026-10-24T10:00:00.000Z' : '2026-10-24T11:00:00.000Z',
      refreshing: false,
      sources: [{ tracker: 'github', host: 'github.com', repo: 'example-org/demo', default: true, listed: true, at: null, error: params.epic ? null : 'gh is not logged in.' }],
      rows,
      missing: refs.filter((ref) => !rows.some((one) => one.ref === ref)).map((ref) => ({ ref, reason: ref === 'gh#404' ? 'not-found' : 'pending' })),
    }
  }
  return { request, asked }
}

describe('reading the board from the host', () => {
  test('the epic’s refs, then its parts’ refs the epic does not name, then the changes that close its open issues', async () => {
    const { request, asked } = host(['gh#1', 'gh#3', 'gh#404'])
    const parts: EpicPart[] = [{ id: 'web', heading: 'Web', refs: ['gh#1', 'gh#2', 'gh#9'], picked: false }]
    const read = await readBoard(request, 'launch', parts)
    expect(asked).toEqual([{ epic: 'launch', parts: true }, { refs: ['gh#2', 'gh#9'] }, { refs: ['gh#4'] }])
    expect(read.rows.map((one) => one.ref)).toEqual(['gh#1', 'gh#3', 'gh#2'])
    expect(read.linked.map((one) => one.ref)).toContain('gh#4')
    expect(read.missing).toEqual([
      { ref: 'gh#404', reason: 'not-found' },
      { ref: 'gh#9', reason: 'pending' },
    ])
    expect(read.at).toBe('2026-10-24T11:00:00.000Z')
    expect(read.failed).toEqual(['github.com/example-org/demo: gh is not logged in.'])
    /* The closer is not a card; the issue follows it into review. */
    const cards = cardsOf(read.rows, read.linked)
    expect(cards.map((one) => one.ref)).toEqual(['gh#1', 'gh#3', 'gh#2'])
    expect(cards.find((one) => one.ref === 'gh#3')?.tracked).toBe('review')
  })

  test('nothing more is asked when the epic names everything', async () => {
    const { request, asked } = host(['gh#1', 'gh#2'])
    await readBoard(request, 'launch', [{ id: 'api', heading: 'API', refs: ['gh#2'], picked: true }])
    expect(asked).toEqual([{ epic: 'launch', parts: true }])
    expect(row('gh#1').ref).toBe('gh#1')
  })

  test('a host that answers the parts’ refs with the epic’s is asked nothing more for them; the server, told no parts, gets them too', async () => {
    const { request, asked } = host(['gh#1'], ['gh#2', 'gh#5'])
    const read = await readBoard(request, 'launch', [{ id: 'api', heading: 'API', refs: ['gh#2', 'gh#5'], picked: false }])
    expect(asked).toEqual([{ epic: 'launch', parts: true }])
    expect(read.rows.map((one) => one.ref)).toEqual(['gh#1', 'gh#2', 'gh#5'])
    const fromServer = await readBoard(host(['gh#1'], ['gh#2', 'gh#5']).request, 'launch', [])
    expect(fromServer.rows.map((one) => one.ref)).toEqual(['gh#1', 'gh#2', 'gh#5'])
  })

  test('what is missing is said in one sentence', () => {
    expect(missingSaid([])).toBe('')
    expect(missingSaid([{ ref: 'gh#9', reason: 'pending' }])).toBe('1 item is still being read.')
    expect(
      missingSaid([
        { ref: 'a', reason: 'pending' },
        { ref: 'b', reason: 'pending' },
        { ref: 'c', reason: 'not-found' },
        { ref: 'd', reason: 'no-tracker' },
      ]),
    ).toBe('2 items are still being read, 1 is not on its tracker, 1 names no tracker this project reads.')
  })
})

describe('the changes that are part of an open issue', () => {
  test('are asked for with the ones that close it (protocol 2.26.0)', async () => {
    const asked: Array<Record<string, unknown>> = []
    const issue = { ...row('gh#1'), contributedBy: ['gh#40'] }
    const part = { ...row('gh#4'), ref: 'gh#40', number: 40, contributes: ['gh#1'], links: [] }
    const request = async (_method: string, params: Record<string, unknown> = {}) => {
      asked.push(params)
      const rows = params.epic ? [issue] : [part].filter((one) => (params.refs as string[]).includes(one.ref))
      return { at: null, refreshing: false, sources: [], rows, missing: [] }
    }
    const read = await readBoard(request, 'launch', [])
    expect(asked).toEqual([{ epic: 'launch', parts: true }, { refs: ['gh#40'] }])
    expect(read.rows.map((one) => one.ref)).toEqual(['gh#1'])
    expect(read.linked.map((one) => one.ref)).toEqual(['gh#1', 'gh#40'])
    expect(cardsOf(read.rows, read.linked)[0]!.tracked).toBe('progress')
  })
})
