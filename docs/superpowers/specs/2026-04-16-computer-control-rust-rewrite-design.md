# computer-control MCP: Rust Rewrite

**Date:** 2026-04-16
**Status:** Approved design, pending implementation plan
**Owner:** Alessandro Gerelli

## Problem

OpenAgent bundles a custom `computer-control` MCP (Node + `@nut-tree-fork/nut-js`) as a default built-in for every model. On macOS it has two user-visible bugs that make it unusable:

1. **Screenshots capture the wrong display.** `openagent/mcp/builtins.py:39` forces `DISPLAY=:1` into the MCP's env globally. On macOS this routes nut-js through XQuartz's virtual display (1344×896), not the real screen (e.g. 3840×2560). The returned screenshot is always the same X virtual frame, never reflecting what the user sees. `openagent/mcp/servers/computer-control/src/tools/computer.ts:86` reinforces the leak in the xdotool path.
2. **Constant macOS Accessibility/Screen Recording permission prompts.** The `node` binary's identity changes on every `npm install` or node version bump, and macOS TCC keys grants on the binary's code signature. Every rebuild wipes the grant, so the agent hits a permission wall mid-task.

Anthropic's own `computer-use` tool doesn't have either problem: it uses native macOS APIs (CGEvent/AX/CGWindowListCreateImage) wrapped in a **signed, stable-identity binary**. TCC remembers the grant because the bundle ID doesn't change between updates.

## Goal

Keep one `computer-control` MCP that works identically across Linux, Windows, and macOS, for every model provider (Claude, Agno, …), with zero TCC re-prompts after the first grant. "Less code, more maintainable" — no second implementation to route to at runtime.

## Non-goals

- **Evolving the tool surface.** The action enum and coordinate-scaling behavior stay byte-identical to today's Node MCP. API cleanup is deferred to a future v2.
- **Expanded platform matrix.** Only the three targets already in `release.yml` are in scope: darwin-arm64, linux-x64, windows-x64. No darwin-x64 (Intel Mac), no linux-arm64 day 1.
- **Replacing other Node MCPs.** `shell`, `editor`, `web-search`, `chrome-devtools`, `messaging` stay on Node. This rewrite is scoped to `computer-control` only.

## Approach

Replace the content of `openagent/mcp/servers/computer-control/` with a Rust crate that compiles to a native, signed, per-platform binary. The binary speaks MCP JSON-RPC over stdio just like the current Node server. The directory name stays the same so `builtins.py`'s registry key (`computer-control`) is unchanged — only the `command` changes from `["node", "dist/main.js"]` to the resolved path of the native binary for the current host.

## Architecture

### 1. Directory layout after the rewrite

```
openagent/mcp/servers/computer-control/
├── Cargo.toml
├── Cargo.lock
├── src/
│   ├── main.rs                 # tokio runtime, MCP server registration
│   ├── server.rs               # MCP tool registration via rmcp
│   └── tools/
│       ├── mod.rs
│       ├── computer.rs         # the single `computer` tool
│       ├── input.rs            # enigo-backed input actions
│       ├── capture.rs          # xcap + screencapture fallback
│       └── scaling.rs          # coordinate-scaling math (ported from TS)
├── bin/
│   ├── darwin-arm64/openagent-computer-control
│   ├── linux-x64/openagent-computer-control
│   └── windows-x64/openagent-computer-control.exe
└── README.md
```

**Deleted in the same commit:** `src/*.ts`, `src/tools/*.ts`, `src/utils/*.ts`, `src/xdotoolStringToKeys.ts`, `package.json`, `package-lock.json`, `node_modules/`, `dist/`, `tsconfig.json`.

