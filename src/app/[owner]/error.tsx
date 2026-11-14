"use client";

import { Button } from "@astryxdesign/core/Button";
import {
  UnavailableView,
  unavailableCopy,
} from "@/components/pages/unavailable";

/**
 * Last resort for an owner or repository page that failed while rendering.
 * GitHub failures do not end up here: `loadPage` turns them into the same
 * view, rendered on the server (see `src/components/pages/load.ts`). Errors
 * are not cached, so the next request tries again by itself.
 */
export default function OwnerError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <UnavailableView
      copy={unavailableCopy(error)}
      retry={
        <Button label="Try again" variant="primary" onClick={() => retry()} />
      }
    />
  );
}
