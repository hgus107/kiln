import assert from "node:assert/strict";
import test from "node:test";

import { chooseFilesEnabled, selectionNotice, uniqueNewPaths } from "../src/choose-files-policy.ts";

test("Choose Files is enabled for an empty queue", () => {
  assert.equal(chooseFilesEnabled([], false, false), true);
});

test("Choose Files stays enabled for queued, failed, plus cancelled rows", () => {
  assert.equal(
    chooseFilesEnabled([{ state: "queued" }, { state: "failed" }, { state: "cancelled" }], false, false),
    true,
  );
});

test("Choose Files is disabled while the picker is open", () => {
  assert.equal(chooseFilesEnabled([], false, true), false);
});

test("Choose Files is disabled while conversion is running", () => {
  assert.equal(chooseFilesEnabled([{ state: "working" }], true, false), false);
});

test("Choose Files is disabled while one converted result is unsaved", () => {
  assert.equal(chooseFilesEnabled([{ state: "done", output: "/tmp/result.jpg" }], false, false), false);
});

test("a failed save retaining a temporary result keeps Choose Files disabled", () => {
  assert.equal(chooseFilesEnabled([{ state: "failed", output: "/tmp/result.jpg" }], false, false), false);
});

test("saved results do not keep Choose Files disabled", () => {
  assert.equal(chooseFilesEnabled([{ state: "saved", output: "/tmp/result.jpg" }], false, false), true);
});

test("duplicates inside one selection plus existing queue paths are removed", () => {
  const existing = new Set(["/images/a.jpg"]);
  assert.deepEqual(
    uniqueNewPaths(["/images/a.jpg", "/images/b.jpg", "/images/b.jpg", "/images/c.png"], existing),
    ["/images/b.jpg", "/images/c.png"],
  );
});

test("an all-duplicate selection adds nothing", () => {
  const existing = new Set(["/images/a.jpg"]);
  assert.deepEqual(uniqueNewPaths(["/images/a.jpg", "/images/a.jpg"], existing), []);
});

test("an unsupported-only selection reports no supported images", () => {
  assert.deepEqual(selectionNotice(1, 0, 0, 1, false), { kind: "no-supported" });
});

test("a duplicate plus an unsupported file still reports the unsupported file", () => {
  assert.deepEqual(selectionNotice(2, 1, 0, 1, false), { kind: "unsupported", count: 1 });
});

test("a mixed supported plus unsupported selection reports the ignored count", () => {
  assert.deepEqual(selectionNotice(4, 2, 2, 2, false), { kind: "unsupported", count: 2 });
});

test("cancelled plus all-supported selections show no warning", () => {
  assert.deepEqual(selectionNotice(0, 0, 0, 0, false), { kind: "none" });
  assert.deepEqual(selectionNotice(2, 2, 2, 0, false), { kind: "none" });
});

test("a truncated folder reports the file limit plus ignored count", () => {
  assert.deepEqual(selectionNotice(1, 20_000, 20_000, 7, true), { kind: "limit", ignored: 7 });
});

test("folder depth plus unreadable folder boundaries report explicit notices", () => {
  assert.deepEqual(selectionNotice(1, 1, 1, 0, false, true, 0), { kind: "folder-depth" });
  assert.deepEqual(selectionNotice(1, 0, 0, 0, false, false, 2), {
    kind: "unreadable-folders",
    count: 2,
  });
});
