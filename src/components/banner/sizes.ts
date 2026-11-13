import { SIZE_FACTS, SIZES, type SizeId } from "@/lib/banner";

/** "1500 × 500" or "846 × auto": the canvas in pixels. */
export function sizeDimensions(id: SizeId): string {
  const size = SIZES[id];
  return `${size.width} × ${size.height ?? "auto"}`;
}

/** Width over height of a canvas. README cards vary; 846 by 266 is the usual overview. */
export function sizeRatio(id: SizeId): number {
  const size = SIZES[id];
  return size.width / (size.height ?? 266);
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 100_000) / 10} MB`;
}

/**
 * What people need to know before they use a size: whether the destination
 * can load a live URL or needs an upload, its file limits, and what covers
 * part of the image there. Limits come from `SIZE_FACTS`.
 */
export function sizeHint(id: SizeId): string {
  const facts = SIZE_FACTS[id];
  const limit = facts.maxBytes ? `, under ${megabytes(facts.maxBytes)}` : "";
  switch (id) {
    case "readme":
      return "Embedded by URL, so the image updates itself. GitHub scales it to the README column, which is about 300 px wide on a phone: the compact card preset reads best there.";
    case "x":
      return "Headers on X are uploads: download a fresh PNG when you want to update it. Your profile photo covers the dashed area.";
    case "linkedin":
      return `LinkedIn banners are uploads (JPG or PNG${limit}): download a fresh PNG to update it. Your profile photo covers the dashed area.`;
    case "og":
      return "For link previews in chats and feeds. Use the PNG URL as the og:image of a page and the preview stays current.";
    case "social":
      return `Upload this in your repository settings under Social preview. GitHub accepts PNG, JPG or GIF files${limit}.`;
    case "square":
      return "For feed posts. An upload: download a fresh PNG when you want to update it.";
  }
}
