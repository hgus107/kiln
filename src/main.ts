import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

type SourceInfo = {
  path: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  hasMetadata: boolean;
};

type Probe =
  | ({ kind: "ok" } & SourceInfo)
  | { kind: "failed"; path: string; error: string };

type Progress =
  | { status: "done"; path: string; output: string; bytes: number }
  | { status: "failed"; path: string; error: string }
  | { status: "skipped"; path: string };

type Row = {
  info: SourceInfo | null;
  path: string;
  state: "queued" | "working" | "done" | "failed" | "skipped";
  detail: string;
  // The settings this row was last converted under, so an unchanged repeat is
  // recognised as already done.
  convertedSig?: string;
};

const EXTENSIONS = ["heic", "heif", "avif", "webp", "jpg", "jpeg", "png", "tif", "tiff", "jfif", "bmp"];

const rows = new Map<string, Row>();
let destination: string | null = null;
let running = false;
let noticeTimer = 0;
// The settings signature each in-flight file is being converted under, read back
// when it completes.
let runSigs = new Map<string, string>();

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = element<HTMLElement>("drop");
const rowsBody = element<HTMLTableSectionElement>("rows");
const notice = element<HTMLParagraphElement>("notice");
const emptyNote = element<HTMLParagraphElement>("empty");
const summary = element<HTMLSpanElement>("summary");
const formatSelect = element<HTMLSelectElement>("format");
const qualityField = element<HTMLLabelElement>("quality-field");
const qualityInput = element<HTMLInputElement>("quality");
const qualityValue = element<HTMLOutputElement>("quality-value");
const resizeMode = element<HTMLSelectElement>("resize-mode");
const resizeField = element<HTMLLabelElement>("resize-amount-field");
const resizeLabel = element<HTMLSpanElement>("resize-amount-label");
const resizeAmount = element<HTMLInputElement>("resize-amount");
const keepMetadata = element<HTMLInputElement>("keep-metadata");
const timestamp = element<HTMLInputElement>("timestamp");
const destinationButton = element<HTMLButtonElement>("destination");
const convertButton = element<HTMLButtonElement>("convert");
const clearButton = element<HTMLButtonElement>("clear");

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value >= 10 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

function render() {
  rowsBody.replaceChildren();

  for (const row of rows.values()) {
    const tr = document.createElement("tr");
    tr.className = row.state;

    const name = document.createElement("td");
    name.textContent = row.info?.name ?? row.path.split("/").pop() ?? row.path;
    name.title = row.path;

    const size = document.createElement("td");
    size.textContent = row.info ? formatBytes(row.info.bytes) : "—";

    const dimensions = document.createElement("td");
    dimensions.textContent = row.info ? `${row.info.width} × ${row.info.height}` : "—";

    const detail = document.createElement("td");
    detail.textContent = row.detail;
    detail.className = "detail";

    const remove = document.createElement("td");
    remove.className = "remove-cell";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove";
    removeButton.textContent = "×";
    removeButton.title = "Remove from the queue";
    removeButton.setAttribute("aria-label", `Remove ${row.info?.name ?? "file"}`);
    removeButton.addEventListener("click", () => {
      rows.delete(row.path);
      render();
    });
    remove.append(removeButton);

    tr.append(name, size, dimensions, detail, remove);
    rowsBody.append(tr);
  }

  const total = rows.size;
  emptyNote.hidden = total > 0;
  convertButton.disabled = total === 0;

  const done = [...rows.values()].filter((row) => row.state === "done").length;
  const failed = [...rows.values()].filter((row) => row.state === "failed").length;

  if (total === 0) {
    summary.textContent = "";
  } else if (running) {
    summary.textContent = `Converting — ${done + failed} of ${total}`;
  } else if (done || failed) {
    summary.textContent = `${done} CONVERTED${failed ? `, ${failed} FAILED` : ""}`;
  } else {
    summary.textContent = `${total} file${total === 1 ? "" : "s"} queued`;
  }
}

function notify(message: string) {
  notice.textContent = message;
  notice.hidden = message === "";
  window.clearTimeout(noticeTimer);
  if (message !== "") noticeTimer = window.setTimeout(() => notify(""), 4000);
}

const fileName = (path: string) => path.split("/").pop() ?? path;

