"use client";

import { Text } from "@astryxdesign/core/Text";
import { type ComponentType, useEffect, useState } from "react";

/**
 * The 404 page's explanation and target input.
 *
 * `not-found.tsx` is part of every route, so whatever it imports directly is
 * downloaded by every page. The input brings the suggestion hooks and the
 * banner engine with it: it is a separate chunk, fetched only when a 404 is
 * really on screen. Until it arrives (and without JavaScript) the general
 * sentence stands in, above a placeholder of the input's height.
 */
export function NotFoundSearch({ fallback }: { fallback: string }) {
  const [Input, setInput] = useState<ComponentType<{
    fallback: string;
  }> | null>(null);
  useEffect(() => {
    let alive = true;
    void import("./not-found-input").then((module) => {
      if (alive) setInput(() => module.NotFoundInput);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (Input) return <Input fallback={fallback} />;
  return (
    <>
      <Text as="p" color="secondary" className="gb-lead">
        {fallback}
      </Text>
      <div className="gb-target-placeholder" aria-hidden="true" />
    </>
  );
}
