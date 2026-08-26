export type SaveDestinationMode = "original" | "chosen";

export type SaveableRow = {
  sourcePath: string;
  outputPath: string;
};

export type SaveMove = {
  from: string;
  to: string;
};

export function saveEnabled(
  rows: Iterable<{ state: string; outputPath?: string }>,
  busy: boolean,
): boolean {
  if (busy) return false;
  return [...rows].some((row) => Boolean(row.outputPath) && row.state !== "saved");
}

export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

export function parentFolder(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return ".";
  if (index === 0) return path[0];
  if (index === 2 && path[1] === ":") return path.slice(0, 3);
  return path.slice(0, index);
}

export function stemOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

export function extensionOf(path: string): string {
  const name = baseName(path);
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

export function joinPath(folder: string, name: string): string {
  if (folder.endsWith("/") || folder.endsWith("\\")) return `${folder}${name}`;
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return `${folder}${separator}${name}`;
}

export function safeFileStem(value: string, fallback: string): string {
  const clean = (input: string) => input
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .trim()
    .replace(/[. ]+$/g, "");
  let stem = clean(value);
  if (stem === "" || stem === "." || stem === "..") stem = clean(fallback) || "Image";
  stem = [...stem].slice(0, 180).join("");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `${stem}_`;
  return stem;
}

export function originalLocationLabel(rows: SaveableRow[]): string {
  const folders = new Set(rows.map((row) => parentFolder(row.sourcePath)));
  if (folders.size === 0) return "";
  if (folders.size === 1) return [...folders][0];
  return "Each Image's Original Folder";
}

export function buildSaveMoves(
  rows: SaveableRow[],
  mode: SaveDestinationMode,
  chosenFolder: string,
  singleName: string,
): SaveMove[] {
  const single = rows.length === 1;
  return rows.map((row) => {
    const folder = mode === "original" || chosenFolder.trim() === ""
      ? parentFolder(row.sourcePath)
      : chosenFolder;
    const outputName = baseName(row.outputPath);
    let name = outputName;
    if (single) {
      const extension = extensionOf(row.outputPath);
      const requestedName = extensionOf(singleName) === extension ? stemOf(singleName) : singleName;
      const stem = safeFileStem(requestedName, stemOf(outputName));
      name = extension ? `${stem}.${extension}` : stem;
    }
    return { from: row.outputPath, to: joinPath(folder, name) };
  });
}