### 2. Rust dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `rmcp` | latest | Official Rust MCP SDK. Handles JSON-RPC, schema, stdio transport. |
| `enigo` | 0.5+ | Cross-platform mouse + keyboard. macOS: AX + CGEvent. Linux: XTest/libxdo. Windows: SendInput. |
| `xcap` | 0.7+ | Cross-platform screen capture. macOS: CGWindow. Linux: X11 + Wayland. Windows: DXGI. |
| `image` | 0.25+ | PNG encode/decode. |
| `fast_image_resize` | 5+ | Downsampling to API limits (replaces the sharp-based path in TS). |
| `serde`, `serde_json` | latest | JSON serialization. |
| `tokio` | 1+ | Async runtime (required by `rmcp`). |

**macOS safety net for capture.** If `xcap` fails at runtime (same CGDisplay API regression the current fallback guards against), shell out to the system `screencapture -x <tmpfile>` binary, read the PNG, clean up. Mirrors the current TS fallback at `src/tools/computer.ts:25-43`.

### 3. Tool surface — exact drop-in

One tool named `computer` with the same shape as today's registration in `src/tools/computer.ts:172-182`:

- **Action enum** (identical): `key`, `type`, `mouse_move`, `left_click`, `left_click_drag`, `right_click`, `middle_click`, `double_click`, `scroll`, `get_screenshot`, `get_cursor_position`
- **Input schema**: `{ action, coordinate?: [x, y], text?: string }`
- **Screenshot behavior**: downsample to ≤1568px long edge and ≤1.15MP, return PNG + report `display_width_px` / `display_height_px` as the **downsampled** dimensions (matching the current workaround for Claude's autoscaling)
- **Scroll syntax**: `text: "down:500"` still means 500px down. String-parsed identically.
- **Coordinate scaling**: `scale = logical_size / api_image_size`, applied on every coordinate-bearing action. Identical math to `getApiToLogicalScale()` in `src/tools/computer.ts:118-123`.

The tool description strings (including the crosshair instructions at lines 153-165) are copied verbatim — these shape Claude's prompting and we don't want to retrain the model on new wording.

### 4. `builtins.py` change

The spec at `openagent/mcp/builtins.py:34-40` becomes:

```python
"computer-control": {
    "dir": "computer-control",
    "command": [_resolve_computer_control_binary()],
    # No DISPLAY env. The binary selects the right backend per OS.
},
```

`_resolve_computer_control_binary()` is a new helper that:
1. Determines the host target triple (`darwin-arm64`, `linux-x64`, `windows-x64`)
2. Returns `BUILTIN_MCPS_DIR / "computer-control" / "bin" / <target> / "openagent-computer-control"` (+ `.exe` on Windows)
3. Raises a clear `FileNotFoundError` if the binary is missing, with instructions to run `scripts/build-computer-control.sh`

The existing `install` / `build` machinery in `resolve_builtin_entry` (lines 205-213) is skipped for this entry because `"install"` and `"build"` aren't set — the binary is prebuilt.

For dev ergonomics, if the binary is missing and a `Cargo.toml` exists alongside, `builtins.py` auto-runs `cargo build --release` and copies the artifact into `bin/<target>/` (mirrors the current "auto `npm install` on first use" behavior for Node MCPs).

### 5. Build pipeline

A new GitHub Actions job is added to `.github/workflows/release.yml`, running **before** the existing `executable` job (which the `needs:` wire-up enforces):

```yaml
computer-control-binary:
  strategy:
    fail-fast: false
    matrix:
      include:
        - os: macos-latest
          target: aarch64-apple-darwin
          out_dir: darwin-arm64
        - os: ubuntu-latest
          target: x86_64-unknown-linux-gnu
          out_dir: linux-x64
        - os: windows-latest
          target: x86_64-pc-windows-msvc
          out_dir: windows-x64
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: ${{ matrix.target }}
    - name: Install Linux build deps
      if: runner.os == 'Linux'
      run: sudo apt-get update && sudo apt-get install -y libxdo-dev libx11-dev libxtst-dev libxi-dev
    - name: Build release binary
      working-directory: openagent/mcp/servers/computer-control
      run: cargo build --release --target ${{ matrix.target }}
    - uses: actions/upload-artifact@v4
      with:
        name: computer-control-${{ matrix.out_dir }}
        path: openagent/mcp/servers/computer-control/target/${{ matrix.target }}/release/openagent-computer-control*
```

The `executable` job gains a new step before `pyinstaller`:

```yaml
- uses: actions/download-artifact@v4
  with:
    pattern: computer-control-*
    path: artifacts/
- name: Stage native binaries
  shell: bash
  run: |
    for d in artifacts/computer-control-*; do
      target=${d#artifacts/computer-control-}
      mkdir -p openagent/mcp/servers/computer-control/bin/$target
      cp $d/openagent-computer-control* openagent/mcp/servers/computer-control/bin/$target/
      chmod +x openagent/mcp/servers/computer-control/bin/$target/openagent-computer-control*
    done
```

The `executable` job's dependency list adds `computer-control-binary` (via `needs:`) so staging always has artifacts to pull.

The existing "Build Node MCPs" step at `release.yml:101-109` has its `computer-control` entry removed from the loop — still builds the other Node MCPs.

### 6. Signing and notarization

`scripts/sign-notarize-macos.sh` signs only the outer onefile binary (no `--deep`, no recursion into PyInstaller's data section). For TCC to remember the Accessibility/Screen Recording grants on the Rust binary across updates, **the Rust binary must be signed independently** before PyInstaller embeds it.

The CI `computer-control-binary` job (macOS runner only) signs the Rust binary in-place after `cargo build`, using:

```bash
codesign --force \
  --sign "Developer ID Application: ..." \
  --identifier com.openagent.computer-control \
  --options runtime \
  --timestamp \
  --entitlements buildResources/entitlements.mac.plist \
  <binary>
```

The `--identifier com.openagent.computer-control` flag is the key to TCC persistence: macOS TCC keys grants by the Designated Requirement, which includes this identifier + the signing team. As long as both stay the same across releases, a user who grants permission once never sees the prompt again — the property that makes Anthropic's computer-use feel "native."

`--options runtime` is mandatory because the outer `openagent` binary is signed with hardened runtime, and Apple's notarization rejects nested non-hardened Mach-O code inside hardened binaries. We reuse the existing `buildResources/entitlements.mac.plist` (its `disable-library-validation` permission is harmless for a statically linked Rust binary and keeps the entitlement surface identical to the outer binary).

After the inner binary is signed and embedded by PyInstaller, `sign-notarize-macos.sh` signs + notarizes the outer binary as it does today, with no changes to the script itself. The outer signature covers the now-signed inner binary bit-for-bit; any later modification would invalidate both.

The inner binary does not need separate notarization: it's not launched directly by Gatekeeper (the user runs the outer binary), so its stapled notarization ticket is unnecessary. Signing alone is sufficient for TCC.

### 7. macOS permissions UX

First-run prompts are unavoidable the first time on a given machine:
- **Accessibility** (Privacy & Security → Accessibility) — required by `enigo` for synthesizing input events
- **Screen Recording** (Privacy & Security → Screen Recording) — required by `xcap` and `screencapture` to capture non-black frames of other apps

The Rust binary wraps every capture/input call in a permission check. On `TCC denied`, the tool returns a structured error result (not a stdout-level failure) with the human-readable message `"macOS Accessibility permission required. Open System Settings → Privacy & Security → Accessibility and enable 'openagent'."` (analogous message for Screen Recording.) The agent sees this text in the tool result and can relay it verbatim to the user.

On subsequent runs, grants persist as long as the binary's signing identity is preserved — which it is, because each release goes through the same notarization pipeline.

### 8. Local dev workflow

`scripts/build-computer-control.sh` (new, pure bash — no Node dependency in this subsystem):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../openagent/mcp/servers/computer-control"
TARGET=$(rustc -vV | sed -n 's|host: ||p')
case "$TARGET" in
  aarch64-apple-darwin)      OUT=darwin-arm64 ;;
  x86_64-unknown-linux-gnu)  OUT=linux-x64 ;;
  x86_64-pc-windows-msvc)    OUT=windows-x64 ;;
  *) echo "Unsupported host target: $TARGET" >&2; exit 1 ;;
