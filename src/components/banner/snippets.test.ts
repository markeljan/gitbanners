import { describe, expect, test } from "bun:test";
import { SNIPPET_KINDS, snippetsFor } from "./snippets";

const input = {
  target: { kind: "repo", owner: "vercel", name: "next.js" } as const,
  preset: "contributors",
  query: "theme=dracula",
  alt: 'Contributors of "next.js"',
  origin: "https://banners.example",
};

describe("snippetsFor", () => {
  test("SVG snippets point at the .svg URL and link to the page", () => {
    const { snippets, links } = snippetsFor(input, "svg");
    const image =
      "https://banners.example/vercel/next.js/contributors.svg?theme=dracula";
    expect(links.svg).toBe(image);
    expect(snippets.url).toBe(image);
    expect(snippets.markdown).toBe(
      `[![Contributors of "next.js"](${image})](https://banners.example/vercel/next.js)`,
    );
    expect(snippets.html).toContain(`<img src="${image}"`);
    expect(snippets.html).toContain(
      'alt="Contributors of &quot;next.js&quot;"',
    );
  });

  test("PNG snippets use the .png URL everywhere", () => {
    const { snippets } = snippetsFor(input, "png");
    const image =
      "https://banners.example/vercel/next.js/contributors.png?theme=dracula";
    expect(snippets.url).toBe(image);
    expect(snippets.markdown).toContain(`(${image})`);
    expect(snippets.html).toContain(image);
    expect(snippets.picture).toContain("contributors.png?theme=github-dark");
    expect(snippets.picture).toContain("contributors.png?theme=github-light");
    expect(snippets.picture).not.toContain(".svg");
  });

  test("the picture snippet switches GitHub's own themes", () => {
    const { snippets } = snippetsFor(input, "svg");
    expect(snippets.picture).toContain('media="(prefers-color-scheme: dark)"');
    expect(snippets.picture).toContain("theme=github-dark");
    expect(snippets.picture).toContain("theme=github-light");
  });

  test("a width is only printed when asked for", () => {
    expect(snippetsFor(input, "svg").snippets.html).not.toContain("width=");
    expect(
      snippetsFor({ ...input, width: 1500 }, "svg").snippets.html,
    ).toContain('width="1500"');
    expect(
      snippetsFor({ ...input, width: null }, "svg").snippets.html,
    ).not.toContain("width=");
  });

  test("the default preset and an empty query leave a bare URL", () => {
    const { snippets } = snippetsFor(
      {
        target: { kind: "owner", login: "Torvalds" },
        alt: "GitHub banner for torvalds",
        origin: "https://banners.example/",
      },
      "svg",
    );
    expect(snippets.url).toBe("https://banners.example/torvalds.svg");
  });
});

describe("SNIPPET_KINDS", () => {
  test("covers every snippet once, in tab order", () => {
    expect(SNIPPET_KINDS.map((kind) => kind.id)).toEqual([
      "markdown",
      "html",
      "picture",
      "url",
    ]);
    const { snippets } = snippetsFor(input, "svg");
    for (const kind of SNIPPET_KINDS) {
      expect(snippets[kind.id].length).toBeGreaterThan(0);
    }
  });
});
