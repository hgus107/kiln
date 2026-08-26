import test from "node:test";
import assert from "node:assert/strict";
import { activeAfterRemoval, removePolicy, removeSelectionPolicy } from "../src/remove-policy.ts";

test("queued, failed, cancelled, and saved rows remove without confirmation", () => {
  for (const state of ["queued", "failed", "cancelled", "saved"]) {
    assert.equal(removePolicy({ state }, false).requiresDiscardConfirmation, false);
  }
});

test("an unsaved converted result requires confirmation", () => {
  assert.deepEqual(removePolicy({ state: "done", output: "/scratch/a.jpg" }, false), {
    enabled: true,
    requiresDiscardConfirmation: true,
    requiresScratchCleanup: true,
  });
});

test("a failed save that retains a scratch result requires confirmation", () => {
  assert.equal(
    removePolicy({ state: "failed", output: "/scratch/a.jpg" }, false).requiresDiscardConfirmation,
    true,
  );
});

test("a saved row cleans its scratch copy without confirmation", () => {
  assert.deepEqual(removePolicy({ state: "saved", output: "/scratch/a.jpg" }, false), {
    enabled: true,
    requiresDiscardConfirmation: false,
    requiresScratchCleanup: true,
  });
});

test("remove is disabled throughout conversion", () => {
  assert.deepEqual(removePolicy({ state: "done", output: "/scratch/a.jpg" }, true), {
    enabled: false,
    requiresDiscardConfirmation: false,
    requiresScratchCleanup: false,
  });
});

test("an empty selection cannot be removed", () => {
  assert.equal(removeSelectionPolicy([], false).enabled, false);
});

test("a mixed bulk selection asks once when any result is unsaved", () => {
  assert.deepEqual(
    removeSelectionPolicy([
      { state: "queued" },
      { state: "saved", output: "/scratch/saved.jpg" },
      { state: "done", output: "/scratch/unsaved.jpg" },
      { state: "failed" },
    ], false),
    { enabled: true, requiresDiscardConfirmation: true, requiresScratchCleanup: true },
  );
});

test("saved, failed, cancelled, plus queued bulk rows remove without confirmation", () => {
  assert.equal(
    removeSelectionPolicy([
      { state: "saved", output: "/scratch/saved.jpg" },
      { state: "failed" },
      { state: "cancelled" },
      { state: "queued" },
    ], false).requiresDiscardConfirmation,
    false,
  );
});

test("conversion disables an entire bulk removal", () => {
  assert.equal(removeSelectionPolicy([{ state: "queued" }, { state: "failed" }], true).enabled, false);
});

test("removing the first or middle active row selects the next row", () => {
  const paths = ["a", "b", "c"];
  assert.equal(activeAfterRemoval(paths, "a", "a"), "b");
  assert.equal(activeAfterRemoval(paths, "b", "b"), "c");
});

test("removing the last active row selects the previous row", () => {
  assert.equal(activeAfterRemoval(["a", "b", "c"], "c", "c"), "b");
});

test("removing the only active row leaves no selection", () => {
  assert.equal(activeAfterRemoval(["a"], "a", "a"), "");
});

test("removing a nonactive row preserves the active row", () => {
  assert.equal(activeAfterRemoval(["a", "b", "c"], "b", "a"), "b");
});
