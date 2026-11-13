"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import type { ReactNode } from "react";
import { GithubMark } from "@/components/github-mark";
import { useSignInAvailable } from "@/components/providers";
import { signInHref } from "@/components/site/links";

export interface SignInButtonProps {
  /** Site-relative path to come back to after GitHub, e.g. "/dashboard". */
  returnTo: string;
  /** Visible text and accessible name. @default "Sign in with GitHub" */
  label?: string;
  /** @default "primary" */
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  /** @default the GitHub mark */
  icon?: ReactNode;
  width?: "100%";
}

/**
 * "Sign in with GitHub", returning to a fixed page. A plain `<a>`, never a
 * router link: the route answers with a redirect to github.com and sets a
 * cookie, so it must not be prefetched. Signing in again is also how a new
 * star is checked, hence the `label` override ("I starred it, check again").
 *
 * For a link that returns to whatever page the visitor is on, use
 * `SignInLink` from the site header instead.
 *
 * Renders nothing on a deployment that cannot sign anyone in.
 */
export function SignInButton({
  returnTo,
  label = "Sign in with GitHub",
  variant = "primary",
  size,
  icon,
  width,
}: SignInButtonProps) {
  const available = useSignInAvailable();
  if (!available) return null;
  return (
    <Button
      label={label}
      href={signInHref(returnTo)}
      as="a"
      variant={variant}
      size={size}
      icon={icon ?? <Icon icon={GithubMark} />}
      width={width}
    />
  );
}
