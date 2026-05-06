/**
 * Invite-ticket parser. Wire-compatible with
 * ``openagent/network/ticket.py``:
 *
 *   "oa1" || base32-no-pad-lowercase(CBOR{
 *       v: 1, code, node_id, name, network_id, role, bind_to,
 *       // Optional, added in v0.12.54 to bypass iroh discovery for
 *       // first-contact dials in DMG builds (mDNS often blocked):
 *       relay_url?, addresses?,
 *   })
 *
 * The cbor2 decoder is lenient about map-key order on read, but encode
 * order DOES matter for any signed payload. Tickets aren't signed, so
 * round-trip equivalence is enough here — but we preserve key order
 * anyway to keep the encoded string deterministic across boots.
 *
 * Optional fields are forward-compatible: tickets minted by older
 * servers omit them, and ``decodeTicket`` returns ``undefined`` for
 * those — callers fall back to iroh discovery as before.
 */

import { decode as cborDecode } from 'cbor2';
import { base32 } from 'rfc4648';

export const TICKET_PREFIX = 'oa1';
export const TICKET_VERSION = 1;

export type TicketRole = 'user' | 'device' | 'agent';

export interface InviteTicket {
  code: string;
  coordinatorNodeId: string;
  networkName: string;
  networkId: string;
  role: TicketRole;
  bindTo: string;
  /** Coordinator's home iroh relay URL (optional). When present we feed
   *  it into ``endpoint.connect`` so iroh skips relay discovery. */
  relayUrl?: string;
  /** Coordinator's known direct UDP addresses (optional). When present
   *  we register them via ``net.addNodeAddr`` BEFORE the first dial so
   *  iroh has a direct path to try, bypassing mDNS. */
  addresses?: string[];
}

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketError';
  }
}

export function looksLikeTicket(s: string): boolean {
  return typeof s === 'string' && s.startsWith(TICKET_PREFIX);
}

export function decodeTicket(s: string): InviteTicket {
  if (!looksLikeTicket(s)) {
    throw new TicketError(`not an OpenAgent ticket: ${JSON.stringify(s.slice(0, 8))}`);
  }
  const body = s.slice(TICKET_PREFIX.length).toUpperCase();
  // Python's b32decode wants padding to a multiple of 8.
  const padded = body + '='.repeat((8 - (body.length % 8)) % 8);
  let raw: Uint8Array;
  try {
    raw = base32.parse(padded);
  } catch (e) {
    throw new TicketError(`ticket isn't valid base32: ${(e as Error).message}`);
  }
  let obj: unknown;
  try {
    obj = cborDecode(raw);
  } catch (e) {
    throw new TicketError(`ticket payload isn't valid CBOR: ${(e as Error).message}`);
  }
  if (!obj || typeof obj !== 'object' || obj instanceof Uint8Array || Array.isArray(obj)) {
    throw new TicketError('ticket payload is not a CBOR map');
  }
  const map = obj as Record<string, unknown>;
  if (map.v !== TICKET_VERSION) {
    throw new TicketError(`unsupported ticket version: ${String(map.v)}`);
  }
  for (const key of ['code', 'node_id', 'name', 'network_id'] as const) {
    if (!(key in map)) {
      throw new TicketError(`ticket missing field: ${key}`);
    }
  }
  const relayUrl = typeof map.relay_url === 'string' && map.relay_url.length > 0
    ? map.relay_url
    : undefined;
  const addresses = Array.isArray(map.addresses)
    ? map.addresses.filter((a): a is string => typeof a === 'string' && a.length > 0)
    : undefined;
  return {
    code: String(map.code),
    coordinatorNodeId: String(map.node_id),
    networkName: String(map.name),
    networkId: String(map.network_id),
    role: (map.role ?? 'user') as TicketRole,
    bindTo: String(map.bind_to ?? ''),
    relayUrl,
    addresses: addresses && addresses.length > 0 ? addresses : undefined,
  };
}
