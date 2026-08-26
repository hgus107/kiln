import test from "node:test";
import assert from "node:assert/strict";
import {
  baseName,
  buildSaveMoves,
  extensionOf,
  joinPath,
  originalLocationLabel,
  parentFolder,
  safeFileStem,
  saveEnabled,
  stemOf,
  type SaveableRow,
} from "../src/save-policy.ts";

test("Save enables only for an unsaved converted result while the app is idle", () => {
  assert.equal(saveEnabled([], false), false);
  assert.equal(saveEnabled([{ state: "queued" }], false), false);
  assert.equal(saveEnabled([{ state: "done", outputPath: "/scratch/a.jpg" }], false), true);
  assert.equal(saveEnabled([{ state: "failed", outputPath: "/scratch/a.jpg" }], false), true);
  assert.equal(saveEnabled([{ state: "saved", outputPath: "/scratch/a.jpg" }], false), false);
  assert.equal(saveEnabled([{ state: "done", outputPath: "/scratch/a.jpg" }], true), false);
});

test("Mac plus Windows paths expose the correct parent and filename", () => {
  assert.equal(parentFolder("/Users/me/Pictures/a.jpg"), "/Users/me/Pictures");
  assert.equal(baseName("/Users/me/Pictures/a.jpg"), "a.jpg");
  assert.equal(parentFolder("C:\\Users\\Me\\Pictures\\a.jpg"), "C:\\Users\\Me\\Pictures");
  assert.equal(baseName("C:\\Users\\Me\\Pictures\\a.jpg"), "a.jpg");
  assert.equal(parentFolder("C:\\a.jpg"), "C:\\");
});

test("path joining preserves the host path separator", () => {
  assert.equal(joinPath("/Users/me", "a.jpg"), "/Users/me/a.jpg");
  assert.equal(joinPath("/", "a.jpg"), "/a.jpg");
  assert.equal(joinPath("C:\\Users\\Me", "a.jpg"), "C:\\Users\\Me\\a.jpg");
  assert.equal(joinPath("C:\\", "a.jpg"), "C:\\a.jpg");
});

test("extensions plus stems come from the converted output", () => {
  assert.equal(extensionOf("/scratch/photo-20260824-131205.JPG"), "jpg");
  assert.equal(stemOf("photo-20260824-131205.jpg"), "photo-20260824-131205");
  assert.equal(extensionOf("/scratch/no-extension"), "");
});

test("unsafe filename characters cannot create folders or invalid Windows names", () => {
  assert.equal(safeFileStem(" summer/a:b\\c?. ", "Photo"), "summer-a-b-c-");
  assert.equal(safeFileStem("CON", "Photo"), "CON_");
  assert.equal(safeFileStem("lpt9", "Photo"), "lpt9_");
});

test("empty, dot-only, plus control-only names use a safe fallback", () => {
  assert.equal(safeFileStem("", "Original"), "Original");
  assert.equal(safeFileStem("..", "Original"), "Original");
  assert.equal(safeFileStem("\u0000", ""), "Image");
});

test("filenames are bounded to 180 characters before the extension", () => {
  assert.equal(safeFileStem("x".repeat(500), "fallback").length, 180);
  assert.equal([...safeFileStem("😀".repeat(500), "fallback")].length, 180);
});

test("one original folder displays its actual path", () => {
  assert.equal(originalLocationLabel([
    { sourcePath: "/one/a.jpg", outputPath: "/scratch/a.png" },
    { sourcePath: "/one/b.jpg", outputPath: "/scratch/b.png" },
  ]), "/one");
});

test("mixed original folders display the per-image destination label", () => {
  assert.equal(originalLocationLabel([
    { sourcePath: "/one/a.jpg", outputPath: "/scratch/a.png" },
    { sourcePath: "/two/b.jpg", outputPath: "/scratch/b.png" },
  ]), "Each Image's Original Folder");
});

test("a single image defaults to its converted timestamped stem plus output extension", () => {
  const rows: SaveableRow[] = [{
    sourcePath: "/photos/a.heic",
    outputPath: "/scratch/a-20260824-131205.jpg",
  }];
  assert.deepEqual(buildSaveMoves(rows, "original", "", "a-20260824-131205"), [{
    from: "/scratch/a-20260824-131205.jpg",
    to: "/photos/a-20260824-131205.jpg",
  }]);
});

test("a single custom filename is sanitized and saved in a chosen folder", () => {
  const rows: SaveableRow[] = [{ sourcePath: "/photos/a.heic", outputPath: "/scratch/a.jpg" }];
  assert.deepEqual(buildSaveMoves(rows, "chosen", "/exports", "new/name"), [{
    from: "/scratch/a.jpg",
    to: "/exports/new-name.jpg",
  }]);
});

test("typing the displayed output extension does not duplicate it", () => {
  const rows: SaveableRow[] = [{ sourcePath: "/photos/a.heic", outputPath: "/scratch/a.jpg" }];
  assert.equal(buildSaveMoves(rows, "original", "", "renamed.jpg")[0].to, "/photos/renamed.jpg");
  assert.equal(buildSaveMoves(rows, "original", "", "renamed.final")[0].to, "/photos/renamed.final.jpg");
});

test("a batch saves beside each original even when sources span folders", () => {
  const rows: SaveableRow[] = [
    { sourcePath: "/one/a.heic", outputPath: "/scratch/a.jpg" },
    { sourcePath: "/two/b.heic", outputPath: "/scratch/b.jpg" },
  ];
  assert.deepEqual(buildSaveMoves(rows, "original", "", ""), [
    { from: "/scratch/a.jpg", to: "/one/a.jpg" },
    { from: "/scratch/b.jpg", to: "/two/b.jpg" },
  ]);
});

test("a batch saves every converted filename into one chosen folder", () => {
  const rows: SaveableRow[] = [
    { sourcePath: "/one/a.heic", outputPath: "/scratch/a.jpg" },
    { sourcePath: "/two/b.heic", outputPath: "/scratch/b.jpg" },
  ];
  assert.deepEqual(buildSaveMoves(rows, "chosen", "C:\\Exports", ""), [
    { from: "/scratch/a.jpg", to: "C:\\Exports\\a.jpg" },
    { from: "/scratch/b.jpg", to: "C:\\Exports\\b.jpg" },
  ]);
});

test("an unavailable chosen folder safely falls back beside each original", () => {
  const rows: SaveableRow[] = [{ sourcePath: "/photos/a.heic", outputPath: "/scratch/a.jpg" }];
  assert.equal(buildSaveMoves(rows, "chosen", "", "a")[0].to, "/photos/a.jpg");
});
