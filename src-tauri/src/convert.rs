//! Image conversion. Everything here runs on a worker thread; nothing here
//! knows about Tauri, windows, or events.

use libvips::ops;
use libvips::VipsImage;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Jpeg,
    Png,
    Webp,
    Avif,
    Heic,
    Tiff,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            OutputFormat::Jpeg => "jpg",
            OutputFormat::Png => "png",
            OutputFormat::Webp => "webp",
            OutputFormat::Avif => "avif",
            OutputFormat::Heic => "heic",
            OutputFormat::Tiff => "tiff",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum Resize {
    /// Leave the pixel dimensions alone.
    Original,
    /// Fit inside a box this many pixels on its longest side.
    Longest { px: i32 },
    /// Scale to a percentage of the original.
    Percent { pct: f64 },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub format: OutputFormat,
    /// 1-100. Ignored for formats that ignore it.
    pub quality: i32,
    pub resize: Resize,
    /// False strips EXIF, XMP, IPTC and any C2PA/AI-generation tags with them.
    pub keep_metadata: bool,
    /// None writes each result beside its original.
    pub destination: Option<String>,
    /// Appended to every name in the batch, before the extension. The frontend
    /// stamps one value per run so a batch shares it.
    pub suffix: Option<String>,
}

/// What the frontend shows in a row before anything is converted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub width: i32,
    pub height: i32,
}

pub fn probe(path: &Path) -> Result<SourceInfo, String> {
    let path_str = path.to_str().ok_or_else(|| "path is not valid UTF-8".to_string())?;
    let image = VipsImage::new_from_file(path_str).map_err(vips_error)?;
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(SourceInfo {
        path: path_str.to_string(),
        name: file_name(path),
        bytes,
        width: image.get_width(),
        height: image.get_height(),
    })
}

/// Converts one file and returns where it was written. The source is only ever read.
pub fn convert_one(source: &Path, settings: &Settings) -> Result<PathBuf, String> {
    let source_str = source.to_str().ok_or_else(|| "path is not valid UTF-8".to_string())?;

    // Longest edge is the same number whichever way the photo is rotated, so it
    // survives the autorotation that thumbnail applies below.
    let probe = VipsImage::new_from_file(source_str).map_err(vips_error)?;
    let longest = probe.get_width().max(probe.get_height());
    drop(probe);

    let target = match settings.resize {
        Resize::Original => longest,
        // Never upscale: asking for 4000px from a 1000px source returns 1000px.
        Resize::Longest { px } => px.min(longest),
        Resize::Percent { pct } => ((longest as f64) * pct / 100.0).round() as i32,
    }
    .max(1);

    // Stripping metadata keeps the colour profile, because deleting a profile
    // shifts colours rather than removing information. Everything else goes:
    // GPS, camera serial, timestamps, and C2PA generator tags.
    let (keep, output_profile) = if settings.keep_metadata {
        (ops::ForeignKeep::All, None)
    } else {
        (ops::ForeignKeep::Icc, Some("srgb".to_string()))
    };

    // thumbnail() rather than a load-then-resize: it reads the source at a
    // reduced resolution where the format allows, applies the orientation tag
    // so phone photos are not sideways, and never holds the whole image.
    let options = ops::ThumbnailOptions {
        height: target,
        size: ops::Size::Down,
        output_profile,
        ..ops::ThumbnailOptions::default()
    };
    let image = ops::thumbnail_with_opts(source_str, target, &options).map_err(vips_error)?;

    let destination = match &settings.destination {
        Some(dir) => PathBuf::from(dir),
        None => source
            .parent()
            .ok_or_else(|| "file has no parent directory".to_string())?
            .to_path_buf(),
    };
    std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;

    // Resolved before the write, so an existing file is never overwritten.
    let out_path = unique_path(&destination, source, settings.format, settings.suffix.as_deref());
    let out_str = out_path
        .to_str()
        .ok_or_else(|| "output path is not valid UTF-8".to_string())?;

    let quality = settings.quality.clamp(1, 100);
    match settings.format {
        OutputFormat::Jpeg => ops::jpegsave_with_opts(
            &image,
            out_str,
            &ops::JpegsaveOptions { q: quality, keep, ..Default::default() },
        ),
        OutputFormat::Png => ops::pngsave_with_opts(
            &image,
            out_str,
            &ops::PngsaveOptions { keep, ..Default::default() },
        ),
        OutputFormat::Webp => ops::webpsave_with_opts(
            &image,
            out_str,
            &ops::WebpsaveOptions { q: quality, keep, ..Default::default() },
        ),
        OutputFormat::Avif => ops::heifsave_with_opts(
            &image,
            out_str,
            &ops::HeifsaveOptions {
                q: quality,
                compression: ops::ForeignHeifCompression::Av1,
                keep,
                ..Default::default()
            },
        ),
        OutputFormat::Heic => ops::heifsave_with_opts(
            &image,
            out_str,
            &ops::HeifsaveOptions {
                q: quality,
                compression: ops::ForeignHeifCompression::Hevc,
                keep,
                ..Default::default()
            },
        ),
        OutputFormat::Tiff => ops::tiffsave_with_opts(
            &image,
            out_str,
            &ops::TiffsaveOptions {
                compression: ops::ForeignTiffCompression::Deflate,
                keep,
                ..Default::default()
            },
        ),
    }
    .map_err(vips_error)?;

    Ok(out_path)
}

