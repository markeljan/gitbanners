import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { Link2, Save, Star } from "lucide-react";
import { SignInButton } from "@/components/account/sign-in-button";
import { useProRepo } from "@/components/providers";
import { FREE, PRO } from "@/lib/pro/entitlements";

export interface SignedOutProps {
  /** False when this deployment cannot sign anyone in (no account setup). */
  signInAvailable: boolean;
  /** Canonical host, for the example URLs. */
  host: string;
}

const RETURN_TO = "/dashboard";

/**
 * What the dashboard is for, for someone who is not signed in. Rendered on
 * the server, so it is the page's HTML for visitors, crawlers and agents.
 */
export function SignedOut({ signInAvailable, host }: SignedOutProps) {
  const repo = useProRepo();
  const points = [
    {
      icon: Save,
      title: "Keep the banners you make",
      text: `Save a banner from the studio and find it here: ${FREE.maxSavedBanners} on the free plan, ${PRO.maxSavedBanners} with Pro. Rename, copy and delete them in one place.`,
    },
    {
      icon: Link2,
      title: "A stable link for each",
      text: `Every saved banner has its own address, ${host}/b/{id}.svg or .png. Edit it in the studio and every README that embeds it follows, with no copy and paste.`,
    },
    {
      icon: Star,
      title: "Pro costs one star",
      text: `Star ${repo.slug} on GitHub to hide the mark, animate the contribution graph, keep up to ${PRO.maxSavedBanners} banners and choose the banner served at your own ${host}/{login}.svg.`,
    },
  ];
  return (
    <div className="gb-dash-intro">
      <div className="gb-dash-intro-lead">
        <Heading level={1}>Your saved banners, in one place</Heading>
        <Text type="large" color="secondary" as="p" weight="normal">
          The dashboard is where signed-in people keep their banners. Making a
          banner never needs an account; saving one does.
        </Text>
        {signInAvailable ? (
          <div className="gb-dash-intro-actions">
            <SignInButton returnTo={RETURN_TO} size="lg" />
            <Button label="Open the studio" href="/studio" size="lg" />
          </div>
        ) : (
          <>
            <Banner
              status="info"
              title="Accounts are not set up on this deployment"
              description="Signing in needs an account database and GitHub app settings that this deployment does not have. Every public banner still works: make one in the studio and copy its link."
            />
            <div className="gb-dash-intro-actions">
              <Button
                label="Open the studio"
                href="/studio"
                variant="primary"
                size="lg"
              />
            </div>
          </>
        )}
        {signInAvailable ? (
          <Text type="supporting" color="secondary" as="p">
            Sign in with GitHub asks only who you are: no access to your
            repositories, and nothing is posted for you.
          </Text>
        ) : null}
      </div>
      <ul className="gb-dash-points">
        {points.map((point) => (
          <li key={point.title} className="gb-dash-point">
            <span className="gb-dash-point-icon">
              <Icon icon={point.icon} />
            </span>
            <Heading level={2}>{point.title}</Heading>
            <Text color="secondary" as="p">
              {point.text}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
