/**
 * User-side networks file: ``~/.openagent/user/networks.toml`` plus the
 * sibling ``certs/`` dir. Mirrors ``openagent/network/user_store.py``.
 *
 * Schema is versioned — a newer client that bumps the version writes
 * forward-incompatible content; this loader returns an empty store in
 * that case so we don't try to interpret unknown fields.
 *
 * On Windows the ``0o600``/``0o700`` mode bits are no-ops, but the
 * functions still call ``chmod`` for parity with POSIX installs.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parse as tomlParse } from 'smol-toml';

export const SCHEMA_VERSION = 1;

export interface StoredNetwork {
  name: string;
  networkId: string;
  coordinatorNodeId: string;
  /** Lowercase hex of the coordinator's 32-byte ed25519 pubkey. */
  coordinatorPubkeyHex: string;
  handle: string;
  addedAt: number;
  /** Absolute path to the cert file. */
  certPath: string;
  lastLoginAt?: number;
}

export interface NetworkStore {
  networks: StoredNetwork[];
  activeNetwork: string | null;
  activeAgent: string | null;
  schemaVersion: number;
}

export function emptyStore(): NetworkStore {
  return {
    networks: [],
    activeNetwork: null,
    activeAgent: null,
    schemaVersion: SCHEMA_VERSION,
  };
}

export function userDir(): string {
  const p = path.join(os.homedir(), '.openagent', 'user');
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return p;
}

export function storePath(): string {
  return path.join(userDir(), 'networks.toml');
}

export function userIdentityPath(): string {
  return path.join(userDir(), 'identity.key');
}

export function certPathFor(networkId: string, handle: string): string {
  const safe = `${networkId}__${handle}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(userDir(), 'certs', `${safe}.cert`);
}

export function loadStore(): NetworkStore {
  const p = storePath();
  if (!fs.existsSync(p)) {
    return emptyStore();
  }
  const raw = fs.readFileSync(p, 'utf-8');
  let parsed: Record<string, unknown>;
  try {
    parsed = tomlParse(raw) as Record<string, unknown>;
  } catch {
    return emptyStore();
  }
  const schemaVersion = typeof parsed.schema_version === 'number'
    ? parsed.schema_version
    : 0;
  if (schemaVersion > SCHEMA_VERSION) {
    return emptyStore();
  }
  const networks: StoredNetwork[] = [];
  const rawNetworks = Array.isArray(parsed.networks) ? parsed.networks : [];
  for (const n of rawNetworks) {
    if (!n || typeof n !== 'object') continue;
    const m = n as Record<string, unknown>;
    if (
      typeof m.name !== 'string' ||
      typeof m.network_id !== 'string' ||
      typeof m.coordinator_node_id !== 'string' ||
      typeof m.coordinator_pubkey_hex !== 'string' ||
      typeof m.handle !== 'string'
    ) {
      continue;
    }
    networks.push({
      name: m.name,
      networkId: m.network_id,
      coordinatorNodeId: m.coordinator_node_id,
      coordinatorPubkeyHex: m.coordinator_pubkey_hex,
      handle: m.handle,
      addedAt: typeof m.added_at === 'number' ? m.added_at : Date.now() / 1000,
      certPath: typeof m.cert_path === 'string' && m.cert_path.length > 0
        ? m.cert_path
        : certPathFor(m.network_id, m.handle),
      lastLoginAt: typeof m.last_login_at === 'number' ? m.last_login_at : undefined,
    });
  }
  return {
    networks,
    activeNetwork: typeof parsed.active_network === 'string' ? parsed.active_network : null,
    activeAgent: typeof parsed.active_agent === 'string' ? parsed.active_agent : null,
    schemaVersion: schemaVersion || SCHEMA_VERSION,
  };
}

export function saveStore(store: NetworkStore): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const lines: string[] = [];
  lines.push(`schema_version = ${store.schemaVersion}`);
  if (store.activeNetwork) {
    lines.push(`active_network = "${escapeTomlString(store.activeNetwork)}"`);
  }
  if (store.activeAgent) {
    lines.push(`active_agent = "${escapeTomlString(store.activeAgent)}"`);
  }
  for (const n of store.networks) {
    lines.push('');
    lines.push('[[networks]]');
    lines.push(`name = "${escapeTomlString(n.name)}"`);
    lines.push(`network_id = "${escapeTomlString(n.networkId)}"`);
    lines.push(`coordinator_node_id = "${escapeTomlString(n.coordinatorNodeId)}"`);
    lines.push(`coordinator_pubkey_hex = "${escapeTomlString(n.coordinatorPubkeyHex)}"`);
    lines.push(`handle = "${escapeTomlString(n.handle)}"`);
    lines.push(`added_at = ${n.addedAt}`);
    lines.push(`cert_path = "${escapeTomlString(n.certPath)}"`);
    if (n.lastLoginAt !== undefined) {
      lines.push(`last_login_at = ${n.lastLoginAt}`);
    }
  }
  const body = lines.join('\n') + '\n';
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, p);
}

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Idempotent insert/update keyed by ``name``. Returns the stored row. */
export function addOrUpdate(
  store: NetworkStore,
  args: {
    name: string;
    networkId: string;
    coordinatorNodeId: string;
    coordinatorPubkeyHex: string;
    handle: string;
  },
): StoredNetwork {
  for (let i = 0; i < store.networks.length; i++) {
    const existing = store.networks[i];
    if (existing.name === args.name) {
      const updated: StoredNetwork = {
        name: args.name,
        networkId: args.networkId,
        coordinatorNodeId: args.coordinatorNodeId,
        coordinatorPubkeyHex: args.coordinatorPubkeyHex,
        handle: args.handle,
        addedAt: existing.addedAt,
        certPath: certPathFor(args.networkId, args.handle),
        lastLoginAt: existing.lastLoginAt,
      };
      store.networks[i] = updated;
      return updated;
    }
  }
  const row: StoredNetwork = {
    name: args.name,
    networkId: args.networkId,
    coordinatorNodeId: args.coordinatorNodeId,
    coordinatorPubkeyHex: args.coordinatorPubkeyHex,
    handle: args.handle,
    addedAt: Date.now() / 1000,
    certPath: certPathFor(args.networkId, args.handle),
  };
  store.networks.push(row);
  if (store.activeNetwork == null) {
    store.activeNetwork = args.name;
  }
  return row;
}

/** Look up a network by human name OR network_id. */
export function find(store: NetworkStore, nameOrId: string): StoredNetwork | null {
  for (const n of store.networks) {
    if (n.name === nameOrId || n.networkId === nameOrId) {
      return n;
    }
  }
  return null;
}

export function remove(store: NetworkStore, name: string): boolean {
  for (let i = 0; i < store.networks.length; i++) {
    const n = store.networks[i];
    if (n.name === name) {
      store.networks.splice(i, 1);
      try {
        if (fs.existsSync(n.certPath)) fs.unlinkSync(n.certPath);
      } catch {
        // ignore
      }
      if (store.activeNetwork === name) {
        store.activeNetwork = store.networks.length > 0 ? store.networks[0].name : null;
      }
      return true;
    }
  }
  return false;
}

export function writeCert(stored: StoredNetwork, certWire: Uint8Array): void {
  const p = stored.certPath;
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(certWire), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, p);
}

export function readCert(stored: StoredNetwork): Uint8Array | null {
  const p = stored.certPath;
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
