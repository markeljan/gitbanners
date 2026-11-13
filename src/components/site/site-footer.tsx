import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";
import { FOOTER_NAV, type SiteLink } from "./links";
import { Logo } from "./logo";

function FooterLink({ link }: { link: SiteLink }) {
  if (link.kind === "page") {
    return (
      // No prefetch: a dozen links enter the viewport at once down here.
      <Link href={link.href} prefetch={false} className="gb-footer-link">
        {link.label}
      </Link>
    );
  }
  if (link.kind === "external") {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className="gb-footer-link"
      >
        {link.label}
        <Icon icon="externalLink" size="xsm" />
      </a>
    );
  }
  return (
    <a href={link.href} className="gb-footer-link">
      {link.label}
    </a>
  );
}

/**
 * The site footer: product, resource and project links, the colour mode and
 * the independence notice. Column titles are plain text, not headings: no
 * heading element may live in the site chrome.
 */
export function SiteFooter() {
  return (
    <footer className="gb-footer">
      <div className="gb-container">
        <div className="gb-footer-grid">
          <div className="gb-footer-brand">
            <Link
              href="/"
              className="gb-home-link"
              aria-label={`${site.name} home`}
            >
              <Logo />
            </Link>
            <Text as="p" color="secondary">
              {site.tagline}. One URL, always up to date.
            </Text>
            <ThemeToggle />
          </div>
          {FOOTER_NAV.map((group) => (
            <nav key={group.id} aria-labelledby={`footer-${group.id}`}>
              <p id={`footer-${group.id}`} className="gb-footer-title">
                {group.title}
              </p>
              <ul className="gb-footer-links">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="gb-footer-note">
          {site.name} is an independent project, not affiliated with or endorsed
          by GitHub.
        </p>
      </div>
    </footer>
  );
}
