/**
 * SRP-6a client wire-compatible with the Python coordinator
 * (``openagent.network.coordinator.pake.Srp6aBackend``), which uses
 * the ``srptools`` Python lib.
 *
 * Wire formats (mirror Srp6aBackend in pake.py):
 *
 *   register payload:    u8(salt_len) || salt || verifier(384)
 *   login_init (ke1):    A(384)                            — left-padded
 *   login_init response: u8(salt_len) || salt || B(384)
 *   login_finish (ke3):  M1(64)   — ASCII-hex of SHA-256 digest
 *   login_finish reply:  M2(64)   — same encoding
 *
 * Critical compatibility quirks (verified by reading srptools' source
 * + windwalker-io/srp's CI test vectors against srptools):
 *
 * - SRP group: NIST 3072-bit prime (RFC 5054 group 4), generator g=5.
 * - Multiplier k = SHA-256(N_padded(384B) || g_padded(384B)).
 * - M1 formula: H( H(N) ⊕ H(g) || H(I) || s || A || B || K )
 *   — NOT the RFC 5054 §2.5.4 formula. ``@windwalker-io/srp`` matches
 *     this by default (``generateClientSessionProof``).
 * - Inside that hash, A and B are passed as bigints which the lib
 *   serialises with ``bigintToUint8`` — strips leading zeros, NOT
 *   N-padded. This is what srptools does and what we need.
 * - The proof on the wire is the **ASCII-hex string of the digest**
 *   encoded as bytes — 64 bytes of '0'-'9'/'a'-'f' representing 32
 *   raw digest bytes. srptools' ``verify_proof`` only accepts that
 *   form. We format M1 the same way.
 * - The salt length is variable; coordinators tolerate 1..64 bytes.
 *   We default to 8 (matches srptools default ``_bits_salt=64``).
 */

import { randomBytes } from 'node:crypto';
import { SRPClient } from '@windwalker-io/srp';

// NIST 3072-bit prime (RFC 5054 group 4) — copied from srptools.constants.PRIME_3072.
// String form is what @windwalker-io/srp's create() accepts (parses as hex).
const PRIME_3072 =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
  '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
  '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' +
  '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' +
  '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' +
  '3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33' +
  'A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864' +
  'D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E2' +
  '08E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

const GENERATOR_5 = '5';

// k = SHA-256(N_padded || g_padded) for the 3072 group with g=5.
// Computed from the Python side (srptools internal ``_mult``); see
// the README in ``app/desktop/src/network/__tests__/`` for derivation.
const K_3072_G5 = '081f4874fa543a371b49a670402fda59ecfab53a1b850fc42e1c357cc846111e';

const VERIFIER_LEN = 384;
const PUB_LEN = 384;
const PROOF_LEN = 64;
const DEFAULT_SALT_LEN = 8;
const MAX_SALT_LEN = 64;

export class SrpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SrpError';
  }
}

