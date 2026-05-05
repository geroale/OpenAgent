# desktop/network port — continuation notes

Goal: replace the `openagent network loopback` Python sidecar that
`app/desktop/src/services/loopback.ts:39` spawns with an in-process
TypeScript client that speaks iroh natively. Drops the binary-resolution
problem the user hit on v0.12.48 (`Error: spawn openagent ENOENT`)
because there is nothing to spawn.

## Status as of last commit

Three commits on `main` (`bf9ec31`, `501bb50`, `e06aa6b`). Foundation
done; wire-compat with the existing Python coordinator is **byte-verified**.

```
app/desktop/src/network/
├── identity.ts            ✓ load/persist 32-byte ed25519 secret, atomic 0600
├── ticket.ts              ✓ oa1 base32 + CBOR decode (test passes vs Py golden)
├── device-cert.ts         ✓ verify cert wire (test passes vs Py issue_cert)
├── srp-client.ts          ✓ register/login wire (test passes vs Py srptools)
├── coordinator-rpc.ts     ✓ 4-byte BE len + CBOR JSON-RPC framing
├── iroh-types.ts          ✓ duck-typed shim around @number0/iroh
└── __tests__/
    ├── ticket.fixture.txt + ticket.test.mjs
    ├── cert.test.mjs
    └── srp.fixture.json + srp.test.mjs
```

Tests run via `npx tsc && node src/network/__tests__/<file>.test.mjs`.
All three currently green.

npm deps already added to `package.json`:
- `@number0/iroh@0.35.0`
- `@noble/ed25519@^3.1.0`
- `@windwalker-io/srp@^1.0.1`
- `cbor2@^2.3.0`
- `rfc4648@^1.5.4`

## What's left

In dependency order — every item below builds on the ones above it.

### 1. `login.ts` (~200 LOC, low risk)

Compose `srp-client` + `coordinator-rpc` + `device-cert` + `iroh-types`
into the three high-level operations the Python `client/login.py`
exposes:

```ts
register(node, ticket, handle, password) → { cert: Uint8Array, certPubkey: Uint8Array }
login(node, coordinatorNodeId, handle, password, devicePubkey) → { cert: Uint8Array }
refreshCert(node, coordinatorNodeId, handle, password, devicePubkey) → Uint8Array
```

Each opens a connection to `coordinatorNodeId` over the
`COORDINATOR_ALPN`, runs the `register` / `login_init` / `login_finish`
RPCs, and returns the cert wire. Verify the cert with
`verifyCert(wire, coordinatorPubkey, { expectedNetworkId })` before
returning. Mirror the Python code path-for-path; the heavy lifting is
already done.

The Python coordinator pubkey is derived from the `coordinator_node_id`
hex (it IS the iroh public key bytes). Confirm that derivation matches
both sides — there's a helper at
`openagent/network/peers.py:coordinator_node_id_to_pubkey_bytes` that
shows the conversion.

### 2. `session-dialer.ts` (~120 LOC, low risk)

Mirror `openagent/network/client/session.py:SessionDialer`. Holds a
mutable `cert_wire` and an iroh `node`; opens authed gateway streams
on `GATEWAY_ALPN`. Each `openGatewayStream(targetNodeId)`:

1. `connection = await endpoint.connect({ nodeId: targetNodeId }, GATEWAY_ALPN)` (cache by NodeId)
2. `bi = await connection.openBi()`
3. `await bi.send.writeAll(u32BE(certLen) || certWire)`
4. return `{ send: bi.send, recv: bi.recv }`

`update_cert(newWire)` swaps the in-flight cert without dropping
existing connections (matches the Python design where cert refresh
mid-session is a no-op until the next stream).

### 3. `loopback-proxy.ts` (~150 LOC, medium risk)

Mirror `openagent/network/client/session.py:LoopbackProxy`. Spin up a
plain Node `net.createServer` on `127.0.0.1:0`, accept TCP
connections, open a fresh iroh gateway stream via the dialer, pump
bytes both ways:

```
local TCP socket ←→ iroh stream
```

Use `socket.pipe(...)` plus a manual reader on the iroh side. Half-
close on EOF (call `send.finish()` once the local socket EOFs). The
**WS upgrade through this byte pump is the highest-risk piece** —
aiohttp on the server side handles the upgrade transparently, and the
proxy is opaque, so it should Just Work, but verify with curl + a
WebSocket client during E2E.

