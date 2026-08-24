import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { alreadyMatches, type ConvertSettings, type TargetFormat, type ResizeMode } from "./skip.ts";

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
};

const EXTENSIONS = ["heic", "heif", "avif", "webp", "jpg", "jpeg", "png", "tif", "tiff", "jfif", "bmp"];

const rows = new Map<string, Row>();
let destination: string | null = null;
let running = false;
// The settings signature each in-flight file is being converted under, read back
// when it completes.

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = element<HTMLElement>("drop");
const rowsBody = element<HTMLTableSectionElement>("rows");
const notice = element<HTMLDivElement>("notice");
const noticeTitle = element<HTMLParagraphElement>("notice-title");
const noticeBody = element<HTMLDivElement>("notice-body");
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
    summary.textContent = `Converting — ${done + failed} Of ${total}`;
  } else if (done || failed) {
    summary.textContent = `${done} CONVERTED${failed ? `, ${failed} FAILED` : ""}`;
  } else {
    summary.textContent = `${total} File${total === 1 ? "" : "s"} Queued`;
  }
}

// One popup for every message: a centred Title-Case heading, an optional body
// (a left-aligned list of filenames, or one centred line), and a close button.
// It never dismisses itself — the user closes it.
function popup(title: string, body: { names?: string[]; line?: string } = {}) {
  noticeTitle.textContent = title;
  noticeBody.replaceChildren();

  if (body.names && body.names.length > 0) {
    const list = document.createElement("div");
    list.className = "toast-list";
    for (const name of body.names) {
      const span = document.createElement("span");
      span.textContent = name;
      list.append(span);
    }
    noticeBody.append(list);
  } else if (body.line) {
    const line = document.createElement("p");
    line.className = "toast-line";
    line.textContent = body.line;
    noticeBody.append(line);
  }

  notice.hidden = false;
}

function closePopup() {
  notice.hidden = true;
}

const fileName = (path: string) => path.split("/").pop() ?? path;

async function addPaths(dropped: string[]) {
  // Rust walks any folders and drops anything that is not an image.
  const paths = await invoke<string[]>("collect_images", { paths: dropped });
  const wanted = paths.filter((path) => !rows.has(path));
  const dupes = paths.filter((path) => rows.has(path));
  const ignored = dropped.length === 0 ? 0 : Math.max(0, dropped.length - paths.length);

  if (wanted.length === 0) {
    if (dupes.length > 0) {
      popup("Already In The Queue", { names: dupes.map(fileName) });
    } else {
      popup("No Images Found");
    }
    return;
  }

  if (dupes.length > 0) {
    popup("Already In The Queue", { names: dupes.map(fileName) });
  } else if (ignored > 0) {
    popup("Not Images", { line: `${ignored} File${ignored === 1 ? "" : "s"} Ignored` });
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

// Reads the current control values into the shape the tested decision expects.
function currentSettings(): ConvertSettings {
  return {
    format: formatSelect.value as TargetFormat,
    resizeMode: resizeMode.value as ResizeMode,
    resizeAmount: Number(resizeAmount.value) || 1,
  };
}

function rowMatches(row: Row, settings: ConvertSettings): boolean {
  if (!row.info) return false;
  const extension = row.path.split(".").pop()?.toLowerCase() ?? "";
  return alreadyMatches(settings, { extension, width: row.info.width, height: row.info.height });
}

async function convert() {
  if (running) {
    await invoke("cancel_batch");
    return;
  }

  const convertible = [...rows.values()].filter((row) => row.info !== null);
  if (convertible.length === 0) return;

  const options = settings();
  const active = currentSettings();

  // Check each file's own attributes against the settings. A file already in
  // the target format and size is skipped — converting it would change nothing.
  const toConvert = convertible.filter((row) => !rowMatches(row, active));
  const skipped = convertible.filter((row) => rowMatches(row, active));

  const label = formatSelect.value.toUpperCase();
  for (const row of skipped) {
    rows.set(row.path, { ...row, state: "skipped", detail: `Already ${label}` });
  }

  if (toConvert.length === 0) {
    popup("Already Converted", { names: skipped.map((row) => row.info!.name) });
    render();
    return;
  }

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
    rows.set(payload.path, { ...row, state: "done", detail: change });
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

element<HTMLButtonElement>("notice-close").addEventListener("click", closePopup);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
});

clearButton.addEventListener("click", () => {
  rows.clear();
  render();
});

convertButton.addEventListener("click", () => void convert());

render();
