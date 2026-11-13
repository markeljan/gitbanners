import { parseBannerRef } from "@/components/banner/box";
import { targetSlug } from "@/lib/embed";

/** What a missing URL was probably asking for, when it reads as a banner path. */
export function missingMessage(pathname: string | null): {
  message: string;
  slug: string;
} | null {
  const ref = pathname ? parseBannerRef(pathname) : null;
  if (!ref) return null;
  const slug = targetSlug(ref.target);
  return {
    slug,
    message:
      ref.target.kind === "repo"
        ? `No public repository named ${slug}. Check the spelling, or try another name.`
        : `No GitHub account named ${slug}. Check the spelling, or try owner/repo.`,
  };
}