`base_url` returns `http://127.0.0.1:<port>`; `ws_url` returns
`ws://127.0.0.1:<port>/ws`. These are exactly the strings the
existing renderer code expects.

### 4. `network-store.ts` (~150 LOC, low risk)

Port `openagent/network/user_store.py`:

- `~/.openagent/user/networks.toml` — schema-versioned TOML, hand-
  written (TS has plenty of TOML libs; `@iarna/toml` works).
- `~/.openagent/user/certs/<sanitized_network_id>__<handle>.cert` —
  raw cert wire, 0600.
- `~/.openagent/user/identity.key` — the device key (already covered
  by `identity.ts`'s `loadOrCreateIdentity`).

Functions: `loadStore`, `saveStore`, `addOrUpdate`, `find`, `remove`,
`writeCert`, `readCert`. The Python file is short enough to map one
function to one TS function.

### 5. Rewire `services/loopback.ts` (~100 LOC, medium risk)

Replace the subprocess spawn with calls to:

```ts
const proxy = await startNativeLoopback({
  ticket?: string,
  handle?: string, network?: string,
  password: string,
  agent?: string,
});
return proxy.port;  // same return shape the renderer expects
```

Internally, `startNativeLoopback` does:

1. Decode ticket OR look up handle@network from the store.
2. Load-or-create the device identity.
3. Bring up a `Iroh.memory({ secretKey })` node.
4. `register` or `login` against the coordinator → cert.
5. Persist cert + networks.toml entry.
6. Build a `SessionDialer(node, certWire)`.
7. Start a `LoopbackProxy(dialer, gatewayNodeId)`.
8. Return `{ port, stop() }`.

The IPC plumbing (`startLoopback` / `stopLoopback` IPC handlers)
stays — only the `spawn(bin, args)` body is replaced.

### 6. E2E test

```
.venv/bin/python -m openagent.cli serve ./my-agent
# wait for "First-time join — no users registered yet" + ticket
# copy ticket
node -e "
  const { startNativeLoopback } = require('./dist/network/start.js');
  startNativeLoopback({ ticket: '<ticket>', handle: 'alice', password: 'pw' })
    .then(async ({ port }) => {
      const r = await fetch(\`http://127.0.0.1:\${port}/api/health\`);
      console.log(await r.json());
    });
"
```

Expected output: `{ status: "ok", agent: ..., version: "0.12.48", connected_clients: 1 }`.
If that prints, the whole stack works.

For the WebSocket upgrade, repeat with `new WebSocket(\`ws://127.0.0.1:\${port}/ws\`)`
and confirm a frame goes through cleanly.

### 7. Release v0.12.49

Standard `bash scripts/release.sh patch` flow once E2E is green.
After CI publishes, install the new .dmg and confirm the user's
original `Error: spawn openagent ENOENT` is gone.

## Gotchas the next session should remember

1. **CBOR map-key order matters** — the existing test fixtures pin this.
   When *encoding* a cert client-side (we don't, we only verify) or any
   payload that gets signed elsewhere, build the object literal with
   keys in the same order Python's `cbor2.dumps` walks them.

2. **`device_pubkey` MUST be `Uint8Array` in CBOR**, never a string.
   Different CBOR major type → different bytes → signature fails.

3. **SRP M1 is ASCII-hex bytes**, not the raw 32-byte digest. 64 bytes
   of `'0'`-`'9'`/`'a'`-`'f'` literal characters.

4. **`recv.read(buf)` writes into a caller-provided buffer** in
   `@number0/iroh`'s API, returns the count as `bigint | null`. The
   `coordinator-rpc.ts` `readExact` helper already handles this; copy
   that pattern in `loopback-proxy.ts`.

5. **iroh-py 0.35 doesn't support self-dial** (verified during the
   bridge-session work earlier today — that's why we have the InProc
   transport in the *server* code path). The desktop app dialing a
   *remote* coordinator is fine; only co-located self-dial breaks.

6. **`cbor2` npm is ESM-only** and emits a deprecation warning when
   imported from CJS via `require()`. The warning is harmless on Node
   22+ and Electron 28+, but don't waste time chasing it.

## Quick orientation commands

```sh
cd app/desktop
npx tsc                          # compile everything
node src/network/__tests__/ticket.test.mjs
node src/network/__tests__/cert.test.mjs
node src/network/__tests__/srp.test.mjs
```

The Python-side fixture generators live in `/tmp/gen_srp_vectors.py`
(may have been wiped — regen by reading
`app/desktop/src/network/__tests__/srp.test.mjs` for the inputs).