async function addPaths(dropped: string[]) {
  // Rust walks any folders and drops anything that is not an image.
  const paths = await invoke<string[]>("collect_images", { paths: dropped });
  const wanted = paths.filter((path) => !rows.has(path));
  const dupes = paths.filter((path) => rows.has(path));
  const ignored = dropped.length === 0 ? 0 : Math.max(0, dropped.length - paths.length);

  if (wanted.length === 0) {
    notify(
      dupes.length === 1
        ? `${fileName(dupes[0])} Already In The Queue`
        : dupes.length > 1
          ? `${dupes.length} Files Already In The Queue`
          : "No Images Found",
    );
    return;
  }

  if (dupes.length > 0) {
    notify(
      dupes.length === 1
        ? `${fileName(dupes[0])} Already In The Queue`
        : `${dupes.length} Files Already In The Queue`,
    );
  } else if (ignored > 0) {
    notify(`Ignored ${ignored} That ${ignored === 1 ? "Is" : "Are"} Not An Image`);
  }

  for (const path of wanted) {
    rows.set(path, { info: null, path, state: "queued", detail: "Reading…" });
  }
  render();

  const probes = await invoke<Probe[]>("probe_files", { paths: wanted });
  for (const probe of probes) {
    if (probe.kind === "ok") {
      rows.set(probe.path, { info: probe, path: probe.path, state: "queued", detail: "Queued" });
    } else {
      rows.set(probe.path, {
        info: null,
        path: probe.path,
        state: "failed",
        detail: probe.error,
      });
    }
  }
  render();
}

/// Colons and slashes are illegal or displayed wrongly in filenames, so the
/// stamp is digits only: 20260824-131205, which also sorts correctly.
function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

function settings() {
  const mode = resizeMode.value;
  const amount = Number(resizeAmount.value) || 1;

  return {
    format: formatSelect.value,
    quality: Number(qualityInput.value),
    resize:
      mode === "longest"
        ? { mode: "longest", px: amount }
        : mode === "percent"
          ? { mode: "percent", pct: amount }
          : { mode: "original" },
    keepMetadata: keepMetadata.checked,
    destination,
    // One stamp for the whole run, so every file from a batch carries the same one.
    suffix: timestamp.checked ? stamp() : null,
  };
}

// The current settings, minus the file set — identical for every row in a run.
function settingsSig(): string {
  return JSON.stringify({
    format: formatSelect.value,
    quality: qualityInput.value,
    resizeMode: resizeMode.value,
    resizeAmount: resizeAmount.value,
    keepMetadata: keepMetadata.checked,
    timestamp: timestamp.checked,
    destination,
  });
}

const FORMAT_EXTENSIONS: Record<string, string[]> = {
  jpeg: ["jpg", "jpeg", "jfif"],
  png: ["png"],
  webp: ["webp"],
  avif: ["avif"],
  heic: ["heic", "heif"],
  tiff: ["tif", "tiff"],
};

function alreadyTargetFormat(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (FORMAT_EXTENSIONS[formatSelect.value] ?? []).includes(ext);
}

// Would converting this file actually produce a different file? Format and pixel
// dimensions and metadata are comparable; a JPEG's stored quality is not, so a
// quality change alone does not force a same-format re-encode.
function wouldChange(row: Row): boolean {
  if (!row.info) return false;
  if (!alreadyTargetFormat(row.path)) return true;

  const longest = Math.max(row.info.width, row.info.height);
  let target = longest;
  if (resizeMode.value === "longest") target = Math.min(Number(resizeAmount.value) || 1, longest);
  else if (resizeMode.value === "percent")
    target = Math.round((longest * (Number(resizeAmount.value) || 1)) / 100);

  const dimensionsChange = target !== longest;
  // Stripping only counts as a change if the file actually carries metadata.
  const metadataStrip = !keepMetadata.checked && row.info.hasMetadata;
  return dimensionsChange || metadataStrip;
}

