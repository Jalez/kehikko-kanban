import type { TrackerRow } from 'kehikot-module-protocol'

/**
 * Which people's pictures this page may load, the way References draws them (protocol 2.10.0
 * `people`): only from the avatar hosts a tracker uses — GitHub's avatar CDN for GitHub, the GitLab
 * host itself and Gravatar for GitLab — and only once the page has pinned an `img-src` policy naming
 * those hosts. A picture that may not be loaded, or does not load, is the person's initials.
 */

export const GITHUB_AVATARS = 'avatars.githubusercontent.com'
export const GRAVATAR = 'secure.gravatar.com'

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/
const hostOf = (host: string): string | null => {
  const h = host.trim().toLowerCase()
  return HOST.test(h) ? h : null
}

export function avatarHostsFor(tracker: TrackerRow['tracker'], host: string): string[] {
  if (tracker === 'github') return [GITHUB_AVATARS]
  const own = hostOf(host)
  return own ? [own, GRAVATAR] : [GRAVATAR]
}

export function avatarHostsOf(of: ReadonlyArray<{ tracker: TrackerRow['tracker']; host: string }>): string[] {
  return [...new Set(of.flatMap((one) => avatarHostsFor(one.tracker, one.host)))].sort()
}

export function imgSrcPolicy(hosts: readonly string[]): string {
  const named = hosts.map(hostOf).filter((h): h is string => h !== null)
  return ["img-src 'self'", ...named.map((h) => `https://${h}`)].join(' ')
}

let pinned: Set<string> | null = null

/**
 * Pin the page's image policy to these hosts, once: a `<meta>` CSP can only be tightened, so the
 * first reading's hosts are the ones. Returns the hosts pinned.
 */
export function pinImagePolicy(hosts: readonly string[], doc: Document | undefined = globalThis.document): ReadonlySet<string> | null {
  if (pinned || !hosts.length || !doc?.head) return pinned
  const meta = doc.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = imgSrcPolicy(hosts)
  doc.head.appendChild(meta)
  pinned = new Set(hosts.map(hostOf).filter((h): h is string => h !== null))
  return pinned
}

/** For the tests. */
export function unpinImagePolicyForTests(): void {
  pinned = null
}

export function imageLoadable(url: string | null): boolean {
  if (!pinned || !url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && pinned.has(u.host.toLowerCase())
  } catch {
    return false
  }
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const first = [...words[0]!][0]!
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : ''
  return (first + last).toUpperCase()
}

export const FACES_SHOWN = 3
