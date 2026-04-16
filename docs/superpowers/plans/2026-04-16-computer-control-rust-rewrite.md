# computer-control MCP: Rust Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node/nut-js `computer-control` MCP with a signed native Rust binary per platform that exposes a byte-identical tool surface, fixes macOS screenshot-wrong-display and TCC re-prompt bugs, and ships through the existing PyInstaller onefile pipeline.

**Architecture:** Single Rust crate at `openagent/mcp/servers/computer-control/` compiles to per-platform binaries in `bin/<target>/openagent-computer-control[.exe]`. CI matrix (darwin-arm64, linux-x64, windows-x64) produces artifacts that the `executable` PyInstaller job pulls in before bundling. `builtins.py` resolves the per-host binary at runtime; no Node in the loop.

**Tech Stack:** Rust 1.75+, `rmcp` (MCP stdio SDK), `enigo` (cross-platform input), `xcap` (screen capture), `image` + `fast_image_resize` (PNG + downsampling), `tokio`, `serde`. Build via `cargo` in GitHub Actions, bundled by PyInstaller, signed by existing `scripts/sign-notarize-macos.sh`.

**Design spec:** [docs/superpowers/specs/2026-04-16-computer-control-rust-rewrite-design.md](../specs/2026-04-16-computer-control-rust-rewrite-design.md)

---

## Pre-flight

### Task 0: Create isolation branch

**Files:** none yet — just git.

- [ ] **Step 1: Create a feature branch off `main`**

```bash
git checkout -b rust-computer-control
```

- [ ] **Step 2: Confirm Rust toolchain is available**

Run: `rustc --version && cargo --version`
Expected: both print versions (1.75+). If not installed: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` then `rustup default stable`.

- [ ] **Step 3: Confirm the three Rust targets are installed**

Run:
```bash
rustup target add aarch64-apple-darwin x86_64-unknown-linux-gnu x86_64-pc-windows-msvc
```
Expected: "up to date" or successful install for each. Cross-compile targets don't need to link successfully from dev host — CI builds them natively.

---

## Phase 1 — Scaffold the Rust crate

### Task 1: Create the Cargo workspace and minimal stdio MCP

**Files:**
- Create: `openagent/mcp/servers/computer-control/Cargo.toml`
- Create: `openagent/mcp/servers/computer-control/src/main.rs`
- Create: `openagent/mcp/servers/computer-control/.gitignore`

- [ ] **Step 1: Write `Cargo.toml`**

```toml
[package]
name = "openagent-computer-control"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[[bin]]
name = "openagent-computer-control"
path = "src/main.rs"