esac
cargo build --release --target "$TARGET"
mkdir -p "bin/$OUT"
cp "target/$TARGET/release/openagent-computer-control"* "bin/$OUT/"
```

`scripts/build-executable.sh` is updated to invoke `build-computer-control.sh` before `pyinstaller`, and no longer tries to `npm install && npm run build` the `computer-control` directory.

Developers without Rust installed get a clear error from `_resolve_computer_control_binary()` pointing them to install `rustup` and re-run the script.

### 9. Testing

**Unit tests (in Rust):**
- `scaling.rs`: coordinate round-tripping (logical → API → logical) preserves within 1 px for every display size in `{1920×1080, 2560×1440, 3840×2160, 3840×2560}`
- Scroll syntax parser: `"down"`, `"down:500"`, `"up:1"`, invalid strings
- Downsampler produces an image with `max(w, h) ≤ 1568` and `w*h ≤ 1.15 * 1024 * 1024`

**Integration smoke tests (per platform in CI):**
- Launch the binary, open an MCP stdio session via `rmcp`, call `computer get_screenshot`, assert:
  - Return is valid PNG
  - Reported `display_width_px` matches the downsampled image width (not 1344 / not the X virtual display)
- `computer get_cursor_position` returns two numbers within the display bounds

**Manual verification (macOS, one-time):**
- Grant Accessibility + Screen Recording
- Capture screenshot, confirm it reflects the real desktop
- Rebuild + reinstall the `dist/openagent` onefile, confirm **no re-prompt** on the next run — this is the central UX claim of the rewrite and must be verified by hand

### 10. Rollout

Single merge to `main`, versioned as v0.6.0:

1. Rust crate scaffolded and builds on all three targets
2. CI produces signed + notarized binaries as release artifacts
3. `executable` job bundles them via PyInstaller
4. `builtins.py` switched to the native-binary command
5. Node implementation deleted in the same commit
6. `release.yml`'s Node-MCP build loop updated to skip `computer-control`

No feature flag, no dual-path period. The new behavior is strictly better on macOS and identical on Linux/Windows, so there's no value in running them side-by-side.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `xcap` regressions on newer macOS versions (same class of bug as the nut-js CGDisplay failure) | Medium | Ship the `screencapture -x` fallback from day 1 |
| `enigo` has a behavior difference vs nut-js for some keyboard layouts | Medium | Copy the xdotool-based reference behavior from `xdotoolStringToKeys.ts` into a Rust test vector; ensure `enigo` passes it |
| Wayland-only Linux setups (no X11) can't be captured by `xcap` | Low for target users | Document as known limitation; xcap supports portal-based capture but may prompt — acceptable v1 |
| Apple Developer cert rotation invalidates existing TCC grants | Low (rare event) | Same risk as today's app/CLI binaries, user already accepts it |
| Binary size inflates `dist/openagent` onefile noticeably | Low | Rust release binaries with `strip = true` and `lto = true` land around 5–8 MB per platform; a single platform's binary ships per onefile |

## Open questions

None blocking. Expected to surface during implementation:
- Exact `rmcp` API shape for multi-content-type tool responses (screenshot returns image + text)
- Whether to gate Wayland support behind a feature flag

## References

- Current Node implementation: `openagent/mcp/servers/computer-control/src/tools/computer.ts`
- MCP registry: `openagent/mcp/builtins.py`
- Release workflow: `.github/workflows/release.yml`
- macOS signing helper: `scripts/sign-notarize-macos.sh`
- Anthropic's computer-use design (external): https://docs.anthropic.com/en/docs/build-with-claude/computer-use
