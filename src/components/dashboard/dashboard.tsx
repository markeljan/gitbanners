"use client";

import "./dashboard.css";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { ImagePlus, Plus } from "lucide-react";
import { useState } from "react";
import { type AccountMessage, accountError } from "@/components/account/errors";
import { PlanCard } from "@/components/account/plan-card";
import type { SavedBanner } from "@/components/account/saved-banners";
import { SignInButton } from "@/components/account/sign-in-button";
import { useSavedBanners } from "@/components/account/use-saved-banners";
import { useSiteHost } from "@/components/providers";
import { ApiProblem } from "@/hooks/api";
import { useHydrated } from "@/hooks/use-hydrated";
import { type SessionUser, type UseMeResult, useMe } from "@/hooks/use-me";
import { PRO } from "@/lib/pro/entitlements";
import { site } from "@/lib/site";
import { AccountCard } from "./account-card";
import { DashboardSkeleton, SavedGridSkeleton } from "./dashboard-skeleton";
import { SavedBannerCard } from "./saved-banner-card";
import { SignedOut } from "./signed-out";

const RETURN_TO = "/dashboard";

export interface DashboardProps {
  /**
   * Whether this deployment can sign anyone in (decided on the server from
   * its configuration). When it cannot, the page says so instead of offering
   * a button that ends on an error.
   */
  signInAvailable: boolean;
}

/**
 * `/dashboard`. The server renders the signed-out explanation; signed-in
 * content appears after hydration, from `/api/me` and `/api/banners`.
 *
 * While the session hint cookie exists, the inline script in `<head>` marks
 * `<html data-gb-in>` before first paint and CSS swaps the explanation for a
 * skeleton, so a signed-in visitor never sees the signed-out page flash.
 */
export function Dashboard({ signInAvailable }: DashboardProps) {
  const me = useMe();
  const hydrated = useHydrated();
  const host = useSiteHost();

  if (me.status === "signed-in" && me.user) {
    return <SignedIn me={me} user={me.user} />;
  }
  if (me.status === "loading") return <DashboardSkeleton />;
  if (me.error) {
    return (
      <SessionProblem
        message={accountError(me.error, {
          repo: site.repo.slug,
          reading: true,
        })}
        onRetry={me.refresh}
      />
    );
  }
  return (
    <>
      <div className="gb-dash-public" data-ready={hydrated ? "" : undefined}>
        <SignedOut signInAvailable={signInAvailable} host={host} />
      </div>
      <div className="gb-dash-public-wait">
        <DashboardSkeleton />
      </div>
    </>
  );
}

/** The action that goes with a message, as a button. */
function MessageAction({
  message,
  onRetry,
}: {
  message: AccountMessage;
  onRetry: () => void;
}) {
  switch (message.action) {
    case "sign-in":
      return <SignInButton returnTo={RETURN_TO} size="sm" />;
    case "upgrade":
      return (
        <Button
          label={`Star ${site.repo.slug}`}
          href={site.repo.url}
          as="a"
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
        />
      );
    case "retry":
      return <Button label="Try again" size="sm" onClick={onRetry} />;
    default:
      return null;
  }
}

/** `/api/me` failed while a session probably exists. */
function SessionProblem({
  message,
  onRetry,
}: {
  message: AccountMessage;
  onRetry: () => void;
}) {
  return (
    <div className="gb-dash">
      <div className="gb-dash-head">
        <div className="gb-dash-title">
          <Heading level={1}>Your banners</Heading>
        </div>
      </div>
      <Banner
        status="error"
        title={message.title}
        description={message.message}
        endContent={<MessageAction message={message} onRetry={onRetry} />}
      />
    </div>
  );
}