[dependencies]
rmcp = { version = "0.1", features = ["server", "transport-io"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-std", "signal"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "1"
schemars = "0.8"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
enigo = "0.5"
xcap = "0.7"
image = { version = "0.25", default-features = false, features = ["png"] }
fast_image_resize = "5"

[target.'cfg(target_os = "macos")'.dependencies]
# screencapture fallback is shelled out — no extra crate

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

**Note on `rmcp` version:** pin to the latest stable release at implementation time; if `0.1` is no longer published, update to the current major. The crate lives at <https://github.com/modelcontextprotocol/rust-sdk>.

- [ ] **Step 2: Write minimal `src/main.rs` — no tools yet, just stdio boot**

```rust
use anyhow::Result;
use rmcp::{ServerHandler, ServiceExt, transport::stdio};
use tracing_subscriber::{EnvFilter, fmt};

#[derive(Clone, Default)]
struct ComputerControlServer;

impl ServerHandler for ComputerControlServer {
    fn get_info(&self) -> rmcp::model::ServerInfo {
        rmcp::model::ServerInfo {
            server_info: rmcp::model::Implementation {
                name: "openagent-computer-control".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            capabilities: rmcp::model::ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")))
        .with_writer(std::io::stderr)
        .init();

    let service = ComputerControlServer.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
```

- [ ] **Step 3: Write `.gitignore`**

```
/target
Cargo.lock
```

Note: we commit `Cargo.lock` for binaries normally, but during initial scaffolding CI regenerates it. Remove this line once the crate stabilizes (task 18).

- [ ] **Step 4: Verify it builds on the host**

Run from `openagent/mcp/servers/computer-control/`:
```bash
cargo build --release
```
Expected: builds to `target/release/openagent-computer-control` (add `.exe` on Windows). No warnings fatal.

- [ ] **Step 5: Verify the binary speaks MCP over stdio**

Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' | target/release/openagent-computer-control
```
Expected: receives a JSON-RPC initialize response on stdout with `serverInfo.name == "openagent-computer-control"`. Timeout and kill after 2s — stdio servers don't exit cleanly without a client.

- [ ] **Step 6: Commit**

```bash
git add openagent/mcp/servers/computer-control/Cargo.toml \
        openagent/mcp/servers/computer-control/src/main.rs \
        openagent/mcp/servers/computer-control/.gitignore
git commit -m "feat(computer-control): scaffold Rust crate with minimal stdio MCP"
```

---

### Task 2: Port the coordinate-scaling math (TDD)

**Files:**
- Create: `openagent/mcp/servers/computer-control/src/scaling.rs`
- Modify: `openagent/mcp/servers/computer-control/src/main.rs` (add `mod scaling;`)

Reference: `openagent/mcp/servers/computer-control/src/tools/computer.ts:97-123`

- [ ] **Step 1: Write the failing unit tests**

Write `src/scaling.rs`:
```rust
//! Coordinate and image scaling to match Claude's image autoscaling behavior.
//! Claude downsamples images larger than 1568px on the long edge or 1.15MP.
//! We pre-scale so the reported dimensions match what Claude actually sees.

pub const MAX_LONG_EDGE: u32 = 1568;
pub const MAX_PIXELS: f64 = 1.15 * 1024.0 * 1024.0;

/// Scale factor to shrink a (width, height) image to fit API limits. Always `<= 1.0`.
pub fn size_to_api_scale(width: u32, height: u32) -> f64 {
    let long_edge = width.max(height) as f64;
    let total_pixels = (width as u64 * height as u64) as f64;

    let long_edge_scale = if long_edge > MAX_LONG_EDGE as f64 {
        MAX_LONG_EDGE as f64 / long_edge
    } else {
        1.0
    };
    let pixel_scale = if total_pixels > MAX_PIXELS {
        (MAX_PIXELS / total_pixels).sqrt()
    } else {
        1.0
    };
    long_edge_scale.min(pixel_scale)
}

/// Inverse scale: API image coordinates → logical screen coordinates.
pub fn api_to_logical_scale(logical_width: u32, logical_height: u32) -> f64 {
    let api_scale = size_to_api_scale(logical_width, logical_height);
    1.0 / api_scale
}

/// Convert an (x, y) from API image coords to logical screen coords.
pub fn api_to_logical(x: i32, y: i32, logical_w: u32, logical_h: u32) -> (i32, i32) {
    let s = api_to_logical_scale(logical_w, logical_h);
    ((x as f64 * s).round() as i32, (y as f64 * s).round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_image_no_scaling() {
        assert_eq!(size_to_api_scale(800, 600), 1.0);
    }

    #[test]
    fn long_edge_scales_down() {
        // 3840 long edge → 1568 / 3840
        let s = size_to_api_scale(3840, 2160);
        assert!((s - 1568.0 / 3840.0).abs() < 1e-9);
    }

    #[test]
    fn pixel_count_scales_down() {
        // 2000x2000 = 4_000_000 pixels > 1.15MP but long edge 2000 < 1568? No, 2000 > 1568.
        // Use a square inside the long-edge limit that still exceeds pixel count:
        // 1200x1100 = 1_320_000 pixels > 1_205_534 (1.15MP)
        let s = size_to_api_scale(1200, 1100);
        assert!(s < 1.0);
        assert!(s > 0.9);
        let expected = (MAX_PIXELS / (1200.0 * 1100.0)).sqrt();
        assert!((s - expected).abs() < 1e-9);
    }

    #[test]
    fn api_to_logical_roundtrip_within_1px() {
        // Claude sends a coord in downsampled space; we scale up to logical.
        // For a 3840x2560 display, 1568px API image → scale ≈ 2.449.
        // Coord (100, 100) in API space → (245, 245) in logical.
        let (lx, ly) = api_to_logical(100, 100, 3840, 2560);
        let scale = api_to_logical_scale(3840, 2560);
        assert_eq!(lx, (100.0 * scale).round() as i32);
        assert_eq!(ly, (100.0 * scale).round() as i32);
    }

    #[test]
    fn common_display_sizes_produce_valid_scales() {
        for (w, h) in [(1920, 1080), (2560, 1440), (3840, 2160), (3840, 2560), (1344, 896)] {
            let s = size_to_api_scale(w, h);
            assert!(s > 0.0 && s <= 1.0, "bad scale {s} for {w}x{h}");
        }
    }
}
```

- [ ] **Step 2: Add `mod scaling;` to `src/main.rs`**

Edit `src/main.rs`, add at the top of the file (after `use` statements):
```rust
mod scaling;
```

- [ ] **Step 3: Run tests to verify they pass**

Run from `openagent/mcp/servers/computer-control/`:
```bash
cargo test scaling::
```
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/scaling.rs \
        openagent/mcp/servers/computer-control/src/main.rs
git commit -m "feat(computer-control): port coordinate-scaling math with tests"
```

---

### Task 3: Port the xdotool-compatible key parser

**Files:**
- Create: `openagent/mcp/servers/computer-control/src/keys.rs`
- Modify: `openagent/mcp/servers/computer-control/src/main.rs` (add `mod keys;`)

Reference: `openagent/mcp/servers/computer-control/src/xdotoolStringToKeys.ts` — 230 lines mapping xdotool key names to `enigo::Key` equivalents.

- [ ] **Step 1: Write `src/keys.rs` with the full map and tests**

The TS file has ~130 entries across Function, Navigation, Editing, Modifiers, Alphanumeric, and Symbol sections. Port each entry to Rust. Below is the structure — copy every mapping from the TS source verbatim (this task is mechanical).

```rust
//! Parse xdotool-style key strings (e.g. "ctrl+shift+a", "Return", "super+space")
//! into enigo key presses. Mirrors ../src/xdotoolStringToKeys.ts from the
//! previous TypeScript implementation.

use enigo::Key;

/// Parse a xdotool-style key spec into an ordered list of keys to press together.
/// Example: `"ctrl+shift+a"` → `[Key::Control, Key::Shift, Key::Unicode('a')]`.
pub fn parse(spec: &str) -> Result<Vec<Key>, String> {
    spec.split('+')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(parse_single)
        .collect()
}

fn parse_single(name: &str) -> Result<Key, String> {
    let lower = name.to_ascii_lowercase();
    if let Some(k) = lookup(&lower) {
        return Ok(k);
    }
    // Single-character fallback (alphanumerics not in the explicit map).
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return Ok(Key::Unicode(c));
    }
    Err(format!("Unknown key: {name}"))
}

fn lookup(name: &str) -> Option<Key> {
    // PORT every entry from xdotoolStringToKeys.ts here. Structure by section
    // for easier diff against the original.
    Some(match name {
        // Function keys
        "f1" => Key::F1, "f2" => Key::F2, "f3" => Key::F3, "f4" => Key::F4,
        "f5" => Key::F5, "f6" => Key::F6, "f7" => Key::F7, "f8" => Key::F8,
        "f9" => Key::F9, "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        // (enigo currently supports F1-F12 on all platforms; higher F-keys fall through to Unicode on some OSes.
        // For F13-F24 we fall back to using raw key codes where enigo exposes them; if not available on a platform,
        // return an error at parse time — these are rarely used.)

        // Navigation
        "home" => Key::Home,
        "left" => Key::LeftArrow,
        "up" => Key::UpArrow,
        "right" => Key::RightArrow,
        "down" => Key::DownArrow,
        "page_up" | "pageup" | "prior" => Key::PageUp,
        "page_down" | "pagedown" | "next" => Key::PageDown,
        "end" => Key::End,

        // Editing
        "return" | "enter" => Key::Return,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "escape" | "esc" => Key::Escape,
        "insert" | "ins" => Key::Insert,

        // Modifiers
        "shift" | "shift_l" | "l_shift" => Key::LShift,
        "shift_r" | "r_shift" => Key::RShift,
        "control" | "ctrl" | "control_l" | "l_ctrl" => Key::LControl,
        "control_r" | "r_ctrl" => Key::RControl,
        "alt" | "alt_l" | "l_alt" | "meta" | "meta_l" => Key::Alt,
        "alt_r" | "r_alt" | "meta_r" | "alt_gr" | "altgr" => Key::Alt,
        "super" | "super_l" | "win" | "cmd" | "command" => Key::Meta,
        "super_r" => Key::Meta,
        "caps_lock" | "capslock" => Key::CapsLock,

        // Whitespace / misc
        "minus" | "-" => Key::Unicode('-'),
        "plus" | "+" => Key::Unicode('+'),
        "equal" | "=" => Key::Unicode('='),
        "period" | "." => Key::Unicode('.'),
        "comma" | "," => Key::Unicode(','),
        "slash" | "/" => Key::Unicode('/'),
        "backslash" => Key::Unicode('\\'),
        "semicolon" | ";" => Key::Unicode(';'),
        "colon" | ":" => Key::Unicode(':'),
        "apostrophe" | "'" | "quote" => Key::Unicode('\''),
        "grave" | "`" => Key::Unicode('`'),
        "bracketleft" | "[" => Key::Unicode('['),
        "bracketright" | "]" => Key::Unicode(']'),
        "parenleft" | "(" => Key::Unicode('('),
        "parenright" | ")" => Key::Unicode(')'),
        "asterisk" | "*" => Key::Unicode('*'),
        "ampersand" | "&" => Key::Unicode('&'),
        "at" | "@" => Key::Unicode('@'),
        "exclam" | "!" => Key::Unicode('!'),
        "question" | "?" => Key::Unicode('?'),

        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_letter() {
        assert_eq!(parse("a").unwrap(), vec![Key::Unicode('a')]);
        assert_eq!(parse("Z").unwrap(), vec![Key::Unicode('Z')]);
    }

    #[test]
    fn named_keys() {
        assert_eq!(parse("Return").unwrap(), vec![Key::Return]);
        assert_eq!(parse("escape").unwrap(), vec![Key::Escape]);
        assert_eq!(parse("space").unwrap(), vec![Key::Space]);
    }

    #[test]
    fn chord() {
        assert_eq!(parse("ctrl+a").unwrap(), vec![Key::LControl, Key::Unicode('a')]);
        assert_eq!(parse("ctrl+shift+t").unwrap(), vec![Key::LControl, Key::LShift, Key::Unicode('t')]);
    }

    #[test]
    fn aliases_equal() {
        assert_eq!(parse("cmd+q").unwrap(), parse("super+q").unwrap());
        assert_eq!(parse("enter").unwrap(), parse("return").unwrap());
    }

    #[test]
    fn unknown_key_errors() {
        assert!(parse("bogus_key").is_err());
    }

    #[test]
    fn whitespace_in_chord() {
        assert_eq!(parse("ctrl + a").unwrap(), vec![Key::LControl, Key::Unicode('a')]);
    }
}
```

**IMPORTANT:** this listing shows the *structure* of the port. The engineer must open `src/xdotoolStringToKeys.ts` and copy **every** entry from that file into the `match` above. Missing entries will silently degrade key-press behavior. After the port, diff the entry count: both files should have the same number of logical key names.

- [ ] **Step 2: Add `mod keys;` to `src/main.rs`**

```rust
mod keys;
```

- [ ] **Step 3: Run tests**

Run: `cargo test keys::`
Expected: 6 tests pass.

- [ ] **Step 4: Diff entry count against TS source**

Run:
```bash
grep -c '=>' src/keys.rs
grep -cE '^\s+[a-z_0-9]+:' src/xdotoolStringToKeys.ts
```
Expected: Rust count ≥ TS count (Rust entries group aliases via `|`, so one line can cover multiple TS entries; if Rust is smaller by more than half, entries were dropped — investigate).

- [ ] **Step 5: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/keys.rs \
        openagent/mcp/servers/computer-control/src/main.rs
git commit -m "feat(computer-control): port xdotool key parser with tests"
```

---

## Phase 2 — Screen capture

### Task 4: Capture module with xcap + downsampling

**Files:**
- Create: `openagent/mcp/servers/computer-control/src/capture.rs`
- Modify: `openagent/mcp/servers/computer-control/src/main.rs` (add `mod capture;`)

Reference: `openagent/mcp/servers/computer-control/src/tools/computer.ts:25-43, 350-420`

- [ ] **Step 1: Write `src/capture.rs`**

```rust
//! Screen capture and downsampling.
//!
//! Primary path: `xcap` (CGWindow on macOS, X11/Wayland portal on Linux, DXGI on Windows).
//! macOS fallback: shell out to `screencapture -x` for environments where `xcap` regresses
//! (e.g. the CGDisplayCreateImageForRect removal on macOS 26+ that also broke nut-js).

use anyhow::{Context, Result, anyhow};
use fast_image_resize::{IntoImageView, Resizer, images::Image as FirImage};
use image::{ImageEncoder, RgbaImage, codecs::png::PngEncoder};
use std::io::Cursor;

use crate::scaling::size_to_api_scale;

pub struct CaptureResult {
    /// PNG-encoded, already downsampled to fit Claude's API limits.
    pub png_bytes: Vec<u8>,
    /// Dimensions AFTER downsampling (what gets reported as display_width_px / display_height_px).
    pub reported_width: u32,
    pub reported_height: u32,
    /// Logical screen dimensions BEFORE downsampling (used for coord scaling).
    pub logical_width: u32,
    pub logical_height: u32,
}

pub fn capture_primary_display() -> Result<CaptureResult> {
    let image = try_xcap().or_else(|e| {
        tracing::warn!("xcap capture failed: {e}, trying fallback");
        try_fallback()
    })?;
    Ok(image)
}

fn try_xcap() -> Result<CaptureResult> {
    let monitors = xcap::Monitor::all().context("xcap::Monitor::all failed")?;
    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| anyhow!("no primary monitor found"))?;

    let rgba = primary.capture_image().context("xcap capture_image failed")?;
    let logical_w = rgba.width();
    let logical_h = rgba.height();
    // `xcap` returns an `ImageBuffer<Rgba<u8>, Vec<u8>>` via re-export of `image`.
    let rgba: RgbaImage = RgbaImage::from_raw(logical_w, logical_h, rgba.into_raw())
        .ok_or_else(|| anyhow!("xcap returned invalid buffer"))?;
    let (png_bytes, w, h) = downsample_and_encode(rgba)?;
    Ok(CaptureResult {
        png_bytes,
        reported_width: w,
        reported_height: h,
        logical_width: logical_w,
        logical_height: logical_h,
    })
}

#[cfg(target_os = "macos")]
fn try_fallback() -> Result<CaptureResult> {
    use std::process::Command;
    let tmp = std::env::temp_dir().join(format!(
        "openagent-computer-control-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    let status = Command::new("screencapture")
        .args(["-x", tmp.to_str().ok_or_else(|| anyhow!("non-utf8 tmp path"))?])
        .status()
        .context("spawn screencapture")?;
    if !status.success() {
        return Err(anyhow!("screencapture exited with {status}"));
    }
    let bytes = std::fs::read(&tmp).context("read screencapture png")?;
    let _ = std::fs::remove_file(&tmp);
    let img = image::load_from_memory(&bytes)?.to_rgba8();
    let logical_w = img.width();
    let logical_h = img.height();
    let (png_bytes, w, h) = downsample_and_encode(img)?;
    Ok(CaptureResult {
        png_bytes,
        reported_width: w,
        reported_height: h,
        logical_width: logical_w,
        logical_height: logical_h,
    })
}

#[cfg(not(target_os = "macos"))]
fn try_fallback() -> Result<CaptureResult> {
    Err(anyhow!("no fallback available on this platform"))
}

/// Downsample to fit API limits using Lanczos3 (quality match for TS sharp).
/// Returns (png_bytes, width, height) in downsampled space.
pub fn downsample_and_encode(src: RgbaImage) -> Result<(Vec<u8>, u32, u32)> {
    let (w, h) = (src.width(), src.height());
    let scale = size_to_api_scale(w, h);
    let out = if (scale - 1.0).abs() < f64::EPSILON {
        src
    } else {
        let new_w = ((w as f64 * scale).floor() as u32).max(1);
        let new_h = ((h as f64 * scale).floor() as u32).max(1);
        let src_view = FirImage::from_vec_u8(
            w,
            h,
            src.into_raw(),
            fast_image_resize::PixelType::U8x4,
        )?;
        let mut dst = FirImage::new(new_w, new_h, fast_image_resize::PixelType::U8x4);
        let mut resizer = Resizer::new();
        resizer.resize(&src_view, &mut dst, None)?;
        RgbaImage::from_raw(new_w, new_h, dst.into_vec())
            .ok_or_else(|| anyhow!("resize returned invalid buffer"))?
    };
    let (ow, oh) = (out.width(), out.height());
    let mut buf = Cursor::new(Vec::with_capacity((ow * oh * 2) as usize));
    PngEncoder::new(&mut buf)
        .write_image(out.as_raw(), ow, oh, image::ExtendedColorType::Rgba8)?;
    Ok((buf.into_inner(), ow, oh))
}

/// Draw a 20-pixel-half-width red crosshair centered at (cx, cy) in the image,
/// 3 pixels thick. Ports the loop at computer.ts:376-401.
pub fn draw_crosshair(img: &mut RgbaImage, cx: i32, cy: i32) {
    const SIZE: i32 = 20;
    const COLOR: image::Rgba<u8> = image::Rgba([255, 0, 0, 255]);
    let (w, h) = (img.width() as i32, img.height() as i32);
    // Horizontal (3 rows thick for visibility)
    for x in (cx - SIZE).max(0)..=(cx + SIZE).min(w - 1) {
        for dy in [-1, 0, 1] {
            let y = cy + dy;
            if y >= 0 && y < h {
                img.put_pixel(x as u32, y as u32, COLOR);
            }
        }
    }
    // Vertical (3 columns thick)
    for y in (cy - SIZE).max(0)..=(cy + SIZE).min(h - 1) {
        for dx in [-1, 0, 1] {
            let x = cx + dx;
            if x >= 0 && x < w {
                img.put_pixel(x as u32, y as u32, COLOR);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsample_large_image_shrinks_to_limit() {
        let src = RgbaImage::from_pixel(3840, 2160, image::Rgba([10, 20, 30, 255]));
        let (bytes, w, h) = downsample_and_encode(src).unwrap();
        assert!(w.max(h) <= crate::scaling::MAX_LONG_EDGE);
        assert!((w as u64 * h as u64) as f64 <= crate::scaling::MAX_PIXELS * 1.01);
        // Valid PNG magic
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn downsample_small_image_unchanged() {
        let src = RgbaImage::from_pixel(800, 600, image::Rgba([1, 2, 3, 255]));
        let (_, w, h) = downsample_and_encode(src).unwrap();
        assert_eq!((w, h), (800, 600));
    }

    #[test]
    fn crosshair_paints_red_at_center() {
        let mut img = RgbaImage::from_pixel(100, 100, image::Rgba([0, 0, 0, 255]));
        draw_crosshair(&mut img, 50, 50);
        assert_eq!(*img.get_pixel(50, 50), image::Rgba([255, 0, 0, 255]));
        assert_eq!(*img.get_pixel(60, 50), image::Rgba([255, 0, 0, 255])); // horizontal arm
        assert_eq!(*img.get_pixel(50, 60), image::Rgba([255, 0, 0, 255])); // vertical arm
        assert_eq!(*img.get_pixel(99, 99), image::Rgba([0, 0, 0, 255])); // corner untouched
    }

    #[test]
    fn crosshair_near_edge_does_not_panic() {
        let mut img = RgbaImage::from_pixel(50, 50, image::Rgba([0, 0, 0, 255]));
        draw_crosshair(&mut img, 0, 0);
        draw_crosshair(&mut img, 49, 49);
        draw_crosshair(&mut img, -5, 100); // fully off-screen
    }
}
```

- [ ] **Step 2: Add `mod capture;` to `src/main.rs`**

```rust
mod capture;
```

- [ ] **Step 3: Run tests**

Run: `cargo test capture::`
Expected: 4 tests pass.

- [ ] **Step 4: Manual smoke test — capture the real display**

Write a throwaway `examples/capture_smoke.rs`:
```rust
fn main() {
    let r = openagent_computer_control::capture::capture_primary_display().unwrap();
    std::fs::write("/tmp/smoke.png", &r.png_bytes).unwrap();
    println!("logical: {}x{}", r.logical_width, r.logical_height);
    println!("reported: {}x{}", r.reported_width, r.reported_height);
    println!("bytes: {}", r.png_bytes.len());
}
```

To run this, `src/lib.rs` must exist re-exporting the modules. Instead of adding that now, just add a temporary `#[test]` at the bottom of `capture.rs`:
```rust
#[test]
#[ignore] // run with `cargo test capture_real -- --ignored --nocapture`
fn capture_real_display() {
    let r = capture_primary_display().unwrap();
    std::fs::write("/tmp/smoke.png", &r.png_bytes).unwrap();
    println!("logical: {}x{}", r.logical_width, r.logical_height);
    println!("reported: {}x{}", r.reported_width, r.reported_height);
}
```

Run: `cargo test capture_real -- --ignored --nocapture`
Expected on macOS: macOS prompts for Screen Recording permission (first run only). After granting, the test writes `/tmp/smoke.png` and prints **real** logical dimensions matching your actual display (NOT 1344x896). Open the PNG and confirm it shows your desktop.

This is the single most important smoke test in the plan — it's the core bug being fixed. Don't skip it.

- [ ] **Step 5: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/capture.rs \
        openagent/mcp/servers/computer-control/src/main.rs
git commit -m "feat(computer-control): screen capture + downsampling + crosshair"
```

---

## Phase 3 — Input actions

### Task 5: Input module — type, key, mouse move

**Files:**
- Create: `openagent/mcp/servers/computer-control/src/input.rs`
- Modify: `openagent/mcp/servers/computer-control/src/main.rs` (add `mod input;`)

Reference: `openagent/mcp/servers/computer-control/src/tools/computer.ts:209-246`

- [ ] **Step 1: Write `src/input.rs`**

```rust
//! Input actions (keyboard + mouse) backed by enigo.
//! enigo uses: CGEvent (macOS), XTest or Wayland portal (Linux), SendInput (Windows).

use anyhow::{Context, Result, anyhow};
use enigo::{Button, Direction, Enigo, Keyboard, Mouse, Settings};

use crate::keys;

pub struct InputController {
    enigo: Enigo,
}

impl InputController {
    pub fn new() -> Result<Self> {
        let enigo = Enigo::new(&Settings::default()).context("enigo init failed")?;
        Ok(Self { enigo })
    }

    pub fn type_text(&mut self, text: &str) -> Result<()> {
        self.enigo.text(text).context("enigo.text")?;
        Ok(())
    }

    pub fn key_chord(&mut self, spec: &str) -> Result<()> {
        let keys = keys::parse(spec).map_err(|e| anyhow!(e))?;
        if keys.is_empty() {
            return Err(anyhow!("empty key spec"));
        }
        // Press in order, release in reverse order.
        for k in &keys {
            self.enigo.key(*k, Direction::Press).context("key press")?;
        }
        for k in keys.iter().rev() {
            self.enigo.key(*k, Direction::Release).context("key release")?;
        }
        Ok(())
    }

    pub fn mouse_move(&mut self, x: i32, y: i32) -> Result<()> {
        self.enigo
            .move_mouse(x, y, enigo::Coordinate::Abs)
            .context("move_mouse")?;
        Ok(())
    }

    pub fn cursor_position(&self) -> Result<(i32, i32)> {
        self.enigo.location().context("enigo.location")
    }

    pub fn left_click(&mut self, at: Option<(i32, i32)>) -> Result<()> {
        if let Some((x, y)) = at {
            self.mouse_move(x, y)?;
        }
        self.enigo
            .button(Button::Left, Direction::Click)
            .context("left click")?;
        Ok(())
    }

    pub fn right_click(&mut self, at: Option<(i32, i32)>) -> Result<()> {
        if let Some((x, y)) = at {
            self.mouse_move(x, y)?;
        }
        self.enigo
            .button(Button::Right, Direction::Click)
            .context("right click")?;
        Ok(())
    }

    pub fn middle_click(&mut self, at: Option<(i32, i32)>) -> Result<()> {
        if let Some((x, y)) = at {
            self.mouse_move(x, y)?;
        }
        self.enigo
            .button(Button::Middle, Direction::Click)
            .context("middle click")?;
        Ok(())
    }

    pub fn double_click(&mut self, at: Option<(i32, i32)>) -> Result<()> {
        if let Some((x, y)) = at {
            self.mouse_move(x, y)?;
        }
        self.enigo.button(Button::Left, Direction::Click)?;
        self.enigo.button(Button::Left, Direction::Click)?;
        Ok(())
    }

    pub fn left_click_drag(&mut self, to: (i32, i32)) -> Result<()> {
        self.enigo
            .button(Button::Left, Direction::Press)
            .context("drag press")?;
        self.mouse_move(to.0, to.1)?;
        self.enigo
            .button(Button::Left, Direction::Release)
            .context("drag release")?;
        Ok(())
    }

    /// Scroll with direction ("up"|"down"|"left"|"right") and optional amount (pixels).
    /// Default amount: 300 (matches TS behavior).
    pub fn scroll(&mut self, at: (i32, i32), direction: &str, amount: Option<u32>) -> Result<()> {
        self.mouse_move(at.0, at.1)?;
        let amt = amount.unwrap_or(300) as i32;
        match direction.to_ascii_lowercase().as_str() {
            "up" => self.enigo.scroll(-amt, enigo::Axis::Vertical)?,
            "down" => self.enigo.scroll(amt, enigo::Axis::Vertical)?,
            "left" => self.enigo.scroll(-amt, enigo::Axis::Horizontal)?,
            "right" => self.enigo.scroll(amt, enigo::Axis::Horizontal)?,
            other => return Err(anyhow!("invalid scroll direction: {other}")),
        }
        Ok(())
    }
}

/// Parse the scroll `text` argument from the MCP call, e.g. "down" or "down:500".
/// Returns (direction, Some(amount)) or (direction, None) for default.
pub fn parse_scroll_text(text: &str) -> Result<(&str, Option<u32>)> {
    let mut parts = text.splitn(2, ':');
    let dir = parts
        .next()
        .ok_or_else(|| anyhow!("scroll direction required"))?;
    if dir.is_empty() {
        return Err(anyhow!("scroll direction required"));
    }
    let amount = match parts.next() {
        None => None,
        Some(s) => {
            let n: u32 = s
                .parse()
                .map_err(|_| anyhow!("invalid scroll amount: {s}"))?;
            if n == 0 {
                return Err(anyhow!("invalid scroll amount: {s}"));
            }
            Some(n)
        }
    };
    Ok((dir, amount))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_text_parses_direction_only() {
        assert_eq!(parse_scroll_text("down").unwrap(), ("down", None));
        assert_eq!(parse_scroll_text("up").unwrap(), ("up", None));
    }

    #[test]
    fn scroll_text_parses_direction_and_amount() {
        assert_eq!(parse_scroll_text("down:500").unwrap(), ("down", Some(500)));
        assert_eq!(parse_scroll_text("left:1").unwrap(), ("left", Some(1)));
    }

    #[test]
    fn scroll_text_rejects_bad_amount() {
        assert!(parse_scroll_text("down:abc").is_err());
        assert!(parse_scroll_text("down:0").is_err());
        assert!(parse_scroll_text("down:-5").is_err());
    }

    #[test]
    fn scroll_text_rejects_empty_direction() {
        assert!(parse_scroll_text("").is_err());
        assert!(parse_scroll_text(":500").is_err());
    }
}
```

- [ ] **Step 2: Add `mod input;` to `src/main.rs`**

```rust
mod input;
```

- [ ] **Step 3: Run tests**

Run: `cargo test input::`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/input.rs \
        openagent/mcp/servers/computer-control/src/main.rs
git commit -m "feat(computer-control): input controller + scroll text parser"
```

---

### Task 6: Wire the `computer` tool into the MCP server

**Files:**
- Create: `openagent/mcp/servers/computer-control/src/tool.rs`
- Modify: `openagent/mcp/servers/computer-control/src/main.rs`

Reference: `openagent/mcp/servers/computer-control/src/tools/computer.ts:125-444`

This is the largest single task — the tool dispatcher — but it's mostly mechanical glue over the modules already built.

- [ ] **Step 1: Write `src/tool.rs`**

```rust
//! The single `computer` MCP tool. Dispatcher over capture + input.
//!
//! Tool surface is byte-identical to the Node implementation at
//! ../src/tools/computer.ts — action enum, parameter names, scroll syntax,
//! coordinate-scaling behavior, crosshair overlay.

use anyhow::{Context, Result, anyhow};
use rmcp::{
    ErrorData, ServerHandler,
    model::{
        CallToolResult, Content, Implementation, ListToolsResult, ProtocolVersion,
        ServerCapabilities, ServerInfo, Tool,
    },
    schemars,
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::RoleServer,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{capture, input, scaling};

#[derive(Debug, Clone, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Key,
    Type,
    MouseMove,
    LeftClick,
    LeftClickDrag,
    RightClick,
    MiddleClick,
    DoubleClick,
    Scroll,
    GetScreenshot,
    GetCursorPosition,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ComputerArgs {
    /// The action to perform.
    pub action: Action,
    /// `(x, y)` pixel coordinate in API image space; scaled to logical screen by the server.
    #[serde(default)]
    pub coordinate: Option<[i32; 2]>,
    /// Text argument — required for `type`, `key`, and `scroll`.
    #[serde(default)]
    pub text: Option<String>,
}

/// Instructions the MCP server shows Claude. Verbatim port of computer.ts:153-165
/// — do NOT edit wording without discussing; it shapes Claude's prompting.
pub const TOOL_DESCRIPTION: &str = "Use a mouse and keyboard to interact with a computer, and take screenshots.
* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.
* Always prefer using keyboard shortcuts rather than clicking, where possible.
* If you see boxes with two letters in them, typing these letters will click that element. Use this instead of other shortcuts or clicking, where possible.
* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions. E.g. if you click on Firefox and a window doesn't open, try taking another screenshot.
* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.
* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your cursor position so that the tip of the cursor visually falls on the element that you want to click.
* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.

Using the crosshair:
* Screenshots show a red crosshair at the current cursor position.
* After clicking, check where the crosshair appears vs your target. If it missed, adjust coordinates proportionally to the distance - start with large adjustments and refine. Avoid small incremental changes when the crosshair is far from the target (distances are often further than you expect).
* Consider display dimensions when estimating positions. E.g. if it's 90% to the bottom of the screen, the coordinates should reflect this.";

#[derive(Clone)]
pub struct ComputerControlServer {
    router: rmcp::handler::server::router::tool::ToolRouter<Self>,
    input: Arc<Mutex<input::InputController>>,
}

#[tool_router]
impl ComputerControlServer {
    pub fn new() -> Result<Self> {
        Ok(Self {
            router: Self::tool_router(),
            input: Arc::new(Mutex::new(input::InputController::new()?)),
        })
    }

    #[tool(description = TOOL_DESCRIPTION)]
    pub async fn computer(
        &self,
        params: rmcp::handler::server::tool::Parameters<ComputerArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let args = params.0;
        match self.dispatch(args).await {
            Ok(result) => Ok(result),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!("{e:#}"))])),
        }
    }
}

impl ComputerControlServer {
    async fn dispatch(&self, args: ComputerArgs) -> Result<CallToolResult> {
        // Scale coordinate from API space to logical screen space, if given.
        let logical_coord: Option<(i32, i32)> = match args.coordinate {
            None => None,
            Some([ax, ay]) => {
                let (lw, lh) = self.logical_display_size()?;
                let (lx, ly) = scaling::api_to_logical(ax, ay, lw, lh);
                if lx < 0 || lx >= lw as i32 || ly < 0 || ly >= lh as i32 {
                    return Err(anyhow!(
                        "Coordinates ({lx}, {ly}) are outside display bounds of {lw}x{lh}"
                    ));
                }
                Some((lx, ly))
            }
        };

        let mut input = self.input.lock().await;
        match args.action {
            Action::Key => {
                let text = args.text.ok_or_else(|| anyhow!("Text required for key"))?;
                input.key_chord(&text)?;
                Ok(ok())
            }
            Action::Type => {
                let text = args.text.ok_or_else(|| anyhow!("Text required for type"))?;
                input.type_text(&text)?;
                Ok(ok())
            }
            Action::MouseMove => {
                let (x, y) = logical_coord.ok_or_else(|| anyhow!("Coordinate required for mouse_move"))?;
                input.mouse_move(x, y)?;
                Ok(ok())
            }
            Action::LeftClick => {
                input.left_click(logical_coord)?;
                Ok(ok())
            }
            Action::LeftClickDrag => {
                let to = logical_coord.ok_or_else(|| anyhow!("Coordinate required for left_click_drag"))?;
                input.left_click_drag(to)?;
                Ok(ok())
            }
            Action::RightClick => {
                input.right_click(logical_coord)?;
                Ok(ok())
            }
            Action::MiddleClick => {
                input.middle_click(logical_coord)?;
                Ok(ok())
            }
            Action::DoubleClick => {
                input.double_click(logical_coord)?;
                Ok(ok())
            }
            Action::Scroll => {
                let at = logical_coord.ok_or_else(|| anyhow!("Coordinate required for scroll"))?;
                let text = args.text.ok_or_else(|| anyhow!("Text required for scroll (direction like \"up\", \"down:5\")"))?;
                let (dir, amt) = input::parse_scroll_text(&text)?;
                input.scroll(at, dir, amt)?;
                Ok(ok())
            }
            Action::GetCursorPosition => {
                let (lx, ly) = input.cursor_position()?;
                let (lw, lh) = self.logical_display_size()?;
                let scale = 1.0 / scaling::api_to_logical_scale(lw, lh); // logical → API
                let ax = (lx as f64 * scale).round() as i32;
                let ay = (ly as f64 * scale).round() as i32;
                Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string(&serde_json::json!({ "x": ax, "y": ay }))?,
                )]))
            }
            Action::GetScreenshot => {
                drop(input); // release lock before 1s sleep so clicks don't serialize against it
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                let input_lock = self.input.lock().await;
                let (cx_logical, cy_logical) = input_lock.cursor_position()?;
                drop(input_lock);

                let cap = capture::capture_primary_display()?;
                // Draw crosshair in API image space.
                let scale_logical_to_api =
                    1.0 / scaling::api_to_logical_scale(cap.logical_width, cap.logical_height);
                let cx = (cx_logical as f64 * scale_logical_to_api).round() as i32;
                let cy = (cy_logical as f64 * scale_logical_to_api).round() as i32;

                // Re-decode the PNG so we can draw on it. (Saves one encode trip vs. storing RgbaImage.)
                let mut img = image::load_from_memory(&cap.png_bytes)?.to_rgba8();
                capture::draw_crosshair(&mut img, cx, cy);
                let mut png = std::io::Cursor::new(Vec::with_capacity(cap.png_bytes.len()));
                use image::ImageEncoder;
                image::codecs::png::PngEncoder::new(&mut png).write_image(
                    img.as_raw(),
                    img.width(),
                    img.height(),
                    image::ExtendedColorType::Rgba8,
                )?;
                let b64 = rmcp::model::Content::image(
                    base64_encode(&png.into_inner()),
                    "image/png".to_string(),
                );
                // Also return display_width_px / display_height_px as JSON text content, matching TS behavior.
                let meta = Content::text(serde_json::to_string(&serde_json::json!({
                    "display_width_px": cap.reported_width,
                    "display_height_px": cap.reported_height,
                }))?);
                Ok(CallToolResult::success(vec![b64, meta]))
            }
        }
    }

    fn logical_display_size(&self) -> Result<(u32, u32)> {
        // xcap monitor query is cheap; avoid storing it (display config can change at runtime).
        let primary = xcap::Monitor::all()
            .context("xcap::Monitor::all")?
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .ok_or_else(|| anyhow!("no primary monitor"))?;
        Ok((primary.width()?, primary.height()?))
    }
}

fn ok() -> CallToolResult {
    CallToolResult::success(vec![Content::text(
        serde_json::json!({ "ok": true }).to_string(),
    )])
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.encode(bytes)
}

#[tool_handler]
impl ServerHandler for ComputerControlServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "openagent-computer-control".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: Some("Cross-platform mouse/keyboard/screenshot MCP for desktop GUI control.".to_string()),
            ..Default::default()
        }
    }
}
```

- [ ] **Step 2: Add `base64` dependency to `Cargo.toml`**

In `[dependencies]`:
```toml
base64 = "0.22"
```

- [ ] **Step 3: Rewrite `src/main.rs` to use the new server**

```rust
mod capture;
mod input;
mod keys;
mod scaling;
mod tool;

use anyhow::Result;
use rmcp::{ServiceExt, transport::stdio};
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<()> {
    fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")))
        .with_writer(std::io::stderr)
        .init();

    let server = tool::ComputerControlServer::new()?;
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
```

- [ ] **Step 4: Build and verify the binary lists the tool**

Run: `cargo build --release`
Expected: clean build.

Then run the MCP `tools/list` via a short python driver:
```bash
python3 - <<'EOF'
import json, subprocess
p = subprocess.Popen(["./target/release/openagent-computer-control"],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)
def send(msg):
    p.stdin.write((json.dumps(msg) + "\n").encode()); p.stdin.flush()
send({"jsonrpc":"2.0","id":1,"method":"initialize",
      "params":{"protocolVersion":"2024-11-05","capabilities":{},
                "clientInfo":{"name":"test","version":"0"}}})
print(p.stdout.readline().decode().strip())
send({"jsonrpc":"2.0","method":"notifications/initialized"})
send({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
print(p.stdout.readline().decode().strip())
p.terminate()
EOF
```
Expected: second line contains `"name":"computer"` and the full action enum in its input schema.

- [ ] **Step 5: Smoke test get_screenshot end-to-end**

Append to the Python driver:
```python
send({"jsonrpc":"2.0","id":3,"method":"tools/call",
      "params":{"name":"computer","arguments":{"action":"get_screenshot"}}})
print(p.stdout.readline().decode().strip()[:200])
```
Expected: JSON response with `"type":"image"` content and non-empty base64 data. On macOS first run, this triggers Screen Recording permission prompt — grant it, re-run.

- [ ] **Step 6: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/tool.rs \
        openagent/mcp/servers/computer-control/src/main.rs \
        openagent/mcp/servers/computer-control/Cargo.toml
git commit -m "feat(computer-control): wire computer tool with all actions"
```

---

## Phase 4 — macOS permissions UX

### Task 7: Structured error on TCC denial

**Files:**
- Modify: `openagent/mcp/servers/computer-control/src/capture.rs`
- Modify: `openagent/mcp/servers/computer-control/src/input.rs`

The goal: when `xcap` or `enigo` fail because of a denied TCC grant on macOS, return a clear, actionable error string the agent can relay to the user.

- [ ] **Step 1: Add permission-hint helpers to `capture.rs`**

At the bottom of `src/capture.rs`:
```rust
#[cfg(target_os = "macos")]
fn is_permission_error(e: &anyhow::Error) -> bool {
    // xcap / CoreGraphics don't expose a typed "denied" error. Heuristic: check
    // the error chain for the substrings macOS prints when capture is blocked.
    let s = format!("{e:#}").to_lowercase();
    s.contains("screen recording")
        || s.contains("not authorized")
        || s.contains("cgrequestscreencaptureaccess")
        || s.contains("kcgerror")
}

#[cfg(target_os = "macos")]
pub const MAC_SCREEN_RECORDING_HINT: &str =
    "macOS Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable 'openagent', then restart the app.";
```

Modify `capture_primary_display` to wrap errors:
```rust
pub fn capture_primary_display() -> Result<CaptureResult> {
    let image = try_xcap()
        .or_else(|e| {
            tracing::warn!("xcap capture failed: {e}, trying fallback");
            #[cfg(target_os = "macos")]
            if is_permission_error(&e) {
                return Err(anyhow!(MAC_SCREEN_RECORDING_HINT));
            }
            try_fallback()
        })
        .map_err(|e| {
            #[cfg(target_os = "macos")]
            if is_permission_error(&e) {
                return anyhow!(MAC_SCREEN_RECORDING_HINT);
            }
            e
        })?;
    Ok(image)
}
```

- [ ] **Step 2: Add permission-hint helper to `input.rs`**

At top-level of `src/input.rs`:
```rust
#[cfg(target_os = "macos")]
pub const MAC_ACCESSIBILITY_HINT: &str =
    "macOS Accessibility permission required. Open System Settings → Privacy & Security → Accessibility and enable 'openagent', then restart the app.";

#[cfg(target_os = "macos")]
fn is_accessibility_error(e: &anyhow::Error) -> bool {
    let s = format!("{e:#}").to_lowercase();
    s.contains("accessibility") || s.contains("not trusted") || s.contains("axiserror")
}
```

Wrap `InputController::new` error:
```rust
impl InputController {
    pub fn new() -> Result<Self> {
        let enigo = Enigo::new(&Settings::default()).map_err(|e| {
            let err: anyhow::Error = e.into();
            #[cfg(target_os = "macos")]
            if is_accessibility_error(&err) {
                return anyhow!(MAC_ACCESSIBILITY_HINT);
            }
            err.context("enigo init failed")
        })?;
        Ok(Self { enigo })
    }
}
```

- [ ] **Step 3: Manual verification on macOS**

Temporarily revoke Screen Recording for the test binary:
System Settings → Privacy & Security → Screen Recording → toggle OFF next to the binary (or use `tccutil reset ScreenCapture com.openagent.computer-control` once the bundle ID is set). Then run the smoke driver from Task 6 Step 5. Expected: tool call returns an error result whose text contains "Screen Recording permission required".

Re-enable Screen Recording after the test. (This test is macOS-only; skip on Linux/Windows.)

- [ ] **Step 4: Commit**

```bash
git add openagent/mcp/servers/computer-control/src/capture.rs \
        openagent/mcp/servers/computer-control/src/input.rs
git commit -m "feat(computer-control): structured errors on macOS TCC denial"
```

---

## Phase 5 — Integrate into OpenAgent

### Task 8: Update `builtins.py` to launch the native binary

**Files:**
- Modify: `openagent/mcp/builtins.py`

Reference: current spec at `openagent/mcp/builtins.py:33-40`.

- [ ] **Step 1: Write the new spec and resolver**

In `openagent/mcp/builtins.py`, replace the `"computer-control"` entry (lines 34-40) with a function-computed command, and add the resolver.

At the top of the file, after existing imports:
```python
import platform

def _native_binary_target() -> str:
    """Return the friendly-name subdirectory for the host platform."""
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin":
        if machine in ("arm64", "aarch64"):
            return "darwin-arm64"
        raise RuntimeError(f"Unsupported macOS arch: {machine}")
    if system == "Linux":
        if machine in ("x86_64", "amd64"):
            return "linux-x64"
        raise RuntimeError(f"Unsupported Linux arch: {machine}")
    if system == "Windows":
        if machine in ("amd64", "x86_64"):
            return "windows-x64"
        raise RuntimeError(f"Unsupported Windows arch: {machine}")
    raise RuntimeError(f"Unsupported OS: {system}")

def _resolve_native_binary(name: str) -> str:
    """Resolve a prebuilt native MCP binary for the host. Returns abs path."""
    target = _native_binary_target()
    bin_name = "openagent-" + name + (".exe" if platform.system() == "Windows" else "")
    path = BUILTIN_MCPS_DIR / name / "bin" / target / bin_name
    if not path.exists():
        # Dev convenience: if Cargo.toml exists alongside, build it.
        cargo_toml = BUILTIN_MCPS_DIR / name / "Cargo.toml"
        if cargo_toml.exists() and command_exists("cargo"):
            logger.info("Native MCP '%s' binary missing — building from source...", name)
            subprocess.run(
                ["cargo", "build", "--release"],
                cwd=BUILTIN_MCPS_DIR / name,
                check=True,
            )
            # Detect the host triple and copy the binary into the right bin/ dir.
            host = subprocess.run(
                ["rustc", "-vV"], check=True, capture_output=True, text=True
            ).stdout
            triple = next(
                (ln.split(": ", 1)[1] for ln in host.splitlines() if ln.startswith("host:")),
                "",
            ).strip()
            built = BUILTIN_MCPS_DIR / name / "target" / "release" / bin_name
            if built.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                import shutil as _sh
                _sh.copy2(built, path)
                path.chmod(0o755)
        if not path.exists():
            raise FileNotFoundError(
                f"Native MCP '{name}' binary not found at {path}. "
                f"Run: bash scripts/build-{name}.sh"
            )
    return str(path)
```

Then change the `"computer-control"` entry in `BUILTIN_MCP_SPECS` to:
```python
"computer-control": {
    "dir": "computer-control",
    "native": True,
    # No DISPLAY env — the binary picks the right backend per OS.
},
```

And handle the `native` flag inside `resolve_builtin_entry`. After the existing `is_python = spec.get("python", False)` line (around line 196), add:
```python
    is_native = spec.get("native", False)
    if is_native:
        binary = _resolve_native_binary(name)
        merged_env = dict(spec.get("env") or {})
        if env:
            merged_env.update(env)
        return {
            "name": name,
            "command": [binary],
            "env": merged_env if merged_env else None,
            "_cwd": str(mcp_dir),
        }
```

Place this block **before** the existing `is_python` branch, so native entries short-circuit. Leave the rest of the function untouched.

- [ ] **Step 2: Run the Python test suite to confirm no regression in resolver logic**

Run:
```bash
cd /Users/alessandrogerelli/OpenAgent && python -m pytest scripts/tests -k "mcp or builtin" -x
```
Expected: all existing MCP/builtin tests pass (new ones come in Task 13).

- [ ] **Step 3: Smoke-test end-to-end through OpenAgent**

With the Rust binary built from Task 6:
```bash
python -c "
from openagent.mcp.builtins import resolve_builtin_entry
e = resolve_builtin_entry('computer-control')
print(e)
"
```
Expected: prints a dict with `command` pointing at the native binary path and `env` either None or no `DISPLAY` key.

- [ ] **Step 4: Commit**

```bash
git add openagent/mcp/builtins.py
git commit -m "feat(builtins): resolve computer-control as native binary"
```

---

### Task 9: Dev build helper script

**Files:**
- Create: `scripts/build-computer-control.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Build the Rust computer-control MCP and stage the binary into the right
# bin/<target>/ directory for builtins.py to discover.

cd "$(dirname "$0")/../openagent/mcp/servers/computer-control"

TARGET="$(rustc -vV | sed -n 's|host: ||p')"
case "$TARGET" in
  aarch64-apple-darwin)      OUT=darwin-arm64 ; EXT='' ;;
  x86_64-unknown-linux-gnu)  OUT=linux-x64    ; EXT='' ;;
  x86_64-pc-windows-msvc)    OUT=windows-x64  ; EXT='.exe' ;;
  *) echo "Unsupported host target: $TARGET" >&2 ; exit 1 ;;
