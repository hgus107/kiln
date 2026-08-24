# Kiln

Raw in, finished out. Your photos never leave the machine.

## Why this exists

Converting a HEIC from your phone into a JPEG means, today, uploading it to a website. Search "heic to jpg" and every result on the first page is an ad-covered site with a file limit, a queue, and a copy of your photo on someone else's server.

There is no reason for that. The conversion is a local operation. The libraries that do it are free, fast, and forty years mature. The only thing missing is a decent interface.

Kiln is that interface. It runs on your computer, it has no network code in it, and it does not care how many files you give it.

## What it does

- Converts between HEIC, AVIF, WebP, JPEG, PNG, TIFF, GIF, and camera RAW
- Rasterizes SVG at any resolution you ask for
- Batch conversion — hundreds of files, one queue
- Quality and resize controls, applied to the whole batch
- Strips or keeps metadata, your choice
- One bad file fails on its own row instead of killing the run

## What it avoids

| The web converters | Kiln |
|---|---|
| Your file is uploaded to a stranger's server | Nothing leaves the disk |
| 5 files per batch, 100 MB limit | No limits |
| Wait in a queue behind other people's jobs | Runs at the speed of your CPU |
| Ads, popups, "upgrade to Pro" | None |
| Output arrives as a zip you have to unpack | Files written straight to the folder you picked |

## How to use

> Pre-release. There is no installer to download yet. This is the intended flow.

1. Drag files or a folder onto the window.
2. Pick an output format, and a quality or size if the format takes one.
3. Choose where the results go — next to the originals, or a folder you name.
4. Press Convert. The list fills in row by row as each file finishes.

Originals are never modified or deleted.

## Tech stack

**Shell**
- [Tauri v2](https://tauri.app) — desktop shell, IPC bridge, installer bundler. Uses the operating system's own webview, so the app ships at single-digit megabytes rather than shipping a copy of Chrome.
- Frontend is Vite + TypeScript, no framework. The UI is a drop zone, a form, and a table; a framework would be more machinery than the job needs.

**Backend**
- [Rust](https://www.rust-lang.org) — all file and image work happens here. The frontend passes file *paths* over the Tauri command bridge, never file contents.
- [libvips](https://www.libvips.org) via the `libvips` Rust bindings — the conversion engine. Chosen over ImageMagick because it streams images through a pipeline instead of loading them whole, so memory stays flat whether the file is 2 MB or 200 MB.
- `libheif` — HEIC/HEIF decode, reached through libvips.
- `libraw` — camera RAW decode (CR2, CR3, NEF, ARW, DNG, RAF, ORF).
- [`resvg`](https://github.com/linebender/resvg) — SVG rasterization, in pure Rust.
- [`rayon`](https://github.com/rayon-rs/rayon) — the worker pool. Conversion is CPU-bound, so the batch is split across cores with a work-stealing scheduler rather than an async runtime.
- `serde` — typed messages across the Rust/TypeScript boundary.

**How a conversion actually runs**

The frontend hands Rust a list of paths plus the output settings. Rust builds one task per file and feeds them to the rayon pool. Each task opens the source through libvips, applies the requested transforms as a lazy pipeline, encodes to the target format, and writes the result — resolving name collisions before it writes, never after. Progress and per-file errors are emitted back to the webview as Tauri events, which is why the table can update one row at a time instead of freezing until the batch is done.

**Distribution**
- `tauri build` produces a signed `.dmg`, `.msi`, and `.AppImage`, with the vips shared libraries bundled alongside the binary.
- macOS builds are notarized so Gatekeeper opens them without the right-click dance.
- Homebrew tap for `brew install --cask kiln`.

## License

MIT.
