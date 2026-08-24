// The decision, before any conversion runs, of whether a queued file already
// matches the chosen settings and can be skipped. Pure and DOM-free so it can be
// tested on its own — main.ts feeds it the current control values.

export type TargetFormat = "jpeg" | "png" | "webp" | "avif" | "heic" | "tiff";
export type ResizeMode = "original" | "longest" | "percent";

export type ConvertSettings = {
  format: TargetFormat;
  resizeMode: ResizeMode;
  resizeAmount: number;
};

export type FileAttributes = {
  extension: string;
  width: number;
  height: number;
};

const FORMAT_EXTENSIONS: Record<TargetFormat, string[]> = {
  jpeg: ["jpg", "jpeg", "jfif"],
  png: ["png"],
  webp: ["webp"],
  avif: ["avif"],
  heic: ["heic", "heif"],
  tiff: ["tif", "tiff"],
};

// Is the file already in the chosen output format?
export function formatMatches(format: TargetFormat, extension: string): boolean {
  return FORMAT_EXTENSIONS[format].includes(extension.toLowerCase());
}

// Would the chosen Size leave the file's pixels exactly as they are? Original
// always does; a longest-edge or percentage only when it lands on the current
// longest edge (a bigger longest edge never upscales, so it is unchanged too).
export function sizeMatches(settings: ConvertSettings, file: FileAttributes): boolean {
  const longest = Math.max(file.width, file.height);
  if (settings.resizeMode === "longest") {
    const px = settings.resizeAmount || 1;
    return Math.min(px, longest) === longest;
  }
  if (settings.resizeMode === "percent") {
    const pct = settings.resizeAmount || 1;
    return Math.round((longest * pct) / 100) === longest;
  }
  return true;
}

// A file is skipped only when converting it would change nothing: same format
// and same pixels. Quality is not stored in the file, so it is never part of
// this — a quality change alone does not force a same-format re-encode.
export function alreadyMatches(settings: ConvertSettings, file: FileAttributes): boolean {
  return formatMatches(settings.format, file.extension) && sizeMatches(settings, file);
}
