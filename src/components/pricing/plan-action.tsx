"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { GithubMark } from "@/components/github-mark";
import { useProRepo, useSignInAvailable } from "@/components/providers";
import { signInHref } from "@/components/site/links";
import { useMe } from "@/hooks/use-me";

/** Where sign-in and "Check again" come back to. */
const RETURN_TO = "/pricing";

/**
 * The Pro plan's action, by who is looking:
 *
 * - signed out (and the server render): "Sign in with GitHub";
 * - signed in on Free: "Star the repository", with "Check again" to sign in
 *   once more so the new star is seen at once;
 * - on Pro: "You are on Pro";
 * - on a deployment that cannot sign anyone in: a note saying so, instead
 *   of a button that would end on an error.
 *
 * Sign-in is a plain link (`as="a"`): the route redirects to github.com and
 * sets a cookie, so the router must never prefetch it.
 */
export function PlanAction() {
  const { status, pro, user } = useMe();
  const repo = useProRepo();
  const signInAvailable = useSignInAvailable();

  if (!signInAvailable) {
    return (
      <Text as="p" type="supporting" color="secondary">
        Accounts are not available on this deployment, so Pro cannot be unlocked
        here. Every public banner still works without one.
      </Text>
    );
  }

  if (status === "signed-in" && pro) {
    return (
      <div className="gb-plan-state">
        <StatusDot variant="success" label="Pro is active" />
        <span>
          <strong>You are on Pro</strong>
          {user ? `, signed in as ${user.login}.` : "."}
        </span>
      </div>
    );
  }

  if (status === "signed-in") {
    return (
      <div className="gb-plan-actions">
        <Button
          label={`Star ${repo.slug} on GitHub`}
          variant="primary"
          href={repo.url}
          as="a"
          target="_blank"
          rel="noopener noreferrer"
          icon={<Icon icon={GithubMark} />}
          width="100%"
        >
          Star the repository
        </Button>
        <Button
          label="Check again"
          href={signInHref(RETURN_TO)}
          as="a"
          width="100%"
        />
      </div>
    );
  }

  return (
    <div className="gb-plan-actions">
      <Button
        label="Sign in with GitHub"
        variant="primary"
        href={signInHref(RETURN_TO)}
        as="a"
        icon={<Icon icon={GithubMark} />}
        isLoading={status === "loading"}
        width="100%"
      />
    </div>
  );
}
