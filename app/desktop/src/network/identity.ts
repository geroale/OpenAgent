/**
 * Per-install device identity — the ed25519 keypair OpenAgent uses to
 * sign device-cert challenges and to derive the iroh NodeId.
 *
 * Mirrors openagent/network/identity.py: the secret is stored as 32
 * raw bytes (no PEM, no encoding), 0600, written atomically through a
 * tempfile + rename in the same directory so a crash mid-write can
 * never leave a corrupt key on disk.
 */

import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ed25519 from '@noble/ed25519';

// noble-ed25519 v3's async API uses ``crypto.subtle.digest`` for
// SHA-512 — no extra hash dependency needed in Electron's main
// process. We only call ``*Async`` methods.

export const SECRET_KEY_LEN = 32;
export const PUBLIC_KEY_LEN = 32;

export interface Identity {
  /** 32 raw bytes — the ed25519 secret seed. */
  readonly secret: Uint8Array;
  /** 32 raw bytes — the matching ed25519 public key. */
  readonly publicKey: Uint8Array;
  /** Lowercase hex of the public key — the iroh NodeId. */
  readonly nodeIdHex: string;
}

export async function generateIdentity(): Promise<Identity> {
  const secret = new Uint8Array(randomBytes(SECRET_KEY_LEN));
  return identityFromSecret(secret);
}

export async function identityFromSecret(secret: Uint8Array): Promise<Identity> {
  if (secret.length !== SECRET_KEY_LEN) {
    throw new Error(`identity secret must be ${SECRET_KEY_LEN} bytes, got ${secret.length}`);
  }
  const publicKey = await ed25519.getPublicKeyAsync(secret);
  const nodeIdHex = Buffer.from(publicKey).toString('hex');
  return { secret, publicKey, nodeIdHex };
}

/**
 * Read an identity from a 32-byte raw file, or generate a fresh one
 * and persist it (0600) atomically if the file is missing. The caller
 * passes the desired path; we mkdir -p its parent.
 */
export async function loadOrCreateIdentity(filePath: string): Promise<Identity> {
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath);
    if (raw.length !== SECRET_KEY_LEN) {
      throw new Error(
        `identity file ${filePath} is ${raw.length} bytes; expected ${SECRET_KEY_LEN}`,
      );
    }
    return identityFromSecret(new Uint8Array(raw));
  }
  const identity = await generateIdentity();
  await persistIdentity(filePath, identity);
  return identity;
}

async function persistIdentity(filePath: string, identity: Identity): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(identity.secret), { mode: 0o600 });
  // chmod again because some umask configurations strip the write mode bits.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, filePath);
}

/**
 * Derive a deterministic short fingerprint for logging. Mirrors what
 * iroh-py prints in its node-id banner — first 12 hex chars of sha256
 * of the public key. NOT cryptographically meaningful on its own.
 */
export function shortFingerprint(publicKey: Uint8Array): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 12);
}
