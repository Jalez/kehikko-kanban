import { trackerRowSchema, type TrackerRow } from 'kehikot-module-protocol'

/**
 * Stand-in tracker rows, in the shape the host hands back from `tracker.get`. Nothing here was read
 * from a tracker: an invented GitHub repository and an invented GitLab project, so a test, the stub
 * host and a scratch host all draw the same board without a forge.
 */

export const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()

const gh = { tracker: 'github', host: 'github.com', repo: 'example-org/demo' } as const
const gl = { tracker: 'gitlab', host: 'gitlab.example.org', repo: 'group/app' } as const
const OCTOCAT = 'https://avatars.githubusercontent.com/u/583231?v=4'

function row(fields: Partial<TrackerRow> & Pick<TrackerRow, 'ref' | 'number' | 'kind' | 'state' | 'title'>): TrackerRow {
  const where = fields.tracker === 'gitlab' ? gl : gh
  const url =
    where.tracker === 'github'
      ? `https://github.com/${where.repo}/${fields.kind === 'change' ? 'pull' : 'issues'}/${fields.number}`
      : `https://${where.host}/${where.repo}/-/${fields.kind === 'change' ? 'merge_requests' : 'issues'}/${fields.number}`
  return trackerRowSchema.parse({ ...where, url, readAt: at(0), createdAt: at(30), updatedAt: at(1), closedAt: null, ...fields })
}

export const ROWS: TrackerRow[] = [
  row({ ref: 'gh#1', number: 1, kind: 'issue', state: 'open', title: 'Sign-in page for the beta', labels: ['web', 'p1'], updatedAt: at(2) }),
  row({
    ref: 'gh#2',
    number: 2,
    kind: 'issue',
    state: 'open',
    title: 'Rate limits on the public API',
    labels: ['api'],
    assignees: ['Mona Lisa'],
    assigneeLogins: ['octocat'],
    people: { octocat: { name: 'Mona Lisa', avatarUrl: OCTOCAT } },
    updatedAt: at(1),
  }),
  row({
    ref: 'gh#3',
    number: 3,
    kind: 'issue',
    state: 'open',
    title: 'Export a board as CSV',
    labels: ['web'],
    links: [{ ref: 'gh#4', relation: 'closed-by' }],
    updatedAt: at(3),
  }),
  row({
    ref: 'gh#4',
    number: 4,
    kind: 'change',
    state: 'open',
    title: 'CSV export',
    draft: false,
    review: 'required',
    reviewers: [{ login: 'hubot', name: 'Hubot', state: 'requested' }],
    assignees: ['Mona Lisa'],
    assigneeLogins: ['octocat'],
    people: { octocat: { name: 'Mona Lisa', avatarUrl: OCTOCAT }, hubot: { name: 'Hubot' } },
    links: [{ ref: 'gh#3', relation: 'closes' }],
    labels: ['web'],
  }),
  row({ ref: 'gh#5', number: 5, kind: 'change', state: 'open', title: 'Try a faster JSON parser', draft: true, labels: ['api', 'spike'], updatedAt: at(4) }),
  row({ ref: 'gh#6', number: 6, kind: 'change', state: 'merged', title: 'Health check endpoint', mergedAt: at(2), closedAt: at(2), review: 'approved', labels: ['api'] }),
  row({ ref: 'gh#7', number: 7, kind: 'issue', state: 'closed', title: 'Old logo in the footer', closedAt: at(40), stateReason: 'COMPLETED' }),
  row({ ref: 'gh#8', number: 8, kind: 'issue', state: 'closed', title: 'Dark mode flicker', closedAt: at(5), stateReason: 'NOT_PLANNED', labels: ['web'] }),
  row({ ref: '#12', tracker: 'gitlab', number: 12, kind: 'issue', state: 'open', title: 'Write the onboarding guide', workItem: 'task', labels: ['docs'] }),
  row({ ref: '!7', tracker: 'gitlab', number: 7, kind: 'change', state: 'open', title: 'Docs site navigation', review: 'approved', labels: ['docs'], updatedAt: at(0.5) }),
]

/** The epic the stand-in names, with three parts, and which refs each part holds. */
export const EPIC = 'launch'
export const PART_REFS: Record<string, string[]> = {
  api: ['gh#2', 'gh#5', 'gh#6'],
  web: ['gh#1', 'gh#3', 'gh#4', 'gh#8'],
  docs: ['#12', '!7'],
}
export const PART_NAMES: Record<string, string> = { api: 'API', web: 'Web app', docs: 'Docs' }
