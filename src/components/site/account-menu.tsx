"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { LayoutDashboard, LogOut, User } from "lucide-react";
import { useRef } from "react";
import type { SessionUser } from "@/hooks/use-me";
import { ownerPath } from "@/lib/reserved";

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

export interface AccountMenuProps {
  user: SessionUser;
  /** Signed in and has starred the repository. */
  pro: boolean;
}

/**
 * The signed-in user's avatar and menu: their banner page (with a Pro badge
 * when they have Pro), the dashboard and sign out. Loaded on demand by
 * `UserMenu`.
 */
export function AccountMenu({ user, pro }: AccountMenuProps) {
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
