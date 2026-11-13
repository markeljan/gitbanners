"use client";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Container } from "@/components/site/page";
import { asGitHubError } from "@/lib/github/errors";

interface ErrorCopy {
  title: string;
  body: string;
}

function copyFor(error: unknown): ErrorCopy {
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
 * The page of an owner or repository when its data cannot be had: GitHub
 * throttles or is down and no cached copy exists. An honest message and a
 * retry, never a made-up banner. Errors are not cached, so the next request
 * tries again by itself.
 */
export default function OwnerError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const copy = copyFor(error);
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
        <Button label="Try again" variant="primary" onClick={() => retry()} />
        <Button label="Open the gallery" href="/gallery" />
        <Button label="Back to the homepage" href="/" variant="ghost" />
      </div>
    </Container>
  );
}
