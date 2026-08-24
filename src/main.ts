import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

type SourceInfo = {
  path: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
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

const EXTENSIONS = ["heic", "heif", "avif", "webp", "jpg", "jpeg", "png", "tif", "tiff"];

const rows = new Map<string, Row>();
let destination: string | null = null;
let running = false;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = element<HTMLElement>("drop");
const rowsBody = element<HTMLTableSectionElement>("rows");
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

    tr.append(name, size, dimensions, detail);
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
    summary.textContent = `${done} converted${failed ? `, ${failed} failed` : ""}`;
  } else {
    summary.textContent = `${total} file${total === 1 ? "" : "s"} queued`;
  }
}

async function addPaths(paths: string[]) {
  const wanted = paths.filter((path) => {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSIONS.includes(extension) && !rows.has(path);
  });
  if (wanted.length === 0) return;

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

async function convert() {
  if (running) {
    await invoke("cancel_batch");
    return;
  }

  const paths = [...rows.values()]
    .filter((row) => row.info !== null)
    .map((row) => row.path);
  if (paths.length === 0) return;

  for (const path of paths) {
    const row = rows.get(path)!;
    rows.set(path, { ...row, state: "working", detail: "Converting…" });
  }

  running = true;
  convertButton.textContent = "Cancel";
  convertButton.classList.add("cancel");
  render();

  await invoke("convert_batch", { paths, settings: settings() });
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
    destinationButton.textContent = "Beside the originals";
    return;
  }
  const chosen = await open({ directory: true, multiple: false });
  if (typeof chosen === "string") {
    destination = chosen;
    destinationButton.textContent = chosen.split("/").pop() ?? chosen;
    destinationButton.title = `${chosen} — click to reset`;
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
