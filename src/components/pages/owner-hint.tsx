"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { NoPrefetchLink } from "@/components/app-link";
import { useMe } from "@/hooks/use-me";
import { site } from "@/lib/site";

export interface OwnerHintProps {
  /** The login the page belongs to: the account, or the repository's owner. */
  login: string;
  /** Studio URL of the page's banner. */
  studio: string;
}

/**
 * For the signed-in owner of the page only: how to keep this banner and
 * what Pro adds. Nothing for anyone else, and nothing in the server HTML
 * (the session is only known in the browser).
 */
export function OwnerHint({ login, studio }: OwnerHintProps) {
  const { user, pro } = useMe();
  if (!user || user.login.toLowerCase() !== login.toLowerCase()) return null;
  const description = pro
    ? `Save it in the studio to keep its options. With Pro you can hide the ${site.name} mark, animate the graph and serve a saved banner as your default at /${user.login}.svg.`
    : `Save it in the studio to keep its options. Star ${site.repo.slug} to unlock Pro: no ${site.name} mark, an animated graph and your own default banner at /${user.login}.svg.`;
  return (
    <Banner
      status="info"
      title={
        pro ? "This is your banner, and you have Pro" : "This is your banner"
      }
      description={description}
      endContent={
        <Button label="Save in the studio" href={studio} as={NoPrefetchLink} />
      }
    />
  );
}
