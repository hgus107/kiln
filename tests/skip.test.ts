import { test } from "node:test";
import assert from "node:assert/strict";
import { alreadyMatches, type ConvertSettings, type FileAttributes } from "../src/skip.ts";

// A helper reading like the UI: "converting THESE files at THESE settings".
function plan(settings: ConvertSettings, files: FileAttributes[]) {
  const convert = files.filter((f) => !alreadyMatches(settings, f));
  const skip = files.filter((f) => alreadyMatches(settings, f));
  return { convert: convert.length, skip: skip.length };
}

const jpeg = (w = 800, h = 600): FileAttributes => ({ extension: "jpg", width: w, height: h });
const webp = (w = 800, h = 600): FileAttributes => ({ extension: "webp", width: w, height: h });

const toJpegOriginal: ConvertSettings = { format: "jpeg", resizeMode: "original", resizeAmount: 0 };

// ---- Single file ----

test("single: JPEG to JPEG at original size is skipped", () => {
  assert.equal(alreadyMatches(toJpegOriginal, jpeg()), true);
});

test("single: WebP to JPEG converts", () => {
  assert.equal(alreadyMatches(toJpegOriginal, webp()), false);
});

test("single: JPEG to JPEG but resizing smaller converts", () => {
  const shrink: ConvertSettings = { format: "jpeg", resizeMode: "longest", resizeAmount: 400 };
  assert.equal(alreadyMatches(shrink, jpeg(800, 600)), false);
});

test("single: JPEG to JPEG, longest edge larger than the image, is skipped (no upscale)", () => {
  const grow: ConvertSettings = { format: "jpeg", resizeMode: "longest", resizeAmount: 5000 };
  assert.equal(alreadyMatches(grow, jpeg(800, 600)), true);
});

test("single: JPEG to JPEG at 100% is skipped, at 50% converts", () => {
  assert.equal(alreadyMatches({ format: "jpeg", resizeMode: "percent", resizeAmount: 100 }, jpeg()), true);
  assert.equal(alreadyMatches({ format: "jpeg", resizeMode: "percent", resizeAmount: 50 }, jpeg()), false);
});

test("single: extension case and jpeg/jpg/jfif all count as JPEG", () => {
  for (const ext of ["JPG", "jpeg", "JFIF"]) {
    assert.equal(alreadyMatches(toJpegOriginal, { extension: ext, width: 10, height: 10 }), true);
  }
});

// ---- Multiple files ----

test("multiple: 9 JPEG + 2 WebP to JPEG original -> convert 2, skip 9", () => {
  const files = [...Array(9)].map(() => jpeg()).concat([...Array(2)].map(() => webp()));
  assert.deepEqual(plan(toJpegOriginal, files), { convert: 2, skip: 9 });
});

test("multiple: same mix but resizing smaller -> convert all 11", () => {
  const shrink: ConvertSettings = { format: "jpeg", resizeMode: "longest", resizeAmount: 400 };
  const files = [...Array(9)].map(() => jpeg()).concat([...Array(2)].map(() => webp()));
  assert.deepEqual(plan(shrink, files), { convert: 11, skip: 0 });
});

test("multiple: all already target format and size -> skip all", () => {
  const files = [jpeg(), jpeg(1200, 900), jpeg(300, 300)];
  assert.deepEqual(plan(toJpegOriginal, files), { convert: 0, skip: 3 });
});

test("multiple: converting to WebP -> the WebP files skip, JPEGs convert", () => {
  const toWebp: ConvertSettings = { format: "webp", resizeMode: "original", resizeAmount: 0 };
  const files = [jpeg(), jpeg(), webp()];
  assert.deepEqual(plan(toWebp, files), { convert: 2, skip: 1 });
});
