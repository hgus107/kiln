import test from "node:test";
import assert from "node:assert/strict";
import {
  compressionQuality,
  conversionPlan,
  convertibleRows,
  convertButtonEnabled,
  progressPresentation,
  rowResize,
  type ConvertibleRow,
} from "../src/conversion-policy.ts";

const row = (overrides: Partial<ConvertibleRow> = {}): ConvertibleRow => ({
  path: "/images/a.jpg",
  state: "queued",
  hasSourceInfo: true,
  ...overrides,
});

test("empty target dimensions preserve original pixels", () => {
  assert.deepEqual(rowResize(), { mode: "original" });
  assert.deepEqual(rowResize(""), { mode: "original" });
  assert.deepEqual(rowResize("   "), { mode: "original" });
});

test("valid target dimensions produce one exact resize request", () => {
  assert.deepEqual(rowResize("1024 * 7680"), { mode: "exact", width: 1024, height: 7680 });
  assert.deepEqual(rowResize("7680 * 1024"), { mode: "exact", width: 7680, height: 1024 });
});

test("dimension boundaries are inclusive", () => {
  assert.deepEqual(rowResize("1024 * 1024"), { mode: "exact", width: 1024, height: 1024 });
  assert.deepEqual(rowResize("7680 * 7680"), { mode: "exact", width: 7680, height: 7680 });
});

test("partial, malformed, below-minimum, plus above-maximum dimensions are rejected", () => {
  for (const value of ["1024", "1024*1024", "1023 * 1024", "1024 * 1023", "7681 * 1024", "1024 * 7681"]) {
    assert.equal(rowResize(value), null, value);
  }
});

test("queued, failed, plus cancelled valid rows are convertible", () => {
  const candidates = convertibleRows([
    row({ path: "queued", state: "queued" }),
    row({ path: "failed", state: "failed" }),
    row({ path: "cancelled", state: "cancelled" }),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.path), ["queued", "failed", "cancelled"]);
});

test("working, converted, plus saved rows never re-enter conversion", () => {
  assert.equal(convertibleRows([
    row({ state: "working" }), row({ state: "done" }), row({ state: "saved" }),
  ]).length, 0);
});

test("corrupt rows without source information never enter conversion", () => {
  assert.equal(convertibleRows([row({ state: "failed", hasSourceInfo: false })]).length, 0);
});

test("a missing format blocks conversion before any work starts", () => {
  assert.deepEqual(conversionPlan([row()], ""), { kind: "missing-format" });
});

test("unsaved results block a second conversion and protect scratch results", () => {
  assert.deepEqual(conversionPlan([row({ state: "done", output: "/scratch/a.png" })], "png"), {
    kind: "unsaved-results",
  });
});

test("an empty queue plus a corrupt-only queue have no convertible files", () => {
  assert.deepEqual(conversionPlan([], "jpeg"), { kind: "no-convertible-files" });
  assert.deepEqual(conversionPlan([row({ state: "failed", hasSourceInfo: false })], "jpeg"), {
    kind: "no-convertible-files",
  });
});

test("a mixed batch plans each row with its own dimensions", () => {
  assert.deepEqual(
    conversionPlan([
      row({ path: "original", targetDimension: "" }),
      row({ path: "square", targetDimension: "2048 * 2048" }),
      row({ path: "wide", targetDimension: "4096 * 1024" }),
    ], "webp"),
    {
      kind: "ready",
      jobs: [
        { path: "original", resize: { mode: "original" } },
        { path: "square", resize: { mode: "exact", width: 2048, height: 2048 } },
        { path: "wide", resize: { mode: "exact", width: 4096, height: 1024 } },
      ],
    },
  );
});

test("the first invalid row is identified without starting a partial batch", () => {
  assert.deepEqual(
    conversionPlan([
      row({ path: "valid", targetDimension: "2048 * 2048" }),
      row({ path: "invalid", targetDimension: "1023 * 2048" }),
      row({ path: "later", targetDimension: "2048 * 2048" }),
    ], "jpeg"),
    { kind: "invalid-dimension", path: "invalid" },
  );
});

test("Convert enables only for a complete safe plan", () => {
  assert.equal(convertButtonEnabled([row()], "jpeg", false, false, false), true);
  assert.equal(convertButtonEnabled([], "jpeg", false, false, false), false);
  assert.equal(convertButtonEnabled([row()], "", false, false, false), false);
  assert.equal(convertButtonEnabled([row()], "jpeg", false, true, false), false);
});

test("Cancel remains enabled in flight then disables after one request", () => {
  assert.equal(convertButtonEnabled([row()], "jpeg", true, false, false), true);
  assert.equal(convertButtonEnabled([row()], "jpeg", true, false, true), false);
});

test("compression quality is finite, integral, plus clamped to 40 through 100", () => {
  assert.equal(compressionQuality(40), 40);
  assert.equal(compressionQuality(100), 100);
  assert.equal(compressionQuality(39), 40);
  assert.equal(compressionQuality(101), 100);
  assert.equal(compressionQuality(80.6), 81);
  assert.equal(compressionQuality(Number.NaN), 80);
  assert.equal(compressionQuality(Number.POSITIVE_INFINITY), 80);
});

test("progress events map to the finalized row labels", () => {
  assert.deepEqual(progressPresentation("done"), { state: "done", detail: "Converted" });
  assert.deepEqual(progressPresentation("failed", "disk full"), {
    state: "failed", detail: "Failed", error: "disk full",
  });
  assert.deepEqual(progressPresentation("failed"), {
    state: "failed", detail: "Failed", error: "Unknown Error",
  });
  assert.deepEqual(progressPresentation("skipped"), { state: "cancelled", detail: "Cancelled" });
});
