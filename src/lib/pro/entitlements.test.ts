import { expect, test } from "bun:test";
import { entitlementsFor, FREE, PRO } from "./entitlements";

test("free plan", () => {
  expect(FREE).toEqual({
    plan: "free",
    maxSavedBanners: 3,
    canHideBrand: false,
    canAnimate: false,
    canSetDefault: false,
    refreshSeconds: 900,
  });
});

test("pro plan", () => {
  expect(PRO).toEqual({
    plan: "pro",
    maxSavedBanners: 50,
    canHideBrand: true,
    canAnimate: true,
    canSetDefault: true,
    refreshSeconds: 300,
  });
});

test("entitlementsFor picks the plan", () => {
  expect(entitlementsFor(false)).toBe(FREE);
  expect(entitlementsFor(true)).toBe(PRO);
});

test("the shared plan objects cannot be modified by a caller", () => {
  expect(Object.isFrozen(FREE)).toBe(true);
  expect(Object.isFrozen(PRO)).toBe(true);
  expect(() => {
    (entitlementsFor(false) as { maxSavedBanners: number }).maxSavedBanners =
      99;
  }).toThrow();
  expect(FREE.maxSavedBanners).toBe(3);
});
