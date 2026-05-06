// Hand-rolled tiny test harness — no jest in this electron app.
// Run with: node src/network/__tests__/dial-helpers.test.mjs (after `npx tsc`).
import assert from 'node:assert/strict';
import { dialWithTimeout, DialTimeoutError } from '../../../dist/network/dial-helpers.js';

const ALPN = new Uint8Array([1, 2, 3]);
const NODE_ID = 'a'.repeat(64);
const ADDR = { nodeId: NODE_ID };

// 1. Resolves on success — the timeout never fires.
{
  const fakeConn = { closed: false, close() { this.closed = true; } };
  const endpoint = {
    connect: async () => fakeConn,
    nodeId: () => 'self',
  };
  const conn = await dialWithTimeout(endpoint, ADDR, ALPN, 100);
  assert.equal(conn, fakeConn, 'dialWithTimeout should resolve to the underlying connection');
  assert.equal(fakeConn.closed, false, 'happy path must not close the conn');
}

// 2. Rejects with DialTimeoutError when the dial hangs past the deadline.
{
  let resolveLate;
  const latePromise = new Promise((r) => { resolveLate = r; });
  const lateConn = { closed: false, close() { this.closed = true; } };
  const endpoint = {
    connect: () => latePromise,
    nodeId: () => 'self',
  };
  let caught;
  try {
    await dialWithTimeout(endpoint, ADDR, ALPN, 30);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof DialTimeoutError, `expected DialTimeoutError, got ${caught}`);
  assert.equal(caught.timeoutMs, 30);

  // Now the underlying dial finally resolves — must self-close so the
  // late connection isn't leaked into iroh state.
  resolveLate(lateConn);
  // Give the .then(c => c.close()) microtask a turn.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(lateConn.closed, true, 'late-arriving connection must auto-close after timeout');
}

// 3. Forwards underlying rejections (bad nodeAddr, peer refused, etc.).
{
  const endpoint = {
    connect: () => Promise.reject(new Error('boom')),
    nodeId: () => 'self',
  };
  let caught;
  try {
    await dialWithTimeout(endpoint, ADDR, ALPN, 100);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, 'boom', 'underlying error must surface unchanged');
  assert.ok(!(caught instanceof DialTimeoutError), 'real errors are not timeouts');
}

console.log('dial-helpers.test: ok');
