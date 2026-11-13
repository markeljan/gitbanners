import { describe, expect, test } from "bun:test";
import { browserImage, fitScale, percentRect } from "./scale";

describe("fitScale", () => {
  test("shrinks a banner to a narrower container", () => {
    expect(fitScale(423, 846)).toBe(0.5);
    expect(fitScale(358, 846)).toBeCloseTo(0.4232, 4);
  });
  test("never magnifies beyond the limit", () => {
    expect(fitScale(1200, 846)).toBe(1);
    expect(fitScale(1200, 495, 2)).toBe(2);
    expect(fitScale(742.5, 495, 2)).toBe(1.5);
    expect(fitScale(2000, 846, Number.POSITIVE_INFINITY)).toBeCloseTo(
      2.3641,
      4,
    );
  });
  test("snaps to 1 when the difference would only blur the text", () => {
    expect(fitScale(845, 846)).toBe(1);
    expect(fitScale(847.5, 846, 2)).toBe(1);
    expect(fitScale(840, 846)).toBeCloseTo(0.9929, 4);
  });
  test("is 1 until there is something to measure", () => {
    expect(fitScale(0, 846)).toBe(1);
    expect(fitScale(Number.NaN, 846)).toBe(1);
    expect(fitScale(500, 0)).toBe(1);
  });
  test("a nonsensical limit falls back to no magnification", () => {
    expect(fitScale(1200, 846, 0)).toBe(1);
    expect(fitScale(1200, 846, -3)).toBe(1);
  });
});

describe("browserImage", () => {
  const avatar =
    "https://avatars.githubusercontent.com/u/12901349?s=256&u=77e9&v=4";
  test("asks GitHub for twice the drawn size, rounded up to a step", () => {
    expect(new URL(browserImage(avatar, 56)).searchParams.get("s")).toBe("128");
    expect(new URL(browserImage(avatar, 20)).searchParams.get("s")).toBe("40");
    expect(new URL(browserImage(avatar, 24)).searchParams.get("s")).toBe("64");
    expect(new URL(browserImage(avatar, 100)).searchParams.get("s")).toBe(
      "256",
    );
  });
  test("never asks for more than GitHub serves", () => {
    expect(new URL(browserImage(avatar, 400)).searchParams.get("s")).toBe(
      "460",
    );
  });
  test("keeps the other parameters", () => {
    const url = new URL(browserImage(avatar, 56));
    expect(url.searchParams.get("u")).toBe("77e9");
    expect(url.searchParams.get("v")).toBe("4");
  });
  test("leaves other hosts, data URIs and junk alone", () => {
    expect(browserImage("https://example.com/a.png?s=1", 56)).toBe(
      "https://example.com/a.png?s=1",
    );
    expect(browserImage("data:image/svg+xml,%3Csvg/%3E", 56)).toBe(
      "data:image/svg+xml,%3Csvg/%3E",
    );
    expect(browserImage("not a url", 56)).toBe("not a url");
  });
});

describe("percentRect", () => {
  test("places the X photo zone on its canvas", () => {
    expect(
      percentRect(
        { x: 0, y: 300, width: 430, height: 200 },
        { width: 1500, height: 500 },
      ),
    ).toEqual({ left: "0%", top: "60%", width: "28.67%", height: "40%" });
  });
  test("an empty canvas gives zeros, not NaN", () => {
    expect(
      percentRect({ x: 1, y: 1, width: 1, height: 1 }, { width: 0, height: 0 }),
    ).toEqual({ left: "0%", top: "0%", width: "0%", height: "0%" });
  });
});
