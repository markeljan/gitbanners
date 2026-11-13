"use client";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { LogOut, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { sendJson } from "@/components/account/request";
import type { SessionUser } from "@/hooks/use-me";
import { ownerPath } from "@/lib/reserved";

export interface AccountCardProps {
  user: SessionUser;
  /** Saved banners that deleting the account removes. */
  bannerCount: number;
  /** Reports a failed request; the card stays as it was. */
  onError: (error: unknown) => void;
}

/** A GitHub avatar at `px` CSS pixels, asked for at twice that. */
function avatarAt(url: string, px: number): string {
  try {
    const next = new URL(url);
    next.searchParams.set("s", String(px * 2));
    return next.toString();
  } catch {
    return url;
  }
}

function deletionText(count: number): string {
  const banners =
    count === 0
      ? "Your account record is deleted."
      : count === 1
        ? "Your account record and your saved banner are deleted, and its link stops working."
        : `Your account record and all ${count} saved banners are deleted, and their links stop working.`;
  return `${banners} Your profile URL goes back to the standard banner. Your GitHub account is not touched. This cannot be undone.`;
}

/**
 * Who is signed in, and the account's exits: sign out here, sign out on
 * every device, delete the account.
 */
export function AccountCard({ user, bannerCount, onError }: AccountCardProps) {
  const signOut = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const signOutEverywhere = async () => {
    try {
      await sendJson("/api/auth/signout?everywhere=1", "POST");
      // A full navigation, so nothing rendered for this user survives.
      window.location.assign("/");
    } catch (error) {
      onError(error);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await sendJson("/api/me", "DELETE");
      window.location.assign("/");
    } catch (error) {
      setDeleting(false);
      setConfirming(false);
      onError(error);
    }
  };

  return (
    <Card padding={4} className="gb-account">
      <Heading level={2}>Account</Heading>
      <div className="gb-account-who">
        <Avatar
          name={user.name ?? user.login}
          src={avatarAt(user.avatarUrl, 48)}
          size="lg"
          tooltip={false}
        />
        <div className="gb-account-names">
          <Text weight="semibold">{user.name ?? user.login}</Text>
          <Link href={ownerPath(user.login)} isStandalone color="secondary">
            @{user.login}
          </Link>
        </div>
      </div>
      <div className="gb-account-actions">
        {/* A real form post: the route answers 303 to "/", a full navigation. */}
        <form ref={signOut} method="post" action="/api/auth/signout">
          <Button
            label="Sign out"
            type="submit"
            icon={<Icon icon={LogOut} />}
            width="100%"
          />
        </form>
        <Button
          label="Sign out everywhere"
          variant="ghost"
          clickAction={signOutEverywhere}
          width="100%"
        />
        <Text type="supporting" color="secondary" as="p">
          Ends every session of this account, on every device.
        </Text>
      </div>
      <Divider />
      <div className="gb-account-actions">
        <Button
          label="Delete account"
          variant="destructive"
          icon={<Icon icon={Trash2} />}
          onClick={() => setConfirming(true)}
          width="100%"
        />
      </div>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={(open) => {
          if (!deleting) setConfirming(open);
        }}
        title="Delete your account?"
        description={deletionText(bannerCount)}
        actionLabel="Delete account"
        cancelLabel="Keep account"
        isActionLoading={deleting}
        onAction={deleteAccount}
      />
    </Card>
  );
}
