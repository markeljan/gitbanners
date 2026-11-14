import {
  NotFoundView,
  notFoundMetadata,
} from "@/components/site/not-found-view";

export const metadata = notFoundMetadata;

/**
 * The 404 page Next renders by itself: for the client side of a
 * `NotFoundResponse` (see `src/components/site/not-found-view.tsx`), and for
 * anything else that calls `notFound()`. The owner and repository pages and
 * `/-/nf` answer their 404s with `NotFoundResponse`, which puts the same view
 * in the server HTML. Next adds `<meta name="robots" content="noindex">` by
 * itself.
 */
export default function NotFound() {
  return <NotFoundView />;
}