/** Left-pad a bigint serialisation to ``totalBytes`` bytes (big-endian). */
function bigintToBytesPadded(value: bigint, totalBytes: number): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  if (hex.length > totalBytes * 2) {
    throw new SrpError(`bigint is ${hex.length / 2} bytes, exceeds target ${totalBytes}`);
  }
  hex = hex.padStart(totalBytes * 2, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Pad an SRP wire bigint (A, B, verifier) to PUB_LEN. */
function padPub(value: bigint): Uint8Array {
  return bigintToBytesPadded(value, PUB_LEN);
}

/** Build a configured @windwalker-io/srp client for the 3072 group. */
function makeClient(): SRPClient {
  const c = SRPClient.create(PRIME_3072, GENERATOR_5, K_3072_G5);
  c.setHasher('sha256');
  // setSize controls the random-secret length for ``a`` and ``b``;
  // srptools uses ``_bits_random = 256`` (32 bytes) by default. Keep
  // that.
  c.setLength(32);
  return c;
}

/** Format an SHA-256 digest bigint as srptools' ASCII-hex-bytes proof. */
function proofToWire(proof: bigint): Uint8Array {
  const hex = proof.toString(16).padStart(PROOF_LEN, '0');
  return new TextEncoder().encode(hex);
}

/** Decode an ASCII-hex proof back to a bigint (for compares). */
function wireToProof(wire: Uint8Array): bigint {
  if (wire.length !== PROOF_LEN) {
    throw new SrpError(`proof must be ${PROOF_LEN} bytes, got ${wire.length}`);
  }
  return BigInt('0x' + new TextDecoder('ascii').decode(wire));
}

// ── Registration ──────────────────────────────────────────────────────

/**
 * Build the SRP-6a registration payload for ``register`` RPC.
 * Returns ``u8(salt_len) || salt || verifier(384)``.
 */
export async function makeRegistrationPayload(
  identity: string,
  password: string,
  saltLenBytes: number = DEFAULT_SALT_LEN,
): Promise<Uint8Array> {
  if (saltLenBytes < 1 || saltLenBytes > MAX_SALT_LEN) {
    throw new SrpError(`salt_len out of range (1..${MAX_SALT_LEN}): ${saltLenBytes}`);
  }
  // Generate salt directly (the lib's ``generateSalt`` defaults to 16
  // bytes; we want 8 to match srptools' default and keep wire bytes
  // identical to a Python-side registration of the same identity).
  const saltBytes = randomBytes(saltLenBytes);
  const saltBig = BigInt('0x' + saltBytes.toString('hex'));

  const c = makeClient();
  const x = await c.generatePasswordHash(saltBig, identity, password);
  const verifier = await c.generateVerifier(x);

  const verifierBytes = bigintToBytesPadded(verifier, VERIFIER_LEN);
  const out = new Uint8Array(1 + saltLenBytes + VERIFIER_LEN);
  out[0] = saltLenBytes;
  out.set(saltBytes, 1);
  out.set(verifierBytes, 1 + saltLenBytes);
  return out;
}

// ── Login ─────────────────────────────────────────────────────────────

/** Mutable state across a two-message login exchange. */
export interface SrpClientLogin {
  identity: string;
  password: string;
  /** Client secret ``a`` (kept across messages so we don't regen). */
  secret: bigint;
  /** Client public ``A`` — the bytes we send to the server in ``ke1``. */
  ke1: Uint8Array;
  /** Set after ``respond`` has run — used by ``verifyServer``. */
  expectedM2?: Uint8Array;
}

/**
 * Begin a login exchange. Returns the state plus the 384-byte ``A``
 * the caller sends to the coordinator's ``login_init`` RPC.
 */
export async function startLogin(identity: string, password: string): Promise<SrpClientLogin> {
  const c = makeClient();
  const secret = await c.generateRandomSecret();
  const A = await c.generatePublic(secret);
  const ke1 = padPub(A);
  return { identity, password, secret, ke1 };
}

/**
 * Process the coordinator's ``u8(salt_len) || salt || B(384)`` reply
 * and return the 64-byte ASCII-hex M1 proof for ``login_finish``.
 *
 * Mutates ``state`` to record the M2 we expect back, so a subsequent
 * ``verifyServer(state, m2)`` can validate the server's proof.
 */
export async function respondLogin(
  state: SrpClientLogin,
  serverResponse: Uint8Array,
): Promise<Uint8Array> {
  if (serverResponse.length < 1) throw new SrpError('login response truncated');
  const saltLen = serverResponse[0];
  if (saltLen < 1 || saltLen > MAX_SALT_LEN) {
    throw new SrpError(`login response unreasonable salt_len: ${saltLen}`);
  }
  const expected = 1 + saltLen + PUB_LEN;
  if (serverResponse.length !== expected) {
    throw new SrpError(
      `login response length mismatch: expected ${expected}, got ${serverResponse.length}`,
    );
  }
  const salt = serverResponse.subarray(1, 1 + saltLen);
  const B = serverResponse.subarray(1 + saltLen);
  const saltBig = BigInt('0x' + Buffer.from(salt).toString('hex'));
  const Bbig = BigInt('0x' + Buffer.from(B).toString('hex'));

  const c = makeClient();
  const x = await c.generatePasswordHash(saltBig, state.identity, state.password);
  // Re-derive the public so we don't need to round-trip through bytes.
  const Abig = await c.generatePublic(state.secret);

  // Manually replicate step2's body so we can extract K + M1 + M2.
  if (Bbig % c.getPrime() === 0n) {
    throw new SrpError('server returned an invalid public ephemeral B');
  }
  const u = await c.generateCommonSecret(Abig, Bbig);
  const preMaster = await c.generatePreMasterSecret(state.secret, Bbig, x, u);
  // Same K as srptools: K = H(S). The lib's hash() returns a bigint,
  // which is the form we want for further hashing.
  const K = await c.hash(preMaster);
  const M1 = await c.generateClientSessionProof(state.identity, saltBig, Abig, Bbig, K);
  const M2 = await c.generateServerSessionProof(Abig, M1, K);

  state.expectedM2 = proofToWire(M2);
  return proofToWire(M1);
}

/** Validate the coordinator's M2 proof against what we expected. */
export function verifyServer(state: SrpClientLogin, m2: Uint8Array): void {
  if (!state.expectedM2) {
    throw new SrpError('verifyServer called before respondLogin');
  }
  if (m2.length !== state.expectedM2.length) {
    throw new SrpError('server proof wrong length');
  }
  for (let i = 0; i < m2.length; i++) {
    if (m2[i] !== state.expectedM2[i]) {
      throw new SrpError('server proof mismatch');
    }
  }
}