esac

cargo build --release --target "$TARGET"

mkdir -p "bin/$OUT"
cp "target/$TARGET/release/openagent-computer-control$EXT" "bin/$OUT/"
chmod +x "bin/$OUT/openagent-computer-control$EXT" 2>/dev/null || true

echo "Staged: bin/$OUT/openagent-computer-control$EXT"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/build-computer-control.sh
```

- [ ] **Step 3: Verify on host**

Run from repo root:
```bash
bash scripts/build-computer-control.sh
ls -la openagent/mcp/servers/computer-control/bin/
```
Expected: prints `Staged: bin/<host-target>/openagent-computer-control`, and the `bin/` directory contains one subdirectory with the binary inside.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-computer-control.sh
git commit -m "feat(scripts): add build-computer-control.sh dev helper"
```

---

### Task 10: Update `scripts/build-executable.sh`

**Files:**
- Modify: `scripts/build-executable.sh`

- [ ] **Step 1: Read the current script**

Run: `cat scripts/build-executable.sh`
Identify the loop that does `npm install && npm run build` for each Node MCP.

- [ ] **Step 2: Remove `computer-control` from the Node-MCP array**

Line 34 of `scripts/build-executable.sh` currently reads:
```bash
NODE_MCPS=(computer-control shell web-search editor chrome-devtools messaging)
```
Change to:
```bash
NODE_MCPS=(shell web-search editor chrome-devtools messaging)
```

