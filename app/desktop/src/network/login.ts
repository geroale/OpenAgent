/**
 * Coordinator login orchestrator. Mirrors
 * ``openagent/network/client/login.py`` byte-for-byte: opens one
 * coordinator stream per RPC, runs SRP-6a register/login_init/login_finish,
 * and returns the verified cert.
 *
 * Each RPC opens its own iroh connection — matches the Python flow,
 * keeps connection pooling out of this layer (the gateway-side dialer
 * pools, not the coordinator side). Connection close is sync in
 * ``@number0/iroh`` 0.35, same as iroh-py.
 */
import {
  startLogin,
  respondLogin,
  verifyServer,
  makeRegistrationPayload,
  SrpError,
} from './srp-client.js';
import { rpcCall, COORDINATOR_ALPN, RpcError } from './coordinator-rpc.js';
import { dialWithTimeout, DialTimeoutError } from './dial-helpers.js';
import { verifyCert, CertVerificationError } from './device-cert.js';
import type { DeviceCert } from './device-cert.js';
import type { IrohEndpoint, IrohNodeAddr } from './iroh-types.js';

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

export interface LoginParams {
  endpoint: IrohEndpoint;
  coordinatorNodeId: string;
  /** Raw 32-byte ed25519 pubkey of the coordinator (derived from coordinatorNodeId). */
  coordinatorPubkey: Uint8Array;
  handle: string;
  password: string;
  /** Raw 32-byte ed25519 public key of this device. */
  devicePubkey: Uint8Array;
  /** When set, requires the issued cert to claim this network_id. */
  networkId?: string;
  /** Optional invite code (used when pairing a new device on the same handle). */
  inviteCode?: string;
  /** Optional human label for this device on the coordinator. */
  label?: string;
  /** Optional address hint (relay URL + direct addresses) for the
   *  coordinator. When set, iroh skips discovery on the dial — required
   *  for first-contact in DMG builds where mDNS may be blocked. */
  coordinatorAddr?: IrohNodeAddr;
}

export interface RegisterParams extends LoginParams {
  inviteCode: string; // mandatory for first registration
}

export interface LoginResult {
  certWire: Uint8Array;
  cert: DeviceCert;
}

function coordinatorAddr(params: { coordinatorNodeId: string; coordinatorAddr?: IrohNodeAddr }): IrohNodeAddr {
  // Caller-supplied hint wins; otherwise iroh has to discover the addr.
  return params.coordinatorAddr ?? { nodeId: params.coordinatorNodeId };
}

async function dialCoordinator(
  endpoint: IrohEndpoint,
  addr: IrohNodeAddr,
  step: string,
) {
  try {
    return await dialWithTimeout(endpoint, addr, COORDINATOR_ALPN);
  } catch (e) {
    if (e instanceof DialTimeoutError) {
      throw new LoginError(
        `${step}: coordinator unreachable (timed out after ${e.timeoutMs}ms). ` +
        `If the server is on this same machine, allow Local Network access for ` +
        `OpenAgent in System Settings → Privacy & Security.`,
      );
    }
    throw e;
  }
}

/**
 * Register a brand-new ``handle@network`` and return the cert.
 *
 * Two RPCs: ``register`` (creates the row + verifier) then
 * ``login_init`` + ``login_finish`` (proves we hold the password and
 * pairs our device). Returns the cert from the login round-trip.
 */
export async function register(params: RegisterParams): Promise<LoginResult> {
  const { endpoint, handle, password, inviteCode } = params;
  const pakeRecord = await makeRegistrationPayload(handle, password);
  const conn = await dialCoordinator(endpoint, coordinatorAddr(params), 'register');
  try {
    await rpcCall(conn, 'register', {
      invite: inviteCode,
      handle,
      pake_record: pakeRecord,
    });
  } catch (e) {
    if (e instanceof RpcError) {
      throw new LoginError(`register failed: ${e.message}`);
    }
    throw e;
  }
  return await login(params);
}

/**
 * Run an SRP-6a login against the coordinator and return the issued
 * cert wire + parsed cert. Verifies signature against the pinned
 * coordinator pubkey before returning.
 */
