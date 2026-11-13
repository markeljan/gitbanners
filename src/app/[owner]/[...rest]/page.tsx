import type { Metadata } from "next";
import { EntityPage } from "@/components/pages/entity-page";
import { loadMetadata, loadPage, restParams } from "@/components/pages/load";

/*
 * /{owner}/{preset}, /{owner}/{repo} and /{owner}/{repo}/{preset}.
 *
 * Same contract as /{owner} (see ../page.tsx): static with ISR, a real 404
 * for anything that is not a banner page and a real 308 to the canonical
 * spelling, both decided before anything renders.
 */
export const ensureStatic = "navigation";
export const instant = false;

export function generateStaticParams(): { owner: string; rest: string[] }[] {
  return restParams();
}

export async function generateMetadata({
  params,
}: PageProps<"/[owner]/[...rest]">): Promise<Metadata> {
  const { owner, rest } = await params;
  return loadMetadata([owner, ...rest]);
}

export default async function OwnerRestPage({
  params,
}: PageProps<"/[owner]/[...rest]">) {
  const { owner, rest } = await params;
  return <EntityPage page={await loadPage([owner, ...rest])} />;
}
