import { describe, expect, test } from "bun:test";
import { FREE, PRO } from "@/lib/pro/entitlements";
import { hasSessionHint, parseMe } from "./use-me";

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

describe("parseMe", () => {
  const banners = { count: 2, max: 50 };
  test("reads a signed-in body, with the id as the store keeps it", () => {
    const me = parseMe({
      user: {
        id: "12901349",
        login: "markeljan",
        name: null,
        avatarUrl: "https://avatars.githubusercontent.com/u/12901349?v=4",
      },
      pro: true,
      entitlements: PRO,
      banners,
    });
    expect(me.user?.id).toBe("12901349");
    expect(me.user?.login).toBe("markeljan");
    expect(me.pro).toBe(true);
    expect(me.entitlements.maxSavedBanners).toBe(50);
  });
  test("a numeric id is accepted and normalised", () => {
    const me = parseMe({
      user: { id: 7, login: "a", name: "A", avatarUrl: "" },
      pro: false,
      entitlements: FREE,
      banners,
    });
    expect(me.user?.id).toBe("7");
  });
  test("reads the anonymous body", () => {
    const me = parseMe({
      user: null,
      pro: false,
      entitlements: FREE,
      banners: { count: 0, max: 3 },
    });
    expect(me.user).toBeNull();
    expect(me.entitlements.plan).toBe("free");
  });
  test("rejects a problem document", () => {
    expect(() =>
      parseMe({ status: 503, code: "unavailable", title: "Unavailable" }),
    ).toThrow();
  });
});
