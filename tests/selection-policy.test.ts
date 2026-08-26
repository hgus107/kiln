import test from "node:test";
import assert from "node:assert/strict";
import {
  activeAfterRemovals,
  arrowSelection,
  clickSelection,
  keyboardDeleteAllowed,
  isSelectAllShortcut,
  rangeBetween,
  selectAll,
} from "../src/selection-policy.ts";

const paths = ["a", "b", "c", "d", "e"];

test("a plain click selects exactly one row even when modifier keys are ignored by the caller", () => {
  assert.deepEqual(clickSelection(paths, "b", "b", "d", false), {
    selected: ["d"], active: "d", anchor: "d",
  });
});

test("Shift+Click selects inclusive ranges forward plus backward", () => {
  assert.deepEqual(rangeBetween(paths, "b", "e"), ["b", "c", "d", "e"]);
  assert.deepEqual(rangeBetween(paths, "d", "a"), ["a", "b", "c", "d"]);
});

test("Shift+Click preserves the original anchor while changing the active row", () => {
  assert.deepEqual(clickSelection(paths, "b", "b", "e", true), {
    selected: ["b", "c", "d", "e"], active: "e", anchor: "b",
  });
});

test("plain Arrow selects one adjacent row", () => {
  assert.deepEqual(arrowSelection(paths, "c", "c", 1, false).selected, ["d"]);
  assert.deepEqual(arrowSelection(paths, "c", "c", -1, false).selected, ["b"]);
});

test("Arrow stops safely at the first plus last boundaries", () => {
  assert.deepEqual(arrowSelection(paths, "a", "a", -1, false).selected, ["a"]);
  assert.deepEqual(arrowSelection(paths, "e", "e", 1, false).selected, ["e"]);
});

test("Shift+Arrow extends then shrinks the range around one fixed anchor", () => {
  const extended = arrowSelection(paths, "b", "b", 1, true);
  assert.deepEqual(extended, { selected: ["b", "c"], active: "c", anchor: "b" });
  assert.deepEqual(arrowSelection(paths, extended.active, extended.anchor, -1, true), {
    selected: ["b"], active: "b", anchor: "b",
  });
});

test("Arrow with no active row safely starts at the appropriate boundary", () => {
  assert.equal(arrowSelection(paths, "", "", 1, false).active, "a");
  assert.equal(arrowSelection(paths, "", "", -1, false).active, "e");
});

test("Select All selects every row while preserving a valid active row", () => {
  assert.deepEqual(selectAll(paths, "c"), { selected: paths, active: "c", anchor: "c" });
  assert.equal(selectAll(paths, "missing").active, "a");
  assert.deepEqual(selectAll([], ""), { selected: [], active: "", anchor: "" });
});

test("Command+A works only as the Mac Select All shortcut", () => {
  assert.equal(isSelectAllShortcut("a", true, false, true), true);
  assert.equal(isSelectAllShortcut("A", true, false, true), true);
  assert.equal(isSelectAllShortcut("a", false, true, true), false);
});

test("Control+A works only as the Windows Select All shortcut", () => {
  assert.equal(isSelectAllShortcut("a", false, true, false), true);
  assert.equal(isSelectAllShortcut("A", false, true, false), true);
  assert.equal(isSelectAllShortcut("a", true, false, false), false);
  assert.equal(isSelectAllShortcut("b", false, true, false), false);
});

test("bulk removal chooses the next survivor then the previous survivor", () => {
  assert.equal(activeAfterRemovals(paths, "b", new Set(["b", "c"])), "d");
  assert.equal(activeAfterRemovals(paths, "e", new Set(["d", "e"])), "c");
});

test("bulk removal preserves an active row that was not removed", () => {
  assert.equal(activeAfterRemovals(paths, "c", new Set(["a", "e"])), "c");
});

test("removing every row leaves no active row", () => {
  assert.equal(activeAfterRemovals(paths, "c", new Set(paths)), "");
});

test("Delete plus Backspace work only with a selectable queue context", () => {
  assert.equal(keyboardDeleteAllowed("Delete", 2, false, false, false), true);
  assert.equal(keyboardDeleteAllowed("Backspace", 1, false, false, false), true);
  assert.equal(keyboardDeleteAllowed("Enter", 2, false, false, false), false);
  assert.equal(keyboardDeleteAllowed("Delete", 0, false, false, false), false);
  assert.equal(keyboardDeleteAllowed("Delete", 2, true, false, false), false);
  assert.equal(keyboardDeleteAllowed("Delete", 2, false, true, false), false);
  assert.equal(keyboardDeleteAllowed("Backspace", 2, false, false, true), false);
});
