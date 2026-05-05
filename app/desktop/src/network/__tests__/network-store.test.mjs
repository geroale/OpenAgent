// Round-trip the network-store through a tempdir and assert
// load/save/add/find/remove all behave like the Python user_store.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Override HOME so the store writes into a tempdir. On POSIX,
// os.homedir() reads $HOME on each call so this is enough.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-store-'));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp; // for Windows-style lookups, harmless on POSIX

const ns = await import('../../../dist/network/network-store.js');

const store = ns.emptyStore();
assert.equal(store.networks.length, 0);
assert.equal(store.activeNetwork, null);

const row = ns.addOrUpdate(store, {
  name: 'home',
  networkId: 'net-uuid-1',
  coordinatorNodeId: 'pkx9...node',
  coordinatorPubkeyHex: 'aa'.repeat(32),
  handle: 'alice',
});
assert.equal(row.name, 'home');
assert.equal(row.handle, 'alice');
assert.equal(store.networks.length, 1);
assert.equal(store.activeNetwork, 'home');

// find by name
const fByName = ns.find(store, 'home');
assert.ok(fByName);
assert.equal(fByName.networkId, 'net-uuid-1');

// find by network id
const fById = ns.find(store, 'net-uuid-1');
assert.ok(fById);
assert.equal(fById.name, 'home');

// not found
assert.equal(ns.find(store, 'nope'), null);

// save + reload
ns.saveStore(store);
const reloaded = ns.loadStore();
assert.equal(reloaded.networks.length, 1);
assert.equal(reloaded.networks[0].name, 'home');
assert.equal(reloaded.networks[0].networkId, 'net-uuid-1');
assert.equal(reloaded.networks[0].handle, 'alice');
assert.equal(reloaded.activeNetwork, 'home');

// cert round-trip
const certBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
ns.writeCert(reloaded.networks[0], certBytes);
const loadedCert = ns.readCert(reloaded.networks[0]);
assert.ok(loadedCert);
assert.equal(loadedCert.length, certBytes.length);
for (let i = 0; i < certBytes.length; i++) assert.equal(loadedCert[i], certBytes[i]);

// removal also unlinks the cert
const certBefore = reloaded.networks[0].certPath;
assert.equal(fs.existsSync(certBefore), true);
const ok = ns.remove(reloaded, 'home');
assert.equal(ok, true);
assert.equal(reloaded.networks.length, 0);
assert.equal(reloaded.activeNetwork, null);
assert.equal(fs.existsSync(certBefore), false);

// idempotent update keeps addedAt and bumps the rest
const s2 = ns.emptyStore();
const r1 = ns.addOrUpdate(s2, {
  name: 'home',
  networkId: 'net1',
  coordinatorNodeId: 'n1',
  coordinatorPubkeyHex: 'aa'.repeat(32),
  handle: 'alice',
});
const addedAt = r1.addedAt;
const r2 = ns.addOrUpdate(s2, {
  name: 'home',
  networkId: 'net2',
  coordinatorNodeId: 'n2',
  coordinatorPubkeyHex: 'bb'.repeat(32),
  handle: 'bob',
});
assert.equal(s2.networks.length, 1);
assert.equal(r2.addedAt, addedAt, 'addedAt preserved on update');
assert.equal(r2.networkId, 'net2');
assert.equal(r2.handle, 'bob');

// schema-version bump returns empty
fs.writeFileSync(ns.storePath(), 'schema_version = 999\n', 'utf-8');
const future = ns.loadStore();
assert.equal(future.networks.length, 0);

// cleanup
fs.rmSync(tmp, { recursive: true, force: true });

console.log('network-store.test: ok');
