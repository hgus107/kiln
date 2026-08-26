import assert from "node:assert/strict";
import test from "node:test";

import { filenameTimestamp } from "../src/timestamp.ts";

test("formats a filename-safe local timestamp", () => {
  const value = filenameTimestamp(new Date(2026, 7, 24, 13, 12, 5));
  assert.equal(value, "20260824-131205");
});

test("pads every single-digit date and time component", () => {
  const value = filenameTimestamp(new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(value, "20260102-030405");
});

test("contains no filename-reserved separators", () => {
  const value = filenameTimestamp(new Date(2026, 7, 24, 13, 12, 5));
  assert.doesNotMatch(value, /[:/\\]/);
});
