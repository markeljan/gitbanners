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
 * typo or open another one. Loaded on demand by `NotFoundSearch`.
 */
export function NotFoundInput({ fallback }: { fallback: string }) {
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