function SignedIn({ me, user }: { me: UseMeResult; user: SessionUser }) {
  const list = useSavedBanners(true);
  const showToast = useToast();
  const [confirming, setConfirming] = useState<SavedBanner | null>(null);
  const max = me.entitlements.maxSavedBanners;
  const count = list.banners?.length ?? me.banners.count;
  const atLimit = count >= max;
  const context = { repo: site.repo.slug, max };

  const report = (error: unknown) => {
    const message = accountError(error, context);
    showToast({
      body: message.message,
      type: "error",
      uniqueID: `account-${message.title}`,
      endContent:
        message.action === "sign-in" ? (
          <SignInButton returnTo={RETURN_TO} size="sm" variant="ghost" />
        ) : undefined,
    });
    // A lost session or a changed plan shows everywhere on the page.
    if (message.action === "sign-in" || message.action === "upgrade") {
      me.refresh();
    }
    // Deleted elsewhere: drop it from the list instead of keeping a ghost.
    if (error instanceof ApiProblem && error.status === 404) list.reload();
  };
  const run = (work: () => Promise<void>) => async () => {
    try {
      await work();
    } catch (error) {
      report(error);
    }
  };

  const remove = async (banner: SavedBanner) => {
    setConfirming(null);
    try {
      await list.remove(banner.id);
      showToast({ body: `Deleted ${banner.name}`, uniqueID: "banner-deleted" });
    } catch (error) {
      report(error);
    }
  };

  const listMessage =
    list.error === undefined
      ? null
      : accountError(list.error, { ...context, reading: true });

  return (
    <div className="gb-dash">
      <div className="gb-dash-head">
        <div className="gb-dash-title">
          <Heading level={1}>Your banners</Heading>
          <div className="gb-dash-usage">
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {count} of {max} saved banners
            </Text>
            <ProgressBar
              label="Saved banners used"
              isLabelHidden
              value={Math.min(count, max)}
              max={max}
              variant={atLimit ? "warning" : "neutral"}
            />
          </div>
        </div>
        <Button
          label="New banner"
          variant="primary"
          href="/studio"
          icon={<Icon icon={Plus} />}
        />
      </div>

      <div className="gb-dash-cols">
        <section className="gb-dash-main" aria-labelledby="saved-heading">
          <Heading level={2} id="saved-heading" className="sr-only">
            Saved banners
          </Heading>
          {atLimit && !listMessage ? (
            <Banner
              status="warning"
              title={`You are using all ${max} saved banners`}
              description={
                me.pro
                  ? "Delete a banner to make room for a new one."
                  : `Delete a banner to make room, or star ${site.repo.slug} on GitHub for up to ${PRO.maxSavedBanners}.`
              }
            />
          ) : null}
          {listMessage ? (
            <Banner
              status="error"
              title={listMessage.title}
              description={listMessage.message}
              endContent={
                <MessageAction message={listMessage} onRetry={list.reload} />
              }
            />
          ) : list.banners === undefined ? (
            <SavedGridSkeleton
              count={Math.max(1, Math.min(me.banners.count, 4))}
            />
          ) : list.banners.length === 0 ? (
            <div className="gb-dash-empty">
              <EmptyState
                title="No saved banners yet"
                description="Make a banner in the studio and choose Save. It shows up here with a link of its own that you can embed anywhere."
                icon={<Icon icon={ImagePlus} />}
                headingLevel={3}
                actions={<Button label="Open the studio" href="/studio" />}
              />
            </div>
          ) : (
            <div className="gb-saved-grid">
              {list.banners.map((banner, index) => (
                <SavedBannerCard
                  key={banner.id}
                  banner={banner}
                  login={user.login}
                  canSetDefault={me.entitlements.canSetDefault}
                  priority={index < 2}
                  onRename={(name) => run(() => list.rename(banner.id, name))()}
                  onSetDefault={(isDefault) =>
                    run(() => list.setDefault(banner.id, isDefault))()
                  }
                  onDelete={() => setConfirming(banner)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="gb-dash-side" aria-label="Plan and account">
          <PlanCard pro={me.pro} login={user.login} returnTo={RETURN_TO} />
          <AccountCard
            user={user}
            bannerCount={count}
            hasDefault={
              list.banners?.some((banner) => banner.isDefault) ?? false
            }
            onError={report}
          />
        </aside>
      </div>

      <AlertDialog
        isOpen={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming ? `Delete ${confirming.name}?` : "Delete banner?"}
        description={
          confirming?.isDefault
            ? "Its link stops working wherever it is embedded, and your profile URL goes back to the standard banner. This cannot be undone."
            : "Its link stops working wherever it is embedded. This cannot be undone."
        }
        actionLabel="Delete banner"
        cancelLabel="Keep banner"
        onAction={() => {
          if (confirming) void remove(confirming);
        }}
      />
    </div>
  );
}
