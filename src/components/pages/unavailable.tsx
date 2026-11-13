import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";
import { Container } from "@/components/site/page";
import { asGitHubError } from "@/lib/github/errors";

export interface UnavailableCopy {
  title: string;
  body: string;
}

/**
 * What to tell a visitor when an owner or repository page cannot be built.
 * Shared by the server-rendered view and the client error boundary.
 */
export function unavailableCopy(error: unknown): UnavailableCopy {
  const github = asGitHubError(error);
  if (github?.code === "rate_limited") {
    const wait = github.retryAfter
      ? ` in about ${github.retryAfter} seconds`
      : "";
    return {
      title: "GitHub asked us to slow down",
      body: `This page is built from live GitHub data, and GitHub is limiting how often it can be asked. Nothing is wrong with the address. Try again${wait}.`,
    };
  }
  if (github) {
    return {
      title: "GitHub is not answering",
      body: "This page is built from live GitHub data, and GitHub could not be reached just now. Nothing is wrong with the address, and no earlier copy of this page exists yet. Try again in a moment.",
    };
  }
  return {
    title: "This page could not be built",
    body: "Something failed on our side, not in the address. Try again in a moment.",
  };
}

/**
 * The body of an owner or repository page whose data cannot be had: GitHub
 * throttles or is down and no snapshot exists. An honest message and a way
 * to try again, never a made-up banner. `retry` is the button that does it:
 * a link to the same address on the server, a callback in the error
 * boundary.
 */
export function UnavailableView({
  copy,
  retry,
}: {
  copy: UnavailableCopy;
  retry: ReactNode;
}) {
  return (
    <Container width="prose" className="gb-not-found">
      <Text type="label" color="secondary">
        Temporarily unavailable
      </Text>
      <Heading level={1} className="gb-display">
        {copy.title}
      </Heading>
      <Text as="p" color="secondary" className="gb-lead">
        {copy.body}
      </Text>
      <div className="gb-not-found-links">
        {retry}
        <Button label="Open the gallery" href="/gallery" />
        <Button label="Back to the homepage" href="/" variant="ghost" />
      </div>
    </Container>
  );
}
