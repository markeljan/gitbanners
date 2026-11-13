import type { Metadata } from "next";
import { EntityPage } from "@/components/pages/entity-page";
import { loadPage, ownerParams } from "@/components/pages/load";
import { entityMetadata } from "@/components/pages/metadata";

/*
 * /{owner}: the page of a GitHub user or organization.
 *
 * Static with ISR: the showcase owners are rendered at build time, every
 * other owner on its first request and then served from the cache. Because
 * the whole route must be static (`ensureStatic`), a first request for an
 * unknown login blocks until `loadPage` has run, so it gets a real 404, and
 * a capitalised login gets a real 308. Nothing here reads the request; the
 * `?theme=` of a link is read in the browser.
 */
export const ensureStatic = "navigation";
export const instant = false;

export function generateStaticParams(): { owner: string }[] {
  return ownerParams();
}

export async function generateMetadata({
  params,
}: PageProps<"/[owner]">): Promise<Metadata> {
  const { owner } = await params;
  return entityMetadata(await loadPage([owner]));
}

export default async function OwnerPage({ params }: PageProps<"/[owner]">) {
  const { owner } = await params;
  return <EntityPage page={await loadPage([owner])} />;
}
