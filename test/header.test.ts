import { describe, expect, test } from 'bun:test'
import { HEADER_MENUS, LIMITS } from 'kehikot-module-protocol'

import { DENSITIES, LABEL_FIT, headerItems, pressed, type HeaderState } from '../src/header.ts'

/*
 * The host draws a container's header in one row, at every width a person
 * drags it to: words at 300 pixels and up, icons under 300, one "⋯" under 220,
 * and pinned runs only at 360 and up. What a module controls is what goes in
 * it, so that is what is held here, at 380, 280 and 200 pixels.
 */
const WIDTHS = [380, 280, 200] as const
const state = (over: Partial<HeaderState> = {}): HeaderState => ({ density: 'comfortable', showDone: true, doneColumn: true, moves: 0, ...over })

describe('the header', () => {
  test('a Cards switch and a Show Done toggle under View, and Put all cards back under Run', () => {
    for (const density of DENSITIES) {
      const items = headerItems(state({ density }))
      expect(items.map((item) => `${HEADER_MENUS[item.kind]}:${item.id}`)).toEqual(['view:density', 'view:done', 'run:reset'])
      expect(items[0]?.kind === 'switch' && items[0].value).toBe(density)
    }
    expect(headerItems(state({ showDone: false }))[1]).toMatchObject({ kind: 'toggle', checked: false })
  })

  test('no Show Done while the settings turn the Done column off', () => {
    expect(headerItems(state({ doneColumn: false })).map((item) => item.id)).toEqual(['density', 'reset'])
  })

  test('Put all cards back says why it cannot run when nothing was moved, and asks for a second press', () => {
    expect(headerItems(state())[2]).toMatchObject({ kind: 'run', confirm: true, disabled: expect.stringContaining('No card') })
    expect(headerItems(state({ moves: 2 }))[2]).toMatchObject({ disabled: null })
  })

  test('fits at 380, 280 and 200 pixels: short labels, and nothing pinned beyond what a narrow header drops', () => {
    for (const width of WIDTHS) {
      const items = headerItems(state({ moves: 1 }))
      const pinned = items.filter((item) => item.kind === 'run' && item.pinned)
      expect(pinned.length).toBeLessThanOrEqual(width >= 360 ? LIMITS.PINNED_MAX : items.length)
      for (const item of items) {
        expect(item.label.length).toBeLessThanOrEqual(LABEL_FIT)
        for (const option of 'options' in item ? item.options : []) expect(option.label.length).toBeLessThanOrEqual(LABEL_FIT)
        if (item.kind === 'run' && item.pinned) expect(item.icon).toBeDefined()
      }
    }
  })

  test('only a harmless item is marked for agents, and never a run', () => {
    for (const item of headerItems(state({ moves: 3 }))) {
      if (item.kind === 'run') expect(item.agents).toBeFalsy()
      if (item.agents) expect(item.kind === 'switch' || item.kind === 'toggle').toBe(true)
    }
  })

  test('a press is a change of view, or a sentence saying why it was not taken', () => {
    expect(pressed('density', 'compact')).toEqual({ density: 'compact' })
    expect(pressed('density', 'tiny')).toContain('not a way')
    expect(pressed('done', false)).toEqual({ showDone: false })
    expect(pressed('done', 'yes')).toContain('on or off')
    expect(pressed('reset', undefined)).toEqual({ reset: true })
    expect(pressed('other', 'all')).toContain('nothing called')
  })
})
