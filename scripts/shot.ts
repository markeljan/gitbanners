#!/usr/bin/env bun
/**
 * Screenshot a page with headless Chromium. Used for visual checks during development.
 *
 *   bun scripts/shot.ts <url> <out.png> [--width 1280] [--height 800] [--full]
 *                       [--scheme dark|light] [--wait 500] [--selector "css"] [--scale 1]
 */
import { chromium } from "@playwright/test";

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    "usage: bun scripts/shot.ts <url> <out.png> [--width n] [--height n] [--full] [--scheme dark|light] [--wait ms] [--selector css] [--scale n]",
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

const width = Number(flag("width") ?? 1280);
const height = Number(flag("height") ?? 800);
const scheme = (flag("scheme") ?? "dark") as "dark" | "light";
const wait = Number(flag("wait") ?? 400);
const selector = flag("selector");
const scale = Number(flag("scale") ?? 1);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 45_000,
  });
  await page.waitForTimeout(wait);
  if (selector) {
    await page.locator(selector).first().screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: rest.includes("--full") });
  }
  console.log(
    JSON.stringify({
      status: res?.status(),
      out,
      consoleErrors: errors.slice(0, 10),
    }),
  );
} finally {
  await browser.close();
}
