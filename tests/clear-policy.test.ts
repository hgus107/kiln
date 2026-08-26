import assert from "node:assert/strict";
import test from "node:test";

import { clearPolicy } from "../src/clear-policy.ts";

test("empty queue disables Clear", () => {
  assert.deepEqual(clearPolicy([], false), {
    enabled: false,
    requiresDiscardConfirmation: false,
  });
});

test("one queued file enables Clear without confirmation", () => {
  assert.deepEqual(clearPolicy([{ state: "queued" }], false), {
    enabled: true,
    requiresDiscardConfirmation: false,
  });
});

test("five hundred queued files use the same direct-clear policy", () => {
  const rows = Array.from({ length: 500 }, () => ({ state: "queued" }));
  assert.deepEqual(clearPolicy(rows, false), {
    enabled: true,
    requiresDiscardConfirmation: false,
  });
});

test("running conversion disables Clear even with queued files", () => {
  assert.deepEqual(clearPolicy([{ state: "working" }], true), {
    enabled: false,
    requiresDiscardConfirmation: false,
  });
});

test("one unsaved converted result requires confirmation", () => {
  assert.deepEqual(clearPolicy([{ state: "done", output: "/tmp/result.jpg" }], false), {
    enabled: true,
    requiresDiscardConfirmation: true,
  });
});

test("mixed converted, failed, plus cancelled rows require one confirmation", () => {
  const rows = [
    { state: "done", output: "/tmp/result.jpg" },
    { state: "failed" },
    { state: "cancelled" },
  ];
  assert.deepEqual(clearPolicy(rows, false), {
    enabled: true,
    requiresDiscardConfirmation: true,
  });
});

test("failed save retaining a temporary result still requires confirmation", () => {
  assert.deepEqual(clearPolicy([{ state: "failed", output: "/tmp/result.jpg" }], false), {
    enabled: true,
    requiresDiscardConfirmation: true,
  });
});

test("saved, failed, plus cancelled rows clear directly", () => {
  const rows = [
    { state: "saved", output: "/tmp/result.jpg" },
    { state: "failed" },
    { state: "cancelled" },
  ];
  assert.deepEqual(clearPolicy(rows, false), {
    enabled: true,
    requiresDiscardConfirmation: false,
  });
});

test("twenty-seven saved plus three conversion failures clear directly without a popup", () => {
  const rows = [
    ...Array.from({ length: 27 }, (_, index) => ({
      state: "saved",
      output: `/tmp/saved-${index}.jpg`,
    })),
    ...Array.from({ length: 3 }, () => ({ state: "failed" })),
  ];
  assert.deepEqual(clearPolicy(rows, false), {
    enabled: true,
    requiresDiscardConfirmation: false,
  });
});

test("Clear is disabled while a save is in flight", () => {
  assert.deepEqual(clearPolicy([{ state: "saved", output: "/tmp/saved.jpg" }], true), {
    enabled: false,
    requiresDiscardConfirmation: false,
  });
});

test("a saved scratch copy never triggers the unsaved warning", () => {
  assert.deepEqual(clearPolicy([{ state: "saved", output: "/tmp/saved-result.jpg" }], false), {
    enabled: true,
    requiresDiscardConfirmation: false,
  });
});
