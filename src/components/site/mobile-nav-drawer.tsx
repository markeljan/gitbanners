"use client";

import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { GithubMark } from "@/components/github-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMe } from "@/hooks/use-me";
import { site } from "@/lib/site";
import { isCurrentPath, PRIMARY_NAV } from "./links";
import { SignInLink } from "./user-menu";

function DrawerLinks({
  current,
  onNavigate,
}: {
  current: string | null;
  onNavigate: () => void;
}) {
  return (
    <ul>
      {PRIMARY_NAV.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className="gb-drawer-link"
            onClick={onNavigate}
            aria-current={
              current !== null && isCurrentPath(current, link.href)
                ? "page"
                : undefined
            }
          >
            {link.label}
            <Icon icon="chevronRight" size="sm" color="secondary" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CurrentDrawerLinks({ onNavigate }: { onNavigate: () => void }) {
  // Only rendered in the browser, after the visitor opened the menu, so the
  // router's pathname is the browser's.
  return <DrawerLinks current={usePathname()} onNavigate={onNavigate} />;
}

export interface MobileNavDrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * The menu drawer of narrow screens: page links, session actions and the
 * colour mode. Loaded on demand by `MobileNav`: it carries a heading (the
 * drawer title) and a `<dialog>`, neither of which belongs in the static
 * HTML of the header.
 */
export function MobileNavDrawer({
  isOpen,
  onOpenChange,
}: MobileNavDrawerProps) {
  const { status } = useMe();
  const close = () => onOpenChange(false);
  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="Menu"
      width={320}
    >
      <Layout
        header={<DrawerHeader title="Menu" onOpenChange={onOpenChange} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <nav aria-label="Main">
                <Suspense
                  fallback={<DrawerLinks current={null} onNavigate={close} />}
                >
                  <CurrentDrawerLinks onNavigate={close} />
                </Suspense>
              </nav>
              <Divider />
              <VStack gap={3}>
                {status === "anonymous" ? <SignInLink width="100%" /> : null}
                <Button
                  label="Star on GitHub"
                  href={site.repo.url}
                  as="a"
                  target="_blank"
                  rel="noreferrer"
                  icon={<Icon icon={GithubMark} />}
                  width="100%"
                />
              </VStack>
              <Divider />
              <VStack gap={2}>
                <Text type="label" color="secondary">
                  Colour mode
                </Text>
                <ThemeToggle />
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Drawer>
  );
}
