// E2E driver: register against a running ``openagent serve``, log in,
// drive a GET /api/health through the native loopback proxy.
//
// Usage: TICKET=<oa1...> HANDLE=alice PASSWORD=hunter2 \
//        HOME=/tmp/oa-e2e/home node src/network/__tests__/e2e.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ticket = process.env.TICKET;
const handle = process.env.HANDLE || 'alice';
const password = process.env.PASSWORD || 'hunter2';
if (!ticket) {
  console.error('TICKET env var required');
  process.exit(2);
}
if (!process.env.HOME) {
  console.error('HOME env var required (override to a clean tempdir)');
  process.exit(2);
}

console.log(`HOME=${process.env.HOME} ticket=${ticket.slice(0, 12)}… handle=${handle}`);

const { startNativeLoopback } = await import('../../../dist/network/start.js');

const t0 = Date.now();
const lb = await startNativeLoopback({
  ticket,
  handle,
  password,
});
console.log(`loopback up in ${Date.now() - t0}ms: ${lb.baseUrl}`);
console.log(`agent: handle=${lb.agentHandle} node=${lb.agentNodeId.slice(0, 16)}…`);

try {
  const r = await fetch(`${lb.baseUrl}/api/health`);
  if (!r.ok) {
    throw new Error(`/api/health returned ${r.status} ${r.statusText}`);
  }
  const body = await r.json();
  console.log(`/api/health body:`, JSON.stringify(body));
  assert.equal(body.status, 'ok', `status: ${body.status}`);
  assert.ok(body.agent, `agent: ${body.agent}`);
  assert.ok(body.version, `version: ${body.version}`);
  console.log('e2e: ok');
} finally {
  await lb.stop();
}
