import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { Metadata } from "next";
import { NotFoundSearch } from "@/components/site/not-found-search";
import { Container } from "@/components/site/page";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The 404 page: for URLs that match no route, for `notFound()` in the owner
 * and repository pages, and for junk paths rewritten to `/-/nf`. Next adds
 * `<meta name="robots" content="noindex">` by itself.
 *
 * A Server Component (it ships with every route); the only client part is
 * the input, which opens another name.
 */
export default function NotFound() {
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