- [ ] **Step 3: Add the Rust build step before the Node-MCP loop**

Insert immediately before the existing `# ── Step 2: Build Node.js MCPs ──` section header (line 31):
```bash
# ── Step 2a: Build Rust computer-control MCP ──
echo "→ Building Rust computer-control MCP..."
bash "$SCRIPT_DIR/build-computer-control.sh"

```

Then renumber the comment `# ── Step 2: Build Node.js MCPs ──` on line 31 to `# ── Step 2b: Build Node.js MCPs ──` for consistency.

- [ ] **Step 4: Run the full local build**

```bash
bash scripts/build-executable.sh
```
Expected: `dist/openagent` produced; in the onefile bundle, `openagent/mcp/servers/computer-control/bin/<target>/openagent-computer-control` exists.

Verify by running the bundled executable:
```bash
./dist/openagent --help
```
Expected: normal help output, no crashes.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-executable.sh
git commit -m "build: swap computer-control from Node to Rust in executable build"
```

---

### Task 11: Update `.github/workflows/release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the `computer-control-binary` job**

After the `desktop` job (around line 79) and before the `executable` job (around line 82), insert:

```yaml
  # ── Rust computer-control binary per platform ──
  computer-control-binary:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
            out_dir: darwin-arm64
            ext: ''
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            out_dir: linux-x64
            ext: ''
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            out_dir: windows-x64
            ext: '.exe'
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - name: Install Linux X11 build deps
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y libxdo-dev libx11-dev libxtst-dev libxi-dev pkg-config
      - name: Build release binary
        working-directory: openagent/mcp/servers/computer-control
        run: cargo build --release --target ${{ matrix.target }}
      - name: Sign Rust binary (macOS only — required for stable TCC identity)
        if: runner.os == 'macOS'
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        shell: bash
        run: |
          set -euo pipefail
          if [ -z "${CSC_LINK:-}" ]; then
            echo "CSC_LINK not set — leaving binary unsigned (TCC grant will not persist across updates)"
            exit 0
          fi
          # Import the Developer ID Application cert into a temp keychain
          KEYCHAIN=$RUNNER_TEMP/cc-sign.keychain
          KEYCHAIN_PASSWORD=$(openssl rand -hex 16)
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          security set-keychain-settings -lut 3600 "$KEYCHAIN"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
          P12=$RUNNER_TEMP/cc-sign.p12
          echo "$CSC_LINK" | base64 --decode > "$P12"
          security import "$P12" -k "$KEYCHAIN" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
          IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" | awk -F'"' '/Developer ID Application/ {print $2; exit}')
          if [ -z "$IDENTITY" ]; then
            echo "No Developer ID Application identity found in CSC_LINK"; exit 1
          fi
          BIN=openagent/mcp/servers/computer-control/target/${{ matrix.target }}/release/openagent-computer-control
          # Sign with STABLE identifier so TCC remembers the grant across updates.
          # `--options runtime` is required because the outer openagent binary uses
          # hardened runtime and Apple's notarization rejects nested non-hardened code.
          codesign --force \
            --sign "$IDENTITY" \
            --identifier com.openagent.computer-control \
            --options runtime \
            --timestamp \
            --entitlements buildResources/entitlements.mac.plist \
            "$BIN"
          codesign --verify --strict --verbose=2 "$BIN"
          # Print the identifier so the CI log records what TCC will key on
          codesign -dvv "$BIN" 2>&1 | grep -E '^(Identifier|TeamIdentifier)=' || true
      - uses: actions/upload-artifact@v4
        with:
          name: computer-control-${{ matrix.out_dir }}
          path: openagent/mcp/servers/computer-control/target/${{ matrix.target }}/release/openagent-computer-control${{ matrix.ext }}
```