export async function login(params: LoginParams): Promise<LoginResult> {
  const {
    endpoint,
    coordinatorPubkey,
    handle,
    password,
    devicePubkey,
    networkId,
    inviteCode,
    label,
  } = params;

  const client = await startLogin(handle, password);

  let initResult: Record<string, unknown>;
  try {
    const initConn = await dialCoordinator(endpoint, coordinatorAddr(params), 'login_init');
    initResult = await rpcCall(initConn, 'login_init', {
      handle,
      ke1: client.ke1,
    });
  } catch (e) {
    if (e instanceof RpcError) {
      throw new LoginError(`login_init failed: ${e.message}`);
    }
    throw e;
  }

  const stateId = initResult.state_id;
  const serverResponseAny = initResult.response;
  if (typeof stateId !== 'string') {
    throw new LoginError(`login_init: state_id is not a string (got ${typeof stateId})`);
  }
  if (!(serverResponseAny instanceof Uint8Array)) {
    throw new LoginError('login_init: response is not bytes');
  }
  const serverResponse = new Uint8Array(serverResponseAny);

  let M1: Uint8Array;
  try {
    M1 = await respondLogin(client, serverResponse);
  } catch (e) {
    if (e instanceof SrpError) {
      throw new LoginError(`SRP respond failed: ${e.message}`);
    }
    throw e;
  }

  const finishParams: Record<string, unknown> = {
    state_id: stateId,
    ke3: M1,
    device_pubkey: devicePubkey,
  };
  if (inviteCode) finishParams.invite = inviteCode;
  if (label) finishParams.label = label;

  let finishResult: Record<string, unknown>;
  try {
    const finishConn = await dialCoordinator(endpoint, coordinatorAddr(params), 'login_finish');
    finishResult = await rpcCall(finishConn, 'login_finish', finishParams);
  } catch (e) {
    if (e instanceof RpcError) {
      throw new LoginError(`login_finish failed: ${e.message}`);
    }
    throw e;
  }

  const certAny = finishResult.cert;
  const m2Any = finishResult.m2;
  if (!(certAny instanceof Uint8Array)) {
    throw new LoginError('login_finish: cert is not bytes');
  }
  if (!(m2Any instanceof Uint8Array)) {
    throw new LoginError('login_finish: m2 is not bytes');
  }
  const certWire = new Uint8Array(certAny);
  const m2 = new Uint8Array(m2Any);

  try {
    verifyServer(client, m2);
  } catch {
    // Non-fatal — matches the Python ``verify_server`` defensive try/except.
    // The cert signature check below is the actual security boundary.
  }

  let cert: DeviceCert;
  try {
    cert = await verifyCert(certWire, coordinatorPubkey, {
      expectedNetworkId: networkId,
    });
  } catch (e) {
    if (e instanceof CertVerificationError) {
      throw new LoginError(`coordinator returned malformed cert: ${e.message}`);
    }
    throw e;
  }

  const expectedHandle = handle.trim().toLowerCase();
  if (cert.handle !== expectedHandle) {
    throw new LoginError(
      `cert handle mismatch (got ${JSON.stringify(cert.handle)}, expected ${JSON.stringify(expectedHandle)})`,
    );
  }
  if (!bytesEqual(cert.devicePubkey, devicePubkey)) {
    throw new LoginError("cert device pubkey doesn't match this device");
  }

  return { certWire, cert };
}

/** Re-run login to get a fresh cert. Same wire as ``login``. */
export async function refreshCert(params: LoginParams): Promise<LoginResult> {
  return await login(params);
}

/** Fetch the coordinator's self-description (used for first-add of a network). */
export async function fetchNetworkInfo(
  endpoint: IrohEndpoint,
  coordinatorNodeId: string,
  coordinatorAddr?: IrohNodeAddr,
): Promise<Record<string, unknown>> {
  const addr: IrohNodeAddr = coordinatorAddr ?? { nodeId: coordinatorNodeId };
  const conn = await dialCoordinator(endpoint, addr, 'network_info');
  return await rpcCall(conn, 'network_info', {});
}

/**
 * Decode an iroh NodeId string to its raw 32-byte ed25519 public key.
 *
 * Iroh NodeIds are an encoded form of the ed25519 public key bytes.
 * iroh-js 0.35 exposes ``PublicKey.fromString(s).toBytes()`` — same
 * API the Python helper uses; ``toBytes`` returns ``Array<number>``.
 */
export async function coordinatorNodeIdToPubkeyBytes(nodeId: string): Promise<Uint8Array> {
  const iroh = await import('@number0/iroh');
  const pk = iroh.PublicKey.fromString(nodeId);
  const raw = pk.toBytes();
  const arr = Uint8Array.from(raw);
  if (arr.length !== 32) {
    throw new LoginError(`coordinator pubkey is not 32 bytes: ${arr.length}`);
  }
  return arr;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
