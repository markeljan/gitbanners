"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Astryx hands its link component both `href` and `to` (the latter for
 * routers that use that name). next/link would print the unknown `to` as an
 * HTML attribute, so it stops here.
 */
type AppLinkProps = ComponentProps<typeof Link> & { to?: unknown };

/**
 * The link every Astryx component renders through (`LinkProvider` in
 * `providers.tsx`): next/link, so page links are client-side navigations.
 */
export function AppLink({ to: _to, ...props }: AppLinkProps) {
  return <Link {...props} />;
}

/**
 * The same, without prefetching. Pass it as `as` to an Astryx link or button
 * whose `href` follows state (a "Open in studio" link that carries the
 * banner being edited): prefetching would ask the server again for every
 * state the visitor passes through.
 *
 * ```tsx
 * <Button label="Open in studio" href={studioPath(…)} as={NoPrefetchLink} />
 * ```
 */
export function NoPrefetchLink({ to: _to, ...props }: AppLinkProps) {
  return <Link {...props} prefetch={false} />;
}
