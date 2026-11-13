import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NotFoundSearch } from "./not-found-search";
import { Container } from "./page";

/**
 * Head of every 404: a title, out of the search index, and without the
 * root layout's canonical link to the homepage.
 */
export const notFoundMetadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

/**
 * The body of the 404 page. A Server Component (it ships with every route
 * through `not-found.tsx`); the only client part is the input, which opens
 * another name.
 */
export function NotFoundView() {
  return (
    <Container width="prose" className="gb-not-found">
      <Text type="label" color="secondary">
        Error 404
      </Text>
      <Heading level={1} className="gb-display">
        This page does not exist
      </Heading>
      <NotFoundSearch fallback="Banner pages live at /owner and /owner/repo, where owner is a GitHub user or organization. Check the address, or open another name." />
      <div className="gb-not-found-links">
        <Button label="Open the gallery" href="/gallery" />
        <Button label="Read the docs" href="/docs" />
        <Button label="Back to the homepage" href="/" variant="ghost" />
        <Button label="llms.txt" href="/llms.txt" as="a" variant="ghost" />
      </div>
    </Container>
  );
}

function Raise404(): never {
  notFound();
}

/**
 * A 404 response with real HTML: the site layout and {@link NotFoundView},
 * readable without JavaScript.
 *
 * Calling `notFound()` at the top of a page (or in `generateMetadata`)
 * replaces the whole document with Next's empty `__next_error__` shell: no
 * `<title>`, no `lang`, no content until the client renders it. Thrown
 * inside a Suspense boundary instead, the prerender completes with the
 * boundary's fallback in place and the response still gets status 404. So
 * the 404 view is the fallback, and once the page hydrates the same error
 * reaches the root `not-found.tsx`, which shows the same view.
 *
 * Pages that use this must not throw `notFound()` from `generateMetadata`:
 * give them {@link notFoundMetadata} instead.
 *
 * The status needs a prerender (build, or the on-demand render of a static
 * route); `next dev` renders dynamically and answers 200 with the same HTML.
 */
export function NotFoundResponse() {
  return (
    <Suspense fallback={<NotFoundView />}>
      <Raise404 />
    </Suspense>
  );
}
