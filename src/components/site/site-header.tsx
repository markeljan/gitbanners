import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import Link from "next/link";
import { GithubMark } from "@/components/icons";
import { ThemeSwitch } from "@/components/theme-toggle";
import { site } from "@/lib/site";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { PrimaryNav } from "./primary-nav";
import { UserMenu } from "./user-menu";

/**
 * The site header: home link, page navigation, "Star on GitHub", colour mode
 * and the session slot.
 *
 * A Server Component with small client islands. It renders no heading
 * element on purpose: the page's `<h1>` must be the first heading of the
 * document. The wide and the narrow navigation are both in the HTML and CSS
 * picks one, so the layout is right before hydration.
 */
export function SiteHeader() {
  return (
    <header className="gb-header">
      <div className="gb-container gb-header-inner">
        <Link
          href="/"
          className="gb-home-link"
          aria-label={`${site.name} home`}
        >
          <Logo />
        </Link>
        <nav aria-label="Main" className="max-lg:hidden">
          <PrimaryNav />
        </nav>
        <div className="gb-header-end">
          <span className="max-lg:hidden">
            <Button
              label="Star on GitHub"
              href={site.repo.url}
              as="a"
              target="_blank"
              rel="noreferrer"
              variant="ghost"
              icon={<Icon icon={GithubMark} />}
            >
              Star
            </Button>
          </span>
          <ThemeSwitch />
          <UserMenu />
          <span className="lg:hidden">
            <MobileNav />
          </span>
        </div>
      </div>
    </header>
  );
}
