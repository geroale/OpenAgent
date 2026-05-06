#!/usr/bin/env node
// Post-tsc bundling step. Resolves the ERR_REQUIRE_ESM crash by
// inlining pure-ESM deps (@noble/ed25519, cbor2) into a single CJS
// bundle that Electron's main process can require() at startup.
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

// Externals = deps we DON'T want bundled:
//   electron          built into Electron, never bundled
//   electron-updater  uses asar-aware paths at runtime
//   electron-store    relies on app.getPath() at runtime
//   @number0/iroh     native .node binary, can't be bundled
const externals = [
  'electron',
  'electron-updater',
  'electron-store',
  '@number0/iroh',
];

function bundle(entry) {
  esbuild.buildSync({
    entryPoints: [entry],
    outfile: entry,
    allowOverwrite: true,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: externals,
    sourcemap: 'inline',
    logLevel: 'info',
  });
}

const dist = path.resolve(__dirname, '..', 'dist');
bundle(path.join(dist, 'main.js'));
bundle(path.join(dist, 'preload.js'));

// Guard: fail loudly if either ESM-only dep wasn't actually inlined.
const mainJs = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
const offenders = [/require\(["']@noble\/ed25519["']\)/, /require\(["']cbor2["']\)/];
for (const re of offenders) {
  if (re.test(mainJs)) {
    console.error(`bundle still contains ${re} — would ship a broken DMG`);
    process.exit(1);
  }
}
