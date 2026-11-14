"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import dynamic from "next/dynamic";
import { useState } from "react";
import { GithubMark } from "@/components/github-mark";
import { useSignInAvailable } from "@/components/providers";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMe } from "@/hooks/use-me";
import { signInHref } from "./links";

export interface SignInLinkProps {
  /** Shorter visible text for tight places. The accessible name stays the same. */
  compact?: boolean;
  width?: "100%";
}

/**
 * "Sign in with GitHub". A plain `<a>` on purpose: the route answers with a
 * redirect to github.com and sets a cookie, so it must never be prefetched or
 * fetched by the router.
 *
 * The page is static, so the server cannot know where the visitor is: the
 * link is rendered returning to "/" and switches to the current URL the
 * moment the visitor reaches for it (focus or pointer down).
 *
 * Renders nothing on a deployment that cannot sign anyone in.
 */
export function SignInLink({ compact = false, width }: SignInLinkProps) {
  const available = useSignInAvailable();
  const [returnTo, setReturnTo] = useState("/");
  const capture = () => {
    setReturnTo(`${window.location.pathname}${window.location.search}`);
  };
  if (!available) return null;
  return (
    <span
      className={width ? "block w-full" : "inline-flex"}
      onPointerDownCapture={capture}
      onFocusCapture={capture}
    >
      <Button
        label="Sign in with GitHub"
        href={signInHref(returnTo)}
        as="a"
        icon={<Icon icon={GithubMark} />}
        width={width}
      >
        {compact ? "Sign in" : undefined}
      </Button>
    </span>
  );
}

/**
 * The avatar menu is its own chunk: it brings a dropdown, a bottom sheet for
 * phones and an avatar, none of which a signed-out visitor ever needs.
 */
const AccountMenu = dynamic(
  () => import("./account-menu").then((module) => module.AccountMenu),
  { ssr: false, loading: () => <AvatarPlaceholder /> },
);

function AvatarPlaceholder() {
  return <Skeleton width={28} height={28} radius="rounded" />;
}

/**
 * The header's session slot: "Sign in with GitHub" for visitors, the avatar
 * menu for signed-in users. It never blocks the static shell: the server
 * always renders the signed-out state and `/api/me` is asked after hydration,
 * only when the session hint cookie exists.
 */
export function UserMenu() {
  const { status, user, pro } = useMe();
  const hydrated = useHydrated();
  return (
    <span
      className="gb-user"
      data-ready={hydrated && status !== "loading" ? "" : undefined}
    >
      {status === "signed-in" && user ? (
        <AccountMenu user={user} pro={pro} />
      ) : status === "loading" ? (
        <AvatarPlaceholder />
      ) : (
        // On phones the sign-in action lives in the menu drawer.
        <span className="max-sm:hidden">
          <SignInLink />
        </span>
      )}
    </span>
  );
}
