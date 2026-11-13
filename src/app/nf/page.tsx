import { notFound } from "next/navigation";

/**
 * A static page that always answers 404.
 *
 * `next.config.ts` rewrites syntactically impossible owner paths
 * (`/wp-login.php`, `/.env`, …) here so they get a real 404 from the CDN
 * without invoking a function or creating one cache entry per junk URL.
 */
export default function ForceNotFound(): never {
  notFound();
}
