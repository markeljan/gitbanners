import { describe, expect, test } from "bun:test";
import { hasSessionHint } from "./use-me";

describe("hasSessionHint", () => {
  test("finds the hint cookie, with or without the __Host- prefix", () => {
    expect(hasSessionHint("gb_in=1")).toBe(true);
    expect(hasSessionHint("theme=dark; gb_in=1; other=2")).toBe(true);
    expect(hasSessionHint("a=b; __Host-gb_in=1")).toBe(true);
  });
  test("ignores look-alikes", () => {
    expect(hasSessionHint("")).toBe(false);
    expect(hasSessionHint("gb_in=0")).toBe(false);
    expect(hasSessionHint("xgb_in=1")).toBe(false);
    expect(hasSessionHint("gb_session=abc")).toBe(false);
  });
});
