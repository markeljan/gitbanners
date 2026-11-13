import "./content.css";

import { Heading } from "@astryxdesign/core/Heading";
import Link from "next/link";

/**
 * The body of the 404 page: what happened, and the places a person or an
 * agent can continue from. `not-found.tsx` renders it; so does every path
 * the routing layer sends to the always-404 page.
 */
export function NotFoundContent() {
  return (
    <div className="gb-page">
      <article className="gb-article">
        <div className="gb-head">
          <Heading level={1} type="display-3">
            Page not found
          </Heading>
          <p className="gb-lead">
            Nothing lives at this address. Banner pages are at{" "}
            <code>/owner</code> and <code>/owner/repo</code>, where owner is the
            login of a GitHub user or organization.
          </p>
        </div>
        <div className="gb-body">
          <ul>
            <li>
              <Link href="/">Home</Link>: make a banner from a GitHub login
            </li>
            <li>
              <Link href="/docs">Docs</Link>: URL patterns, parameters and the
              API
            </li>
            <li>
              <a href="/llms.txt">llms.txt</a>: index of the site for language
              models
            </li>
            <li>
              <a href="/sitemap.xml">Sitemap</a>
            </li>
          </ul>
        </div>
      </article>
    </div>
  );
}
