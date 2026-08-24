# Kiln

Raw in, finished out. Your photos never leave the machine.

## Why this exists

Converting a HEIC from your phone into a JPEG means, today, uploading it to a website. Search "heic to jpg" and every result on the first page is an ad-covered site with a file limit, a queue, and a copy of your photo on someone else's server.

There is no reason for that. The conversion is a local operation. The libraries that do it are free, fast, and decades mature. The only thing missing is a decent interface.

Kiln is that interface. It runs on your computer, it has no network code in it, and it does not care how many files you give it.

## What it does

- Converts between HEIC, AVIF, WebP, JPEG, PNG, and TIFF
- Batch conversion — hundreds of files, one queue
- Quality control, applied to the whole batch
- Resize by longest edge or percentage, applied to the whole batch. Never upscales
- Strips or keeps metadata, your choice — including GPS, camera serial, and C2PA / AI-generation tags
- One bad file fails on its own row instead of killing the run

Planned: SVG rasterization in 1.1, camera RAW in 2.0. Both are separate problems and neither is worth delaying a working converter for.

## About metadata

Every photo carries an invisible block of EXIF, XMP, and increasingly C2PA data. It holds the GPS coordinates the picture was taken at, the timestamp, the camera make, model, and serial number, and — on images from Grok, Gemini, and similar tools — a signed tag marking the file as AI-generated. That last one is why an image posted to a social platform can show a "made with" label you never added and cannot see in the file.

Strip it and all of that goes. Keep it and your copyright field, lens, and exposure data survive, which is what photographers want. Hence a toggle rather than a decision made for you.

Two things are deliberately *not* treated as disposable metadata. **Orientation** is baked into the pixels before the tag is dropped, so phone photos don't come out sideways. **Colour profiles** are converted to sRGB rather than deleted, so colours don't shift. Naive metadata stripping gets both of these wrong.

One honest limit: this removes metadata, and metadata only. Google's SynthID watermark lives in the pixels themselves and survives conversion, resizing, and re-compression. Kiln does not touch it and does not claim to.

## What it avoids

| The web converters | Kiln |
|---|---|
| Your file is uploaded to a stranger's server | Nothing leaves the disk |
| 5 files per batch, 100 MB limit | No limits |
| Wait in a queue behind other people's jobs | Runs at the speed of your CPU |
| Ads, popups, "upgrade to Pro" | None |
| Output arrives as a zip you have to unpack | Files written straight to the folder you picked |
| Photos quietly carry your home GPS coordinates | One toggle removes them |
| Hidden generator tags you cannot see or edit | Removed with the rest of the metadata |

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
- [`rayon`](https://github.com/rayon-rs/rayon) — the worker pool. Conversion is CPU-bound, so the batch is split across cores with a work-stealing scheduler rather than an async runtime.
- `serde` — typed messages across the Rust/TypeScript boundary.

**How a conversion actually runs**

The frontend hands Rust a list of paths plus the output settings. Rust builds one task per file and feeds them to the rayon pool. Each task opens the source through libvips, applies the requested transforms as a lazy pipeline — autorotate, resize, colour convert, metadata decision, encode — and writes the result, resolving name collisions before it writes rather than after. Progress and per-file errors are emitted back to the webview as Tauri events, which is why the table can update one row at a time instead of freezing until the batch is done.

Note that resizing and quality are separate controls doing separate jobs. Resize changes pixel dimensions. Quality changes how hard the encoder compresses what is left. File size falls out of both, and neither is a target-size setting — encoding to a specific number of megabytes takes repeated re-encodes per file and is not in v1.

**Distribution**
- `tauri build` produces a signed `.dmg`, `.msi`, and `.AppImage`, with the vips shared libraries bundled alongside the binary.
- macOS builds are notarized so Gatekeeper opens them without the right-click dance.
- Homebrew tap for `brew install --cask kiln`.

## License

MIT.
