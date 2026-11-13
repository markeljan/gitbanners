"use client";

import { useToast } from "@astryxdesign/core/Toast";
import { useEffect } from "react";
import { authErrorMessage, withoutAuthError } from "./auth-errors";

/**
 * Shows a toast when the page was reached with `?auth_error=<code>` (a
 * failed "Sign in with GitHub"), then drops the parameter from the address
 * bar so a reload or a shared link does not repeat it.
 *
 * It reads `window.location` in an effect instead of `useSearchParams()`:
 * the parameter only ever arrives through a full page load, and this way the
 * component needs no Suspense boundary and no page becomes dynamic.
 */
export function AuthNotice() {
  const showToast = useToast();
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("auth_error");
    if (code === null) return;
    const cleaned = withoutAuthError(window.location.href);
    if (cleaned !== null) window.history.replaceState(null, "", cleaned);
    showToast({
      body: authErrorMessage(code),
      type: "error",
      // Strict Mode runs effects twice in development: one toast, not two.
      uniqueID: "auth-error",
    });
  }, [showToast]);
  return null;
}
