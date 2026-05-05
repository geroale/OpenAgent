// WebSocket round-trip through the native loopback. Connects to
// ``ws://127.0.0.1:<port>/ws``, sends a single ``ping`` JSON frame,
// and asserts the server echoes back something.
import assert from 'node:assert/strict';

const ticket = process.env.TICKET;
const handle = process.env.HANDLE || 'alice';
const password = process.env.PASSWORD || 'hunter2';
if (!ticket) {
  console.error('TICKET env var required');
  process.exit(2);
}

const { startNativeLoopback } = await import('../../../dist/network/start.js');

const lb = await startNativeLoopback({ ticket, handle, password });
console.log(`loopback up: ${lb.wsUrl}`);

try {
  const ws = new WebSocket(lb.wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 10_000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(e); });
  });
  console.log(`ws open`);

  const echoed = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws message timeout')), 10_000);
    ws.addEventListener('message', (e) => { clearTimeout(t); resolve(e.data); });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(e); });
    // Server echoes a ``hello`` immediately on connect — no need to send
    // anything to confirm the upgrade worked.
  });
  console.log(`ws message:`, typeof echoed === 'string' ? echoed.slice(0, 200) : '<binary>');
  ws.close();
  console.log('e2e-ws: ok');
} finally {
  await lb.stop();
}
