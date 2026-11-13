import {
  NotFoundResponse,
  notFoundMetadata,
} from "@/components/site/not-found-view";

export const metadata = notFoundMetadata;

/**
 * A static page that always answers 404.
 *
 * `next.config.ts` rewrites syntactically impossible owner paths
 * (`/wp-login.php`, `/.env`, …) here so they get a real 404 from the CDN
 * without invoking a function or creating one cache entry per junk URL.
 * The 404 view is in the prerendered HTML (see `NotFoundResponse`).
 */
export default function ForceNotFound() {
  return <NotFoundResponse />;
}
