import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionsAreValid, formatDimensionInput, parseDimensions } from "../src/dimension.ts";

test("inserts space-star-space immediately after the fourth digit", () => {
  assert.equal(formatDimensionInput("1024"), "1024 * ");
});

test("inserts space-star-space before the fifth digit", () => {
  assert.equal(formatDimensionInput("10247"), "1024 * 7");
});

test("formats eight pasted digits", () => {
  assert.equal(formatDimensionInput("10247680"), "1024 * 7680");
});

test("normalizes a manually typed separator", () => {
  assert.equal(formatDimensionInput("1024*1234"), "1024 * 1234");
});

test("rejects extra digits", () => {
  assert.equal(formatDimensionInput("102476801234"), "1024 * 7680");
});

test("parses the completed display format", () => {
  assert.deepEqual(parseDimensions("1024 * 7680"), { width: 1024, height: 7680 });
});

test("accepts both inclusive boundaries", () => {
  assert.equal(dimensionsAreValid("1024 * 7680"), true);
  assert.equal(dimensionsAreValid("7680 * 1024"), true);
});

test("rejects values outside either boundary", () => {
  assert.equal(dimensionsAreValid("1023 * 7680"), false);
  assert.equal(dimensionsAreValid("1024 * 7681"), false);
});

test("rejects incomplete input", () => {
  assert.equal(dimensionsAreValid("1024"), false);
  assert.equal(dimensionsAreValid("1024 * 7"), false);
});
