import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { avatarHostsOf, imageLoadable, imgSrcPolicy, initialsOf, pinImagePolicy, unpinImagePolicyForTests } from '../src/lib/faces.ts'
import { openCard, openerOf } from '../src/lib/links.ts'

beforeEach(() => unpinImagePolicyForTests())
afterEach(() => unpinImagePolicyForTests())

describe('people’s pictures', () => {
  test('load only from the trackers’ own avatar hosts, once the page has pinned them', () => {
    const hosts = avatarHostsOf([
      { tracker: 'github', host: 'github.com' },
      { tracker: 'gitlab', host: 'gitlab.example.org' },
    ])
    expect(hosts).toEqual(['avatars.githubusercontent.com', 'gitlab.example.org', 'secure.gravatar.com'])
    expect(imgSrcPolicy(hosts)).toBe("img-src 'self' https://avatars.githubusercontent.com https://gitlab.example.org https://secure.gravatar.com")
    expect(imageLoadable('https://avatars.githubusercontent.com/u/1')).toBe(false)
    pinImagePolicy(hosts)
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain('img-src')
    expect(imageLoadable('https://avatars.githubusercontent.com/u/1')).toBe(true)
    expect(imageLoadable('http://avatars.githubusercontent.com/u/1')).toBe(false)
    expect(imageLoadable('https://evil.example/u/1')).toBe(false)
    expect(imageLoadable(null)).toBe(false)
  })

  test('initials stand in for a picture', () => {
    expect(initialsOf('Mona Lisa')).toBe('ML')
    expect(initialsOf('hubot')).toBe('H')
    expect(initialsOf('…')).toBe('?')
  })
})

describe('opening a card', () => {
  test('is handed to the canvas when the host answers address.open, and a new tab when it does not take it', async () => {
    const tabs: string[] = []
    const handed: string[] = []
    const open = openerOf({ answers: ['address.open'], openAddress: async (url) => (handed.push(url), { outcome: 'opened' }) as never })
    await openCard('https://github.com/example-org/demo/issues/1', 'One', open, (url) => void tabs.push(url))
    expect([handed, tabs]).toEqual([['https://github.com/example-org/demo/issues/1'], []])
    const declined = openerOf({ answers: ['address.open'], openAddress: async () => ({ outcome: 'declined', why: 'no' }) as never })
    await openCard('https://github.com/example-org/demo/issues/2', 'Two', declined, (url) => void tabs.push(url))
    expect(openerOf({ answers: [], openAddress: async () => null })).toBeNull()
    await openCard('https://github.com/example-org/demo/issues/3', 'Three', null, (url) => void tabs.push(url))
    await openCard('javascript:alert(1)', 'Never', null, (url) => void tabs.push(url))
    expect(tabs).toEqual(['https://github.com/example-org/demo/issues/2', 'https://github.com/example-org/demo/issues/3'])
  })
})
