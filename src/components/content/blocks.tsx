import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import type { Block } from "@/content/types";
import {
  buildBanner,
  parseBannerPath,
  parseOptions,
  resolveOptions,
} from "@/lib/banner";
import { getSample } from "@/lib/github/samples";
import { site } from "@/lib/site";
import { Inline } from "./inline";

/**
 * Highlighters the design system ships, by the `lang` hints content uses.
 * CodeBlock prints the highlighter's name as the sample's language label and
 * brings its own copy button.
 */
const LANGUAGES: Record<string, string> = {
  bash: "bash",
  sh: "bash",
  html: "html",
  json: "json",
  md: "markdown",
  ts: "ts",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * Pixel size of a banner, when a bundled sample of its target exists: enough
 * to reserve the image's box before it loads. `null` for any other target.
 */
function bannerBox(path: string): { width: number; height: number } | null {
  const [pathname, query = ""] = path.split("?");
  const parsed = parseBannerPath(pathname.split("/").filter(Boolean));
  const entity = parsed ? getSample(parsed.target) : null;
  if (!parsed || !entity) return null;
  const options = resolveOptions(
    entity.kind,
    parsed.preset,
    parseOptions(new URLSearchParams(query)),
  );
  const built = buildBanner(entity, options, {
    image: () => "",
    now: new Date(entity.fetchedAt),
    host: new URL(site.url).host,
  });
  return { width: built.width, height: built.height };
}

/**
 * Relative image URL of a `banner` block. Relative on purpose: the page then
 * shows its banners on any host it is served from, previews included.
 */
function bannerSrc(path: string): string {
  const [pathname, query] = path.split("?");
  return `${pathname}.svg${query ? `?${query}` : ""}`;
}

function Table({ block }: { block: Extract<Block, { type: "table" }> }) {
  return (
    <div className="gb-table">
      <table>
        <thead>
          <tr>
            {block.head.map((cell, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns of static copy, never reordered
              <th key={index} scope="col">
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows of static copy, never reordered
            <tr key={rowIndex} id={block.rowIds?.[rowIndex]}>
              {row.map((cell, cellIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells of static copy, never reordered
                <td key={cellIndex}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One block of page copy as HTML. The Markdown twin is `blockToMarkdown`. */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "note":
      return (
        <p className="gb-note">
          <Inline text={block.text} />
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List>
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items of static copy, never reordered
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </List>
      );
    }
    case "code":
      return (
        <div className="gb-code">
          <CodeBlock
            code={block.code}
            language={LANGUAGES[block.lang] ?? "plaintext"}
            title={block.caption}
            width="100%"
          />
        </div>
      );
    case "table":
      return <Table block={block} />;
    case "banner": {
      const box = bannerBox(block.path);
      return (
        <figure className="gb-banner">
          <a href={block.path.split("?")[0]}>
            {/* biome-ignore lint/performance/noImgElement: a live SVG from our own image route; next/image would rasterize and re-cache it */}
            <img
              src={bannerSrc(block.path)}
              alt={block.alt}
              width={box?.width}
              height={box?.height}
              loading="lazy"
              decoding="async"
            />
          </a>
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    }
  }
}
