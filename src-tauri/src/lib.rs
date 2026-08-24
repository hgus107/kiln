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
        .invoke_handler(tauri::generate_handler![probe_files, convert_batch, cancel_batch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
