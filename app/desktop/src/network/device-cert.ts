/**
 * Coordinator-signed device certificate — decode + verify.
 *
 * Wire format (mirrors openagent/network/auth/device_cert.py):
 *
 *   4-byte big-endian payload_len || payload (CBOR map) || 64-byte ed25519 sig
 *
 * The desktop app only verifies certs (the coordinator issues them).
 * We never re-encode a cert client-side, so the byte-exact CBOR
 * encoding rules that bite the server side don't matter here.
 */

import * as ed25519 from '@noble/ed25519';
import { decode as cborDecode } from 'cbor2';

export const CERT_VERSION = 1;
export const SIGNATURE_LEN = 64;
export const LENGTH_PREFIX_LEN = 4;

export class CertVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertVerificationError';
  }
}

export interface DeviceCert {
  handle: string;
  /** 32-byte ed25519 public key. */
  devicePubkey: Uint8Array;
  networkId: string;
  /** Unix epoch seconds (float). */
  issuedAt: number;
  /** Unix epoch seconds (float). */
  expiresAt: number;
  capabilities: string[];
}

export interface VerifyOptions {
  expectedNetworkId?: string;
  /** Override "now" for tests; defaults to ``Date.now()/1000``. */
  now?: number;
}

/**
 * Decode + signature-check + expiry-check a cert wire.
 *
 * The caller provides the coordinator's 32-byte raw ed25519 public
 * key. The cert is valid only if it was signed by that key.
 */
export async function verifyCert(
  wire: Uint8Array,
  coordinatorPubkey: Uint8Array,
  opts: VerifyOptions = {},
): Promise<DeviceCert> {
  if (wire.length < LENGTH_PREFIX_LEN + SIGNATURE_LEN) {
    throw new CertVerificationError('cert too short');
  }
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const payloadLen = view.getUint32(0, false); // big-endian
  if (wire.length !== LENGTH_PREFIX_LEN + payloadLen + SIGNATURE_LEN) {
    throw new CertVerificationError(
      `cert length mismatch: header says ${payloadLen} payload + ${SIGNATURE_LEN} sig, ` +
        `got ${wire.length - LENGTH_PREFIX_LEN} after header`,
    );
  }
  const payload = wire.subarray(LENGTH_PREFIX_LEN, LENGTH_PREFIX_LEN + payloadLen);
  const sig = wire.subarray(LENGTH_PREFIX_LEN + payloadLen);

  let valid = false;
  try {
    valid = await ed25519.verifyAsync(sig, payload, coordinatorPubkey);
  } catch (e) {
    throw new CertVerificationError(`signature verification failed: ${(e as Error).message}`);
  }
  if (!valid) {
    throw new CertVerificationError('invalid coordinator signature');
  }

  const cert = decodeCertPayload(payload);
  const now = opts.now ?? Date.now() / 1000;
  if (now >= cert.expiresAt) {
    throw new CertVerificationError('cert expired');
  }
  if (opts.expectedNetworkId !== undefined && cert.networkId !== opts.expectedNetworkId) {
    throw new CertVerificationError(
      `cert is for network ${JSON.stringify(cert.networkId)}, ` +
        `expected ${JSON.stringify(opts.expectedNetworkId)}`,
    );
  }
  return cert;
}

/**
 * Pure CBOR decode of the payload, no signature check. Useful for
 * inspecting cert contents during debugging — never trust the result
 * for security decisions; use ``verifyCert`` for that.
 */
export function decodeCertPayload(payload: Uint8Array): DeviceCert {
  let obj: unknown;
  try {
    obj = cborDecode(payload);
  } catch (e) {
    throw new CertVerificationError(`cert payload isn't valid CBOR: ${(e as Error).message}`);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj instanceof Uint8Array) {
    throw new CertVerificationError('cert payload is not a CBOR map');
  }
  const map = obj as Record<string, unknown>;
  if (map.v !== CERT_VERSION) {
    throw new CertVerificationError(`unsupported cert version: ${String(map.v)}`);
  }

  const devicePubkey = map.device_pubkey;
  if (!(devicePubkey instanceof Uint8Array)) {
    throw new CertVerificationError(
      'cert payload device_pubkey is not bytes (CBOR major type 2)',
    );
  }
  if (devicePubkey.length !== 32) {
    throw new CertVerificationError(`device_pubkey must be 32 bytes, got ${devicePubkey.length}`);
  }

  const handle = map.handle;
  const networkId = map.network_id;
  const issuedAt = map.issued_at;
  const expiresAt = map.expires_at;
  if (typeof handle !== 'string') throw new CertVerificationError('cert handle missing/invalid');
  if (typeof networkId !== 'string')
    throw new CertVerificationError('cert network_id missing/invalid');
  if (typeof issuedAt !== 'number')
    throw new CertVerificationError('cert issued_at missing/invalid');
  if (typeof expiresAt !== 'number')
    throw new CertVerificationError('cert expires_at missing/invalid');

  let capabilities: string[] = [];
  if (Array.isArray(map.capabilities)) {
    for (const c of map.capabilities) {
      if (typeof c !== 'string') {
        throw new CertVerificationError('cert capabilities contains a non-string entry');
      }
      capabilities.push(c);
    }
  } else if (map.capabilities !== undefined && map.capabilities !== null) {
    throw new CertVerificationError('cert capabilities is not a list');
  }

  return {
    handle,
    devicePubkey: new Uint8Array(devicePubkey),
    networkId,
    issuedAt,
    expiresAt,
    capabilities,
  };
}

/**
 * Split a cert wire into (payload, signature) without parsing the
 * payload. Useful for the gateway-stream prefix when we just want to
 * forward the bytes onward.
 */
export function parseCertFrame(
  wire: Uint8Array,
): { payload: Uint8Array; signature: Uint8Array } {
  if (wire.length < LENGTH_PREFIX_LEN + SIGNATURE_LEN) {
    throw new CertVerificationError('cert too short');
  }
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const payloadLen = view.getUint32(0, false);
  if (wire.length !== LENGTH_PREFIX_LEN + payloadLen + SIGNATURE_LEN) {
    throw new CertVerificationError('cert length mismatch');
  }
  return {
    payload: wire.subarray(LENGTH_PREFIX_LEN, LENGTH_PREFIX_LEN + payloadLen),
    signature: wire.subarray(LENGTH_PREFIX_LEN + payloadLen),
  };
}
