"use client";

import "./account.css";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { RefreshCw } from "lucide-react";
import { GithubMark } from "@/components/github-mark";
import { useProRepo, useSiteHost } from "@/components/providers";
import { withProCheck } from "@/components/site/links";
import { edgeRefreshText } from "@/content/facts";
import { FREE, PRO } from "@/lib/pro/entitlements";
import { site } from "@/lib/site";
import { ProBadge } from "./pro-badge";
import { SignInButton } from "./sign-in-button";

export interface PlanCardProps {
  /** Signed in and has starred the repository. */
  pro: boolean;
  /** The signed-in login, to print the profile URL. */
  login: string;
  /** Where "I starred it, check again" comes back to. @default "/dashboard" */
  returnTo?: string;
  /** Level of the card's heading in the page outline. @default 2 */
  headingLevel?: 2 | 3;
}

/** What Pro adds, from the same numbers the API enforces. */
export function proFeatures(login: string, host: string): string[] {
  return [
    `No ${site.name} mark on saved banners`,
    "Animated contribution graph in saved SVG banners",
    `${PRO.maxSavedBanners} saved banners instead of ${FREE.maxSavedBanners}`,
    `Your own default banner at ${host}/${login}.svg`,
    edgeRefreshText(),
  ];
}

/**
 * The signed-in user's plan. Free: what Pro adds and how to get it (one
 * star, then a fresh sign-in, which is when the star is checked). Pro: a
 * quiet confirmation of what is on.
 */
export function PlanCard({
  pro,
  login,
  returnTo = "/dashboard",
  headingLevel = 2,
}: PlanCardProps) {
  const host = useSiteHost();
  const repo = useProRepo();
  const features = proFeatures(login, host);
  return (
    <Card padding={4} className="gb-plan">
      <div className="gb-plan-head">
        <Heading level={headingLevel}>
          {pro ? "Your plan" : "Free plan"}
        </Heading>
        {pro ? <ProBadge /> : null}
      </div>
      <Text type="supporting" color="secondary" as="p">
        {pro
          ? `Thanks for starring ${repo.slug}. Pro stays on as long as the star does.`
          : `Pro costs one star on ${repo.slug}. There is nothing to pay. It adds:`}
      </Text>
      <ul className="gb-plan-list">
        {features.map((feature) => (
          <li key={feature}>
            <Icon
              icon="check"
              size="sm"
              color={pro ? "success" : "secondary"}
            />
            <Text>{feature}</Text>
          </li>
        ))}
      </ul>
      {pro ? (
        <Text type="supporting" color="secondary" as="p">
          To choose your profile default, open the menu of a banner of your own
          profile. It is then what {host}/{login}.svg shows.
        </Text>
      ) : (
        <div className="gb-plan-actions">
          <Button
            label={`Star ${repo.slug} on GitHub`}
            href={repo.url}
            as="a"
            target="_blank"
            rel="noopener noreferrer"
            icon={<Icon icon={GithubMark} />}
            width="100%"
          />
          <SignInButton
            returnTo={withProCheck(returnTo)}
            label="I starred it, check again"
            variant="ghost"
            icon={<Icon icon={RefreshCw} />}
            width="100%"
          />
        </div>
      )}
    </Card>
  );
}
