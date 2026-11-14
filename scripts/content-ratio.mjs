#!/usr/bin/env node
// Content checks for server-rendered pages, as the "content-no-js" probe of
// is-agentic.com (Ora) reads them: enough text in the raw HTML, a sane
// heading outline, and text that is not drowned in markup.
//
//   node scripts/content-ratio.mjs [base-url] [path ...]
//   node scripts/content-ratio.mjs --file page.html [...]
//
// Default base: http://localhost:3000. Default paths: the content pages.
// Exits 1 when a page misses a threshold.
//
// "Ratio" is visible text divided by the bytes of the HTML without <script>
// elements: the definition that reproduces the scanner's published numbers
// for two of five sites measured (the inline RSC payload does not count, class
// strings, inline styles and inline SVG do). The ratio against the whole
// document is printed too; it is the most pessimistic reading.
import { readFileSync } from "node:fs";

const MIN_TEXT = 500;
const MIN_RATIO = 5;
const DEFAULT_PATHS = [
  "/",
  "/docs",
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
];

const bytes = (text) => Buffer.byteLength(text);
const withoutScripts = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ");
const withoutStyles = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, " ");
const visibleText = (html) =>
  withoutStyles(withoutScripts(html))
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export function measure(html) {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const text = visibleText(body);
  const noScript = withoutScripts(html);
  const headings = [...withoutScripts(body).matchAll(/<h([1-6])[\s>]/gi)].map(
    (match) => Number(match[1]),
  );
  const problems = [];
  if (text.length < MIN_TEXT) {
    problems.push(`${text.length} characters of text, need ${MIN_TEXT}`);
  }
  const ratio = (100 * text.length) / bytes(noScript);
  if (ratio < MIN_RATIO) {
    problems.push(`ratio ${ratio.toFixed(1)}%, need ${MIN_RATIO}%`);
  }
  const h1s = headings.filter((level) => level === 1).length;
  if (h1s !== 1) problems.push(`${h1s} <h1> elements, need exactly 1`);
  if (headings[0] !== 1) problems.push("the first heading is not the <h1>");
  const skip = headings.findIndex(
    (level, index) => index > 0 && level - headings[index - 1] > 1,
  );
  if (skip !== -1) {
    problems.push(
      `heading levels skip: h${headings[skip - 1]} is followed by h${headings[skip]}`,
    );
  }
  return {
    text: text.length,
    total: bytes(html),
    noScript: bytes(noScript),
    ratio,
    ratioTotal: (100 * text.length) / bytes(html),
    headings: headings.length,
    problems,
  };
}

async function load(args) {
  if (args[0] === "--file") {
    return args.slice(1).map((file) => ({
      name: file,
      html: readFileSync(file, "utf8"),
    }));
  }
  const base = (
    args[0]?.startsWith("http") ? args[0] : "http://localhost:3000"
  ).replace(/\/$/, "");
  const paths = args.filter((arg) => arg.startsWith("/"));
  const pages = [];
  for (const path of paths.length > 0 ? paths : DEFAULT_PATHS) {
    const response = await fetch(base + path, {
      headers: { accept: "text/html" },
    });
    pages.push({
      name: path,
      html: await response.text(),
      status: response.status,
    });
  }
  return pages;
}

const pages = await load(process.argv.slice(2));
let failed = 0;
console.log(
  "page".padEnd(12),
  "text".padStart(7),
  "html".padStart(8),
  "no-script".padStart(10),
  "ratio".padStart(7),
  "vs total".padStart(9),
  "headings".padStart(9),
);
for (const page of pages) {
  const result = measure(page.html);
  if (page.status !== undefined && page.status !== 200) {
    result.problems.unshift(`HTTP ${page.status}`);
  }
  console.log(
    page.name.padEnd(12),
    String(result.text).padStart(7),
    String(result.total).padStart(8),
    String(result.noScript).padStart(10),
    `${result.ratio.toFixed(1)}%`.padStart(7),
    `${result.ratioTotal.toFixed(1)}%`.padStart(9),
    String(result.headings).padStart(9),
    result.problems.length > 0 ? ` FAIL: ${result.problems.join("; ")}` : " ok",
  );
  if (result.problems.length > 0) failed += 1;
}
process.exit(failed > 0 ? 1 : 0);