- [ ] **Step 2: Wire the artifact into the `executable` job**

In the `executable` job, change the `strategy.matrix` to include the friendly target-name so each runner knows which artifact to pull:
```yaml
  executable:
    needs: computer-control-binary
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            cc_target: darwin-arm64
            cc_ext: ''
          - os: ubuntu-latest
            cc_target: linux-x64
            cc_ext: ''
          - os: windows-latest
            cc_target: windows-x64
            cc_ext: '.exe'
    runs-on: ${{ matrix.os }}
```

After the `actions/checkout@v4` step and before the Python setup step, add:
```yaml
      - name: Download computer-control binary
        uses: actions/download-artifact@v4
        with:
          name: computer-control-${{ matrix.cc_target }}
          path: openagent/mcp/servers/computer-control/bin/${{ matrix.cc_target }}/
      - name: Make binary executable
        if: runner.os != 'Windows'
        run: chmod +x openagent/mcp/servers/computer-control/bin/${{ matrix.cc_target }}/openagent-computer-control
```

- [ ] **Step 3: Remove `computer-control` from the Node-MCP build loop inside `executable`**

Edit the "Build Node MCPs" step (around line 101-109). Its shell for-loop currently includes `openagent/mcp/servers/computer-control`. Remove that path from the loop. The updated step reads:
```yaml
      - name: Build Node MCPs
        shell: bash
        run: |
          for mcp_dir in openagent/mcp/servers/shell openagent/mcp/servers/web-search openagent/mcp/servers/editor openagent/mcp/servers/chrome-devtools openagent/mcp/servers/messaging; do
            if [ -d "$mcp_dir" ]; then
              echo "Building $mcp_dir..."
              (cd "$mcp_dir" && npm install --silent && npm run build --silent 2>/dev/null || true)
            fi
          done
```

