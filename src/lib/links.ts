import { isWebAddress, type AddressOpenResult } from 'kehikot-module-protocol'

/**
 * How a card is opened: its address handed to the canvas (`address.open`, protocol 2.16.0), so a
 * module there that shows pages opens it — and with none, the host asks the person. With an older
 * host, a declined hand-over or an address the protocol would not take: a new tab, as a link would.
 */
export type OpenAddress = (url: string, options?: { title?: string }) => Promise<AddressOpenResult | null>

export function openerOf(host: { answers?: readonly string[] | null; openAddress?: OpenAddress }): OpenAddress | null {
  const open = host.openAddress
  return open && host.answers?.includes('address.open') === true ? open : null
}

const newTab = (url: string) => void globalThis.window?.open(url, '_blank', 'noopener,noreferrer')

export async function openCard(url: string, title: string, open: OpenAddress | null, fallback: (url: string) => void = newTab): Promise<void> {
  if (!isWebAddress(url)) return
  if (!open) return fallback(url)
  const answer = await open(url, { title: title.slice(0, 200) || undefined }).catch(() => null)
  if (answer === null || answer.outcome === 'declined') fallback(url)
}