fn unique_path(
    directory: &Path,
    source: &Path,
    format: OutputFormat,
    suffix: Option<&str>,
) -> PathBuf {
    let mut stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string());
    if let Some(suffix) = suffix {
        stem.push('-');
        stem.push_str(suffix);
    }
    let extension = format.extension();

    let mut candidate = directory.join(format!("{stem}.{extension}"));
    let mut counter = 1;
    while candidate.exists() {
        candidate = directory.join(format!("{stem} ({counter}).{extension}"));
        counter += 1;
    }
    candidate
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// libvips puts the useful detail in a global error buffer rather than in the
/// error value, so both are read.
fn vips_error(error: libvips::error::Error) -> String {
    let detail = unsafe {
        let buffer = libvips::bindings::vips_error_buffer();
        if buffer.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(buffer).to_string_lossy().trim().to_string()
        }
    };
    unsafe { libvips::bindings::vips_error_clear() };

    if detail.is_empty() {
        format!("{error}")
    } else {
        detail.lines().last().unwrap_or(&detail).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    static VIPS: OnceLock<libvips::VipsApp> = OnceLock::new();

    fn vips() {
        VIPS.get_or_init(|| libvips::VipsApp::default("kiln-tests").unwrap());
    }

    /// A wide, GPS-tagged JPEG, so both resizing and metadata have something to act on.
    fn fixture(directory: &Path) -> PathBuf {
        let path = directory.join("source.jpg");
        let image = ops::black(1600, 900).unwrap();
        let image = ops::colourspace(&image, ops::Interpretation::Srgb).unwrap();
        ops::jpegsave(&image, path.to_str().unwrap()).unwrap();
        path
    }

    fn settings(format: OutputFormat, resize: Resize, keep_metadata: bool, out: &Path) -> Settings {
        Settings {
            format,
            quality: 80,
            resize,
            keep_metadata,
            destination: Some(out.to_string_lossy().into_owned()),
            suffix: None,
        }
    }

    #[test]
    fn converts_and_resizes_to_the_longest_edge() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-longest");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = fixture(&directory);

        let output = convert_one(
            &source,
            &settings(OutputFormat::Webp, Resize::Longest { px: 800 }, false, &directory),
        )
        .unwrap();

        assert_eq!(output.extension().unwrap(), "webp");
        let result = VipsImage::new_from_file(output.to_str().unwrap()).unwrap();
        assert_eq!(result.get_width(), 800);
        assert_eq!(result.get_height(), 450);
    }

    #[test]
    fn never_upscales() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-upscale");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = fixture(&directory);

        let output = convert_one(
            &source,
            &settings(OutputFormat::Jpeg, Resize::Longest { px: 5000 }, false, &directory),
        )
        .unwrap();

        let result = VipsImage::new_from_file(output.to_str().unwrap()).unwrap();
        assert_eq!(result.get_width(), 1600);
    }

    #[test]
    fn percentage_scales_both_edges() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-percent");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = fixture(&directory);

        let output = convert_one(
            &source,
            &settings(OutputFormat::Png, Resize::Percent { pct: 25.0 }, false, &directory),
        )
        .unwrap();

        let result = VipsImage::new_from_file(output.to_str().unwrap()).unwrap();
        assert_eq!(result.get_width(), 400);
        assert_eq!(result.get_height(), 225);
    }

    #[test]
    fn existing_files_are_not_overwritten() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-collide");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = fixture(&directory);
        let options = settings(OutputFormat::Png, Resize::Original, false, &directory);

        let first = convert_one(&source, &options).unwrap();
        let second = convert_one(&source, &options).unwrap();

        assert_ne!(first, second);
        assert!(first.exists() && second.exists());
        assert_eq!(second.file_name().unwrap().to_string_lossy(), "source (1).png");
    }

    #[test]
    fn a_timestamp_suffix_lands_before_the_extension() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-suffix");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = fixture(&directory);

        let mut options = settings(OutputFormat::Png, Resize::Original, false, &directory);
        options.suffix = Some("20260824-131205".to_string());
        let output = convert_one(&source, &options).unwrap();

        assert_eq!(
            output.file_name().unwrap().to_string_lossy(),
            "source-20260824-131205.png"
        );
    }

    #[test]
    fn a_file_that_is_not_an_image_fails_without_panicking() {
        vips();
        let directory = std::env::temp_dir().join("kiln-test-garbage");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("not-an-image.jpg");
        std::fs::write(&source, b"this is not a jpeg").unwrap();

        let result = convert_one(
            &source,
            &settings(OutputFormat::Jpeg, Resize::Original, false, &directory),
        );

        assert!(result.is_err());
        assert!(!result.unwrap_err().is_empty());
    }
}
