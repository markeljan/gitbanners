"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { isCurrentPath, PRIMARY_NAV } from "./links";

function NavList({ current }: { current: string | null }) {
  return (
    <ul className="gb-nav-list">
      {PRIMARY_NAV.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className="gb-nav-link"
            aria-current={
              current !== null && isCurrentPath(current, link.href)
                ? "page"
                : undefined
            }
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CurrentNavList() {
  const pathname = usePathname();
  // The prerendered pathname can differ from the browser's (rewrites serve
  // one page at many URLs), so the current page is only marked after
  // hydration, from what the browser reports.
  const hydrated = useHydrated();
  return <NavList current={hydrated ? pathname : null} />;
}

/**
 * The header's page links. The Suspense boundary is required by
 * `usePathname()` on routes whose params are unknown at build time; its
 * fallback is the same list without a current page, so the links are in the
 * static HTML either way.
 */
export function PrimaryNav() {
  return (
    <Suspense fallback={<NavList current={null} />}>
      <CurrentNavList />
    </Suspense>
  );
}
