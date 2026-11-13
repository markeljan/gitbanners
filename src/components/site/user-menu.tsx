"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { LayoutDashboard, LogOut, User } from "lucide-react";
import { useRef, useState } from "react";
import { GithubMark } from "@/components/github-mark";
import { useHydrated } from "@/hooks/use-hydrated";
import { type SessionUser, useMe } from "@/hooks/use-me";
import { ownerPath } from "@/lib/reserved";
import { signInHref } from "./links";

/** A GitHub avatar at `px` CSS pixels, asked for at twice that for sharp screens. */
function avatarAt(url: string, px: number): string {
  try {
    const next = new URL(url);
    next.searchParams.set("s", String(px * 2));
    return next.toString();
  } catch {
    return url;
  }
}

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
 */
export function SignInLink({ compact = false, width }: SignInLinkProps) {
  const [returnTo, setReturnTo] = useState("/");
  const capture = () => {
    setReturnTo(`${window.location.pathname}${window.location.search}`);
  };
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

function AccountMenu({ user, pro }: { user: SessionUser; pro: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <>
      <DropdownMenu
        hasChevron={false}
        alignment="end"
        menuWidth={232}
        renderTrigger={(props) => (
          <Avatar
            name={user.name ?? user.login}
            src={avatarAt(user.avatarUrl, 28)}
            size="sm"
            tooltip={false}
            aria-label={`Account menu for ${user.login}`}
            {...props}
          />
        )}
        items={[
          {
            label: user.login,
            description: "Your banner page",
            href: ownerPath(user.login),
            icon: User,
            endContent: pro ? (
              <Badge label="Pro" variant="success" />
            ) : undefined,
          },
          {
            label: "Dashboard",
            href: "/dashboard",
            icon: LayoutDashboard,
          },
          { type: "divider" },
          {
            label: "Sign out",
            icon: LogOut,
            onClick: () => form.current?.requestSubmit(),
          },
        ]}
      />
      {/* A real form post: the route answers 303 to "/", a full navigation,
          so nothing rendered for the signed-in user survives. */}
      <form ref={form} method="post" action="/api/auth/signout" hidden />
    </>
  );
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
        <Skeleton width={28} height={28} radius="rounded" />
      ) : (
        // On phones the sign-in action lives in the menu drawer.
        <span className="max-sm:hidden">
          <SignInLink />
        </span>
      )}
    </span>
  );
}
