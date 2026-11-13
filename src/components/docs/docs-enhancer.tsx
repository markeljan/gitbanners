"use client";

import { useToast } from "@astryxdesign/core/Toast";
import "./docs.css";

import { type ChangeEvent, useEffect, useState } from "react";

interface Heading {
  id: string;
  title: string;
}

/** Below this width the table of contents is a box at the top, not a column. */
const WIDE = "(min-width: 64rem)";

/**
 * Progressive enhancement for a long content page rendered by
 * `ContentPageView` with `headingLinks`:
 *
 * - marks the "On this page" link of the section being read
 *   (`aria-current="location"`), following the scroll position;
 * - on a narrow screen, adds a "Jump to section" picker pinned to the
 *   bottom of the viewport that says where the reader is;
 * - copies a heading's address when its link is clicked, as well as
 *   following it.
 *
 * It renders nothing on the server and nothing on wide screens, so the page
 * HTML stays the same with or without it.
 */
export function DocsEnhancer() {
  const showToast = useToast();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const body = document.querySelector(".gb-body");
    if (!body) return;
    const all = [
      ...body.querySelectorAll<HTMLElement>(":scope > h2[id], :scope > h3[id]"),
    ];
    const top = all.filter((element) => element.tagName === "H2");
    setHeadings(
      top.map((element) => ({
        id: element.id,
        title: element.textContent?.trim() ?? element.id,
      })),
    );
    const tocLinks = new Map<string, HTMLAnchorElement>();
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      ".gb-toc a[href^='#']",
    )) {
      tocLinks.set(decodeURIComponent(link.hash.slice(1)), link);
    }

    // The section being read: the last heading that has passed the line
    // under the sticky header.
    let frame = 0;
    let current = "";
    const update = () => {
      frame = 0;
      // Headings carry the sticky header's height as their scroll margin.
      const first = all[0];
      const line =
        (first && Number.parseFloat(getComputedStyle(first).scrollMarginTop)) ||
        96;
      let id = all[0]?.id ?? "";
      for (const element of all) {
        // A quarter down the screen: a heading just below the header counts.
        const reading = Math.max(line, window.innerHeight / 4) + 8;
        if (element.getBoundingClientRect().top <= reading) id = element.id;
        else break;
      }
      if (id === current) return;
      tocLinks.get(current)?.removeAttribute("aria-current");
      const link = tocLinks.get(id);
      link?.setAttribute("aria-current", "location");
      // Keep the marked link visible in a table of contents taller than
      // the screen, without scrolling the page itself.
      const toc = link?.closest<HTMLElement>(".gb-toc");
      if (link && toc && toc.scrollHeight > toc.clientHeight) {
        const box = link.getBoundingClientRect();
        const frameBox = toc.getBoundingClientRect();
        if (box.top < frameBox.top || box.bottom > frameBox.bottom) {
          toc.scrollTop += box.top - frameBox.top - frameBox.height / 3;
        }
      }
      current = id;
      // The narrow picker lists level-2 sections: show the one containing `id`.
      const index = all.findIndex((element) => element.id === id);
      const parent = all
        .slice(0, index + 1)
        .reverse()
        .find((element) => element.tagName === "H2");
      setActive(parent?.id ?? "");
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    const media = window.matchMedia(WIDE);
    const onMedia = () => setNarrow(!media.matches);
    onMedia();
    media.addEventListener("change", onMedia);

    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a.gb-anchor")
          : null;
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const url = new URL(link.href, window.location.href).href;
      navigator.clipboard
        ?.writeText(url)
        .then(() =>
          showToast({ body: "Link copied", uniqueID: "heading-link-copied" }),
        )
        .catch(() => {
          // Following the link still worked; the address bar has it.
        });
    };
    body.addEventListener("click", onClick as EventListener);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      media.removeEventListener("change", onMedia);
      body.removeEventListener("click", onClick as EventListener);
      tocLinks.get(current)?.removeAttribute("aria-current");
    };
  }, [showToast]);

  if (!narrow || headings.length < 2) return null;

  const onJump = (event: ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav className="gb-jump" aria-label="Sections">
      <label className="gb-jump-label" htmlFor="gb-jump-select">
        Jump to section
      </label>
      <select
        id="gb-jump-select"
        className="gb-jump-select"
        value={active}
        onChange={onJump}
      >
        {headings.map((heading) => (
          <option key={heading.id} value={heading.id}>
            {heading.title}
          </option>
        ))}
      </select>
    </nav>
  );
}
