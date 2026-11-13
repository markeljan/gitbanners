"use client";

import { Text } from "@astryxdesign/core/Text";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { TargetInput } from "@/components/banner/target-input";
import { useSiteHost } from "@/components/providers";
import { bannerPath } from "@/lib/banner";
import { missingMessage } from "./missing";

const subscribe = () => () => {};
const browserPath = () => window.location.pathname;
const serverPath = () => null;

/**
 * The interactive part of the 404 page: says what the address was probably
 * looking for and offers the target input, filled with that name, to fix a
 * typo or try another one. The address is only known in the browser (the
 * page itself is one static file for every missing URL), so the server and
 * the first render show the general sentence.
 */
export function NotFoundSearch({ fallback }: { fallback: string }) {
  const router = useRouter();
  const host = useSiteHost();
  const pathname = useSyncExternalStore(subscribe, browserPath, serverPath);
  const missing = missingMessage(pathname);
  const [edited, setEdited] = useState<string | null>(null);
  return (
    <>
      <Text as="p" color="secondary" className="gb-lead">
        {missing?.message ?? fallback}
      </Text>
      <TargetInput
        value={edited ?? missing?.slug ?? ""}
        onValueChange={setEdited}
        onCommit={(target) => router.push(bannerPath(target))}
        size="lg"
        prefix={`${host}/`}
        label="GitHub username or owner/repo to open"
      />
    </>
  );
}
