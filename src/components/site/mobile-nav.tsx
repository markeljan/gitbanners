"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import dynamic from "next/dynamic";
import { useState } from "react";

const loadDrawer = () =>
  import("./mobile-nav-drawer").then((module) => module.MobileNavDrawer);
const MobileNavDrawer = dynamic(loadDrawer, { ssr: false });

/**
 * Navigation for narrow screens: a menu button that opens the page links in
 * a drawer. Which of the two navigations shows is decided by CSS (the
 * wrappers in the header), so the static HTML is right at every width and
 * nothing swaps on hydration.
 *
 * The drawer is a separate chunk, mounted on first use and fetched as soon
 * as the visitor reaches for the button, so it opens without a wait.
 */
export function MobileNav() {
  const [isOpen, setOpen] = useState(false);
  const [wasOpened, setWasOpened] = useState(false);
  const preload = () => {
    void loadDrawer();
  };
  return (
    <span onPointerEnter={preload} onPointerDownCapture={preload}>
      <IconButton
        label="Open menu"
        variant="ghost"
        icon={<Icon icon="menu" />}
        aria-haspopup="dialog"
        onFocus={preload}
        onClick={() => {
          setWasOpened(true);
          setOpen(true);
        }}
      />
      {wasOpened ? (
        <MobileNavDrawer isOpen={isOpen} onOpenChange={setOpen} />
      ) : null}
    </span>
  );
}