async function convert() {
  if (running) {
    await invoke("cancel_batch");
    return;
  }

  const convertible = [...rows.values()].filter((row) => row.info !== null);
  if (convertible.length === 0) return;

  // One settings object, reused for the disk check and the conversion, so the
  // timestamp (if any) matches between them.
  const options = settings();
  const sig = settingsSig();

  // First pass: same-format files that a conversion would not change at all.
  const noop = new Set(
    convertible.filter((row) => !wouldChange(row)).map((row) => row.path),
  );

  // Second pass, on disk: files whose output already sits in the destination.
  const candidates = convertible.filter((row) => !noop.has(row.path));
  const onDisk = new Set(
    await invoke<string[]>("already_converted", {
      paths: candidates.map((row) => row.path),
      settings: options,
    }),
  );

  const toConvert = candidates.filter((row) => !onDisk.has(row.path));
  const skipped = convertible.filter((row) => !toConvert.includes(row));

  const label = formatSelect.value.toUpperCase();
  for (const row of skipped) {
    const reason = noop.has(row.path) ? `Already ${label}` : "Already Converted";
    rows.set(row.path, { ...row, state: "skipped", detail: reason });
  }

  if (toConvert.length === 0) {
    const names = skipped.map((row) => row.info!.name);
    notify(
      names.length <= 5
        ? `Already Converted — ${names.join(", ")}`
        : `${skipped.length} Of ${convertible.length} Files Already Converted`,
    );
    render();
    return;
  }

  if (skipped.length > 0) {
    notify(`Converting ${toConvert.length}, Skipped ${skipped.length} Already Converted`);
  }

  runSigs = new Map(toConvert.map((row) => [row.path, sig]));
  for (const row of toConvert) {
    rows.set(row.path, { ...row, state: "working", detail: "Converting…" });
  }

  running = true;
  convertButton.textContent = "Cancel";
  convertButton.classList.add("cancel");
  render();

  await invoke("convert_batch", { paths: toConvert.map((row) => row.path), settings: options });
}

listen<Progress>("conversion-progress", ({ payload }) => {
  const row = rows.get(payload.path);
  if (!row) return;

  if (payload.status === "done") {
    const saved = row.info?.bytes ? Math.round((1 - payload.bytes / row.info.bytes) * 100) : 0;
    const change = saved > 0 ? `${formatBytes(payload.bytes)}, ${saved}% smaller` : formatBytes(payload.bytes);
    rows.set(payload.path, { ...row, state: "done", detail: change, convertedSig: runSigs.get(payload.path) });
  } else if (payload.status === "failed") {
    rows.set(payload.path, { ...row, state: "failed", detail: payload.error });
  } else {
    rows.set(payload.path, { ...row, state: "skipped", detail: "Cancelled" });
  }
  render();
});

listen("conversion-finished", () => {
  running = false;
  convertButton.textContent = "Convert";
  convertButton.classList.remove("cancel");
  render();
});

listen<{ paths: string[] }>("tauri://drag-drop", ({ payload }) => {
  dropZone.classList.remove("over");
  void addPaths(payload.paths);
});
listen("tauri://drag-enter", () => dropZone.classList.add("over"));
listen("tauri://drag-leave", () => dropZone.classList.remove("over"));

element<HTMLButtonElement>("browse").addEventListener("click", async () => {
  const chosen = await open({
    multiple: true,
    filters: [{ name: "Images", extensions: EXTENSIONS }],
  });
  if (Array.isArray(chosen)) void addPaths(chosen);
});

destinationButton.addEventListener("click", async () => {
  if (destination !== null) {
    destination = null;
    destinationButton.textContent = "Choose Folder";
    return;
  }
  const chosen = await open({ directory: true, multiple: false });
  if (typeof chosen === "string") {
    destination = chosen;
    destinationButton.textContent = chosen.split("/").pop() ?? chosen;
    destinationButton.title = `${chosen} — click to write beside the originals instead`;
  }
});

formatSelect.addEventListener("change", () => {
  // PNG is lossless here, so the slider would be a lie.
  qualityField.hidden = formatSelect.value === "png";
});

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
});

resizeMode.addEventListener("change", () => {
  const mode = resizeMode.value;
  resizeField.hidden = mode === "original";
  resizeLabel.textContent = mode === "percent" ? "Percent" : "Pixels";
  resizeAmount.value = mode === "percent" ? "50" : "2048";
  resizeAmount.max = mode === "percent" ? "100" : "";
});

clearButton.addEventListener("click", () => {
  rows.clear();
  render();
});

convertButton.addEventListener("click", () => void convert());

render();
