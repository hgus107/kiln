mod convert;

use convert::{Settings, SourceInfo};
use rayon::prelude::*;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};

/// libvips is initialised once for the life of the process.
static VIPS: OnceLock<libvips::VipsApp> = OnceLock::new();

#[derive(Default)]
struct Batch {
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum Probe {
    Ok(SourceInfo),
    Failed { path: String, error: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum Progress {
    Done { path: String, output: String, bytes: u64 },
    Failed { path: String, error: String },
    Skipped { path: String },
}

const SUPPORTED: [&str; 11] = [
    "heic", "heif", "avif", "webp", "jpg", "jpeg", "png", "tif", "tiff", "jfif", "bmp",
];

/// Turns whatever was dropped into a flat list of image paths: a dropped folder
/// is walked, and anything that is not a readable image is left out.
#[tauri::command]
fn collect_images(paths: Vec<String>) -> Vec<String> {
    fn walk(path: &std::path::Path, depth: usize, found: &mut Vec<String>) {
        if found.len() > 20_000 {
            return;
        }

        if path.is_dir() {
            // Deep enough for a real photo library, shallow enough that a
            // dropped home directory cannot run away with the app.
            if depth >= 8 {
                return;
            }
            let Ok(entries) = std::fs::read_dir(path) else {
                return;
            };
            let mut children: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
            children.sort();
            for child in children {
                walk(&child, depth + 1, found);
            }
            return;
        }

        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if SUPPORTED.contains(&extension.as_str()) {
            if let Some(path) = path.to_str() {
                found.push(path.to_string());
            }
        }
    }

    let mut found = Vec::new();
    for path in paths {
        walk(&PathBuf::from(path), 0, &mut found);
    }
    found
}

/// Reads dimensions and size for the preview table. Files that cannot be opened
/// come back as Failed rather than taking the whole call down.
#[tauri::command]
fn probe_files(paths: Vec<String>) -> Vec<Probe> {
    paths
        .into_par_iter()
        .map(|path| match convert::probe(&PathBuf::from(&path)) {
            Ok(info) => Probe::Ok(info),
            Err(error) => Probe::Failed { path, error },
        })
        .collect()
}

/// Starts a batch and returns immediately. Results arrive as `conversion-progress`
/// events, one per file, followed by a single `conversion-finished`.
#[tauri::command]
fn convert_batch(app: AppHandle, paths: Vec<String>, settings: Settings) {
    let cancelled = {
        let batch: State<Batch> = app.state();
        batch.cancelled.store(false, Ordering::SeqCst);
        batch.cancelled.clone()
    };

    std::thread::spawn(move || {
        paths.par_iter().for_each(|path| {
            if cancelled.load(Ordering::SeqCst) {
                let _ = app.emit("conversion-progress", Progress::Skipped { path: path.clone() });
                return;
            }

            let progress = match convert::convert_one(&PathBuf::from(path), &settings) {
                Ok(output) => {
                    let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
                    Progress::Done {
                        path: path.clone(),
                        output: output.to_string_lossy().into_owned(),
                        bytes,
                    }
                }
                Err(error) => Progress::Failed { path: path.clone(), error },
            };

            let _ = app.emit("conversion-progress", progress);
        });

        let _ = app.emit("conversion-finished", ());
    });
}

/// Files already in flight finish; the rest are skipped. Nothing written is undone.
#[tauri::command]
fn cancel_batch(batch: State<Batch>) {
    batch.cancelled.store(true, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Batch::default())
        .setup(|_app| {
            let vips = libvips::VipsApp::default("kiln")?;
            // One thread per image rather than per operation: rayon already has
            // every core busy with a different file, and letting vips fan out on
            // top of that oversubscribes the machine and slows the batch down.
            vips.concurrency_set(1);
            let _ = VIPS.set(vips);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![collect_images, probe_files, convert_batch, cancel_batch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