- [ ] **Step 4: Update the `release` job's `needs`**

Change `needs: [desktop, executable, cli]` to also wait on the new job for artifact staging (through `executable`'s chain), so no additional change is strictly needed — but verify the `if: always() && needs.executable.result == 'success' && needs.cli.result == 'success'` gate doesn't reference the new job. It shouldn't need to.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build + stage Rust computer-control binary before PyInstaller"
```

- [ ] **Step 6: Push and watch the CI run**

```bash
git push -u origin rust-computer-control
```

On the GitHub Actions tab, verify:
- `computer-control-binary` job runs on all three OSes, produces artifacts
- `executable` job downloads the matching artifact, stages it, PyInstaller bundles it
- `sign-notarize-macos.sh` signs the inner binary as part of its recursive pass
- Resulting `dist/openagent-*.pkg` is produced

If CI fails on Linux with missing X11 headers, double-check the `apt-get install` line includes `libxdo-dev libx11-dev libxtst-dev libxi-dev pkg-config`.

---

## Phase 6 — Cleanup + verification

### Task 12: Delete the Node implementation

**Files:**
- Delete: `openagent/mcp/servers/computer-control/src/` (TS only — keep the new `src/main.rs` etc., which live alongside)
- Delete: `openagent/mcp/servers/computer-control/package.json`
- Delete: `openagent/mcp/servers/computer-control/package-lock.json`
- Delete: `openagent/mcp/servers/computer-control/tsconfig.json`
- Delete: `openagent/mcp/servers/computer-control/dist/`
- Delete: `openagent/mcp/servers/computer-control/node_modules/`

**IMPORTANT:** the new Rust `src/` lives at `openagent/mcp/servers/computer-control/src/`. The old TS `src/` was at the same path. Don't delete the entire `src/` directory — only the `*.ts` files within it and the TS-specific subdirs (`tools/`, `utils/`). The Rust files (`main.rs`, `capture.rs`, `input.rs`, `keys.rs`, `scaling.rs`, `tool.rs`) stay.

- [ ] **Step 1: Inventory what's in `src/` right now**

```bash
ls -la openagent/mcp/servers/computer-control/src/
```
Expected: a mix of `.rs` files (new) and `.ts` files + `tools/` + `utils/` subdirs (old).

- [ ] **Step 2: Remove the TS content only**

```bash
cd openagent/mcp/servers/computer-control
rm -f src/*.ts
rm -rf src/tools src/utils
rm -f package.json package-lock.json tsconfig.json
rm -rf dist node_modules
cd -
```

- [ ] **Step 3: Verify the crate still builds**

```bash
cd openagent/mcp/servers/computer-control
cargo build --release
cargo test
cd -
```
Expected: clean build + all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A openagent/mcp/servers/computer-control
git commit -m "chore(computer-control): remove legacy Node implementation"
```

---

### Task 13: Python-side integration smoke test

**Files:**
- Create: `scripts/tests/test_computer_control_native.py`

- [ ] **Step 1: Write the test**

```python
"""Smoke test: the native computer-control binary starts, lists the `computer` tool,
and responds to `get_cursor_position` without needing Screen Recording permission
(cursor position doesn't hit xcap)."""

from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
from openagent.mcp.builtins import resolve_builtin_entry  # noqa: E402


def _send(proc: subprocess.Popen, msg: dict) -> None:
    proc.stdin.write((json.dumps(msg) + "\n").encode())
    proc.stdin.flush()


def _recv(proc: subprocess.Popen) -> dict:
    line = proc.stdout.readline()
    assert line, "MCP server closed stdout unexpectedly"
    return json.loads(line)


@pytest.fixture
def mcp_proc():
    entry = resolve_builtin_entry("computer-control")
    proc = subprocess.Popen(
        entry["command"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, **(entry.get("env") or {})},
    )
    _send(proc, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "pytest", "version": "0"}},
    })
    _recv(proc)  # discard init response
    _send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})
    yield proc
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_lists_computer_tool(mcp_proc):
    _send(mcp_proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    resp = _recv(mcp_proc)
    tools = resp["result"]["tools"]
    assert any(t["name"] == "computer" for t in tools), tools


def test_get_cursor_position(mcp_proc):
    _send(mcp_proc, {
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "computer", "arguments": {"action": "get_cursor_position"}},
    })
    resp = _recv(mcp_proc)
    assert "result" in resp, resp
    # Structured content is a text Content with JSON string.
    text = resp["result"]["content"][0]["text"]
    obj = json.loads(text)
    assert "x" in obj and "y" in obj
    assert isinstance(obj["x"], int) and isinstance(obj["y"], int)
```

- [ ] **Step 2: Run it**

```bash
python -m pytest scripts/tests/test_computer_control_native.py -v
```
Expected: both tests pass. On macOS, `get_cursor_position` does NOT require Screen Recording (only Accessibility); if Accessibility is denied, expect a clear error message — grant it once and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/tests/test_computer_control_native.py
git commit -m "test(computer-control): Python-side smoke test via MCP stdio"
```

---

### Task 14: Manual macOS verification — the TCC-persistence claim

This task has NO automated test because its entire point is human-in-the-loop verification of the central UX promise of this rewrite: **the grant survives a rebuild.**

- [ ] **Step 1: Fresh-grant flow**

On a mac where the binary has never been run:
1. `bash scripts/build-computer-control.sh` (produces unsigned dev binary)
2. Launch openagent and trigger any `computer` action (e.g. via the CLI test harness)
3. Observe macOS prompts for Accessibility and Screen Recording
4. Grant both
5. Trigger the same action — expect success, correct display size, real screenshot content (not 1344×896)

- [ ] **Step 2: Rebuild persistence (UNSIGNED dev build — expected to re-prompt)**

1. `cargo clean` + `bash scripts/build-computer-control.sh` (produces a new unsigned binary with different content hash)
2. Trigger a `computer` action
3. **Expected**: macOS re-prompts because dev builds are not signed. This is the baseline bug we're fixing — document that it persists for unsigned dev builds.

- [ ] **Step 3: Rebuild persistence (SIGNED release build — the actual claim)**

1. Push to a release branch or run the CI release workflow manually
2. Download the signed+notarized `.pkg` installer from the GitHub Release
3. Install it, grant permissions once
4. Publish a new version (trivial bump), install its `.pkg`
5. Trigger a `computer` action
6. **Expected**: NO re-prompt. Grant persists. **This is the acceptance criterion for the whole rewrite.**

If Step 3 fails (re-prompt occurs on signed updates), the most likely causes are:
- The binary's bundle ID is not baked in consistently between builds
- The signing team changed
- macOS TCC reset independently (user ran `tccutil reset`, updated macOS major, etc.)

Investigate `codesign -dvv --entitlements :- /Applications/openagent/.../openagent-computer-control` on both builds — the `Identifier=` line must be identical.

- [ ] **Step 4: Document the outcome in the PR description**

Include before/after screenshots: a working real-display screenshot from the new binary, and ideally a screen recording of the update flow proving no re-prompt.

---

### Task 15: Version bump + PR

**Files:**
- Modify: `pyproject.toml` (`version = "0.5.25"` → `"0.6.0"`)
- Modify: `openagent/__init__.py` (if it carries a `__version__` constant — `grep -n "version" openagent/__init__.py` to check)

- [ ] **Step 1: Bump version**

Run:
```bash
grep -n '^version' pyproject.toml
```
Expected: shows `version = "0.5.25"`. Edit to `"0.6.0"`.

If `openagent/__init__.py` has `__version__`, bump it to match.

- [ ] **Step 2: Commit**

```bash
git add pyproject.toml openagent/__init__.py
git commit -m "release: v0.6.0 — Rust computer-control rewrite"
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Rewrite computer-control MCP in Rust for macOS reliability" --body "$(cat <<'EOF'
## Summary
- Replaces the Node/nut-js computer-control MCP with a signed native Rust binary per platform (darwin-arm64, linux-x64, windows-x64)
- Fixes macOS bug where `DISPLAY=:1` forced screenshots through the XQuartz virtual display (1344×896 instead of real resolution)
- Fixes macOS TCC re-prompt churn — signed binary with stable bundle ID preserves grant across updates
- Tool surface is byte-identical to the previous implementation — no agent-side changes needed for Claude or Agno

## Spec
[docs/superpowers/specs/2026-04-16-computer-control-rust-rewrite-design.md](docs/superpowers/specs/2026-04-16-computer-control-rust-rewrite-design.md)

## Test plan
- [ ] `cargo test` passes in openagent/mcp/servers/computer-control on all three platforms
- [ ] `python -m pytest scripts/tests/test_computer_control_native.py -v` passes on macOS
- [ ] Fresh macOS: first-run permission prompts appear for Accessibility + Screen Recording
- [ ] Signed macOS release build: no re-prompt after version upgrade
- [ ] Linux: screenshot reflects real desktop (verify manually)
- [ ] Windows: screenshot reflects real desktop (verify manually)
- [ ] Downsampling: `display_width_px`/`display_height_px` match actual PNG dimensions
- [ ] Crosshair appears at cursor location in returned screenshots

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI through green**

Monitor the PR's CI runs. All six build jobs (3 × `computer-control-binary` + 3 × `executable`) must pass before merge.

---

## Appendix: Known open questions (non-blocking)

- **`rmcp` version.** The example code assumes an API shape consistent with the 0.1–0.3 line of the crate. If `tool_router` / `tool_handler` attributes have moved by the time this plan is executed, check the crate's examples directory — the structure is stable but attribute names may rename.
- **Linux Wayland.** `xcap` supports Wayland via xdg-portal, which may prompt on first capture. If testers report portal issues, add a feature flag to the `xcap` dep (`features = ["wayland"]`) or document X11 as the supported path.
- **Windows SendInput quirks.** `enigo` on Windows doesn't always honor Unicode text input for non-ASCII characters in every target app. If this blocks a user, fall back to clipboard-paste (Ctrl+V after SetClipboardData) — can be added as a follow-up.
