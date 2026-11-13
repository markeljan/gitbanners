import { describe, expect, test } from "bun:test";
import { collapseDiff, diffLines } from "./diff";

describe("diffLines", () => {
  test("identical texts are all the same", () => {
    const lines = diffLines("a\nb", "a\nb");
    expect(lines.map((line) => line.type)).toEqual(["same", "same"]);
  });

  test("a changed line is a removal followed by an addition", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "same", text: "a", before: 1, after: 1 },
      { type: "remove", text: "b", before: 2 },
      { type: "add", text: "B", after: 2 },
      { type: "same", text: "c", before: 3, after: 3 },
    ]);
  });

  test("insertions and deletions keep both line numbers right", () => {
    const lines = diffLines("a\nb\nc\nd", "a\nc\nx\nd");
    expect(lines).toEqual([
      { type: "same", text: "a", before: 1, after: 1 },
      { type: "remove", text: "b", before: 2 },
      { type: "same", text: "c", before: 3, after: 2 },
      { type: "add", text: "x", after: 3 },
      { type: "same", text: "d", before: 4, after: 4 },
    ]);
  });

  test("empty texts", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("", "a")).toEqual([{ type: "add", text: "a", after: 1 }]);
  });

  test("Windows line endings compare equal to Unix ones", () => {
    expect(
      diffLines("a\r\nb", "a\nb").every((line) => line.type === "same"),
    ).toBe(true);
  });
});

describe("collapseDiff", () => {
  test("folds unchanged runs outside the context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10");
    const rows = collapseDiff(diffLines(before, after), 2);
    expect(rows.map((row) => row.type)).toEqual([
      "skip",
      "same",
      "same",
      "remove",
      "add",
      "same",
      "same",
      "skip",
    ]);
    expect(rows[0]).toEqual({ type: "skip", count: 8 });
    expect(rows.at(-1)).toEqual({ type: "skip", count: 7 });
  });
});
