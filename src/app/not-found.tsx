import type { Metadata } from "next";
import { NotFoundContent } from "@/components/content/not-found-content";

export const metadata: Metadata = { title: "Page not found" };

/** Rendered with status 404 for `notFound()` and for every unmatched path. */
export default function NotFound() {
  return <NotFoundContent />;
}
