import { expect, test } from "bun:test";
import { readTheme, themeQuery, withTheme } from "./theme-query";

test("the default theme leaves URLs alone", () => {
  expect(themeQuery("github-dark")).toBe("");
  expect(withTheme("/vercel.svg", "github-dark")).toBe("/vercel.svg");
});

test("a theme is written in canonical order", () => {
  expect(withTheme("/vercel.svg", "dracula")).toBe("/vercel.svg?theme=dracula");
  expect(withTheme("/vercel/repos.svg?size=x", "nord")).toBe(
    "/vercel/repos.svg?size=x&theme=nord",
  );
});

test("unknown ids read as the default", () => {
  expect(readTheme("no-such-theme")).toBe("github-dark");
  expect(readTheme(null)).toBe("github-dark");
  expect(readTheme("dracula")).toBe("dracula");
});
