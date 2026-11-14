"use client";

import "./migrate.css";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type FormEvent, useDeferredValue, useId, useState } from "react";
import { CopyButton } from "@/components/banner/copy-button";
import { useSiteOrigin } from "@/components/providers";
import { LOGIN_RE } from "@/lib/github/schema";
import { EXAMPLE_README, migrateReadme } from "@/lib/migrate";
import { ChangeList } from "./change-list";
import { DiffView } from "./diff-view";

type View = "fixed" | "diff";

type LoadState =
  | { state: "idle" }
  | { state: "loading"; login: string }
  | { state: "error"; login: string; message: string };

/** The profile README of `login`, fetched by the browser straight from GitHub. */
async function fetchProfileReadme(login: string): Promise<string | null> {
  const base = `https://raw.githubusercontent.com/${login}/${login}/HEAD`;
  // GitHub shows README.md first; some profiles spell it in lower case.
  for (const file of ["README.md", "readme.md", "Readme.md"]) {
    const response = await fetch(`${base}/${file}`, { cache: "no-store" });
    if (response.ok) return response.text();
    if (response.status !== 404) {
      throw new Error(`GitHub answered ${response.status}.`);
    }
  }
  return null;
}

function summary(counts: Record<"replace" | "optional" | "flag", number>) {
  const parts = [
    counts.replace > 0 ? `${counts.replace} replaced` : null,
    counts.optional > 0 ? `${counts.optional} optional` : null,
    counts.flag > 0 ? `${counts.flag} left alone` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * The README doctor: paste a README or load a profile README by username,
 * get the fixed Markdown, a list of what changed and why, a diff and a
 * preview of the new banners. All of it runs here, in the browser.
 */
export function ReadmeDoctor() {
  const origin = useSiteOrigin();
  const id = useId();
  const [login, setLogin] = useState("");
  const [text, setText] = useState("");
  const [load, setLoad] = useState<LoadState>({ state: "idle" });
  const [view, setView] = useState<View>("fixed");
  // Optional swaps the reader turned on, for the text they were made on.
  const [accepted, setAccepted] = useState<{ for: string; ids: Set<string> }>({
    for: "",
    ids: new Set(),
  });

  const input = useDeferredValue(text);
  const cleanLogin = login.trim().replace(/^@/, "");
  const validLogin = LOGIN_RE.test(cleanLogin) ? cleanLogin : undefined;
  const ids = accepted.for === input ? accepted.ids : new Set<string>();
  const result = migrateReadme(input, {
    origin,
    login: validLogin,
    acceptOptional: ids,
  });
  const counts = { replace: 0, optional: 0, flag: 0 };
  for (const change of result.changes) counts[change.action]++;
  const changed = result.markdown !== input;

  const onLoad = async (event: FormEvent) => {
    event.preventDefault();
    if (!validLogin) {
      setLoad({
        state: "error",
        login: cleanLogin,
        message: "Enter a GitHub username: letters, digits and single hyphens.",
      });
      return;
    }
    setLoad({ state: "loading", login: validLogin });
    try {
      const readme = await fetchProfileReadme(validLogin);
      if (readme === null) {
        setLoad({
          state: "error",
          login: validLogin,
          message: `No README found in ${validLogin}/${validLogin}. A profile README lives in a public repository named after the username. Paste your README below instead.`,
        });
        return;
      }
      setText(readme);
      setLoad({ state: "idle" });
    } catch (caught) {
      const why =
        caught instanceof Error && caught.message.startsWith("GitHub")
          ? caught.message
          : "Check your connection and try again.";
      setLoad({
        state: "error",
        login: validLogin,
        message: `${why} Or paste the README below.`,
      });
    }
  };

  const onToggle = (changeId: string, applied: boolean) => {
    const next = new Set(ids);
    if (applied) next.add(changeId);
    else next.delete(changeId);
    setAccepted({ for: input, ids: next });
  };

  const tryExample = () => {
    setText(EXAMPLE_README);
    setLoad({ state: "idle" });
  };

  return (
    <section className="gb-doctor" aria-label="README doctor">
      <div className="gb-doctor-input">
        <form className="gb-doctor-load" onSubmit={onLoad}>
          <TextInput
            label="GitHub username"
            description="Loads the README of your profile repository from GitHub."
            value={login}
            onChange={setLogin}
            placeholder="octocat"
            autoCapitalize="off"
            hasAutoCorrect={false}
            hasSpellCheck={false}
            enterKeyHint="go"
          />
          <Button
            label="Load README"
            type="submit"
            isLoading={load.state === "loading"}
          />
        </form>
        {load.state === "error" ? (
          <Banner
            status="warning"
            title={
              load.login
                ? `Could not load the README of ${load.login}`
                : "Could not load a README"
            }
            description={load.message}
            container="card"
          />
        ) : null}
        <TextArea
          label="README"
          description="Paste Markdown. It stays in this browser tab: nothing is uploaded."
          value={text}
          onChange={setText}
          rows={14}
          placeholder={
            "# Hi there\n\n![GitHub stats](https://github-readme-stats.vercel.app/api?username=you)"
          }
          hasSpellCheck={false}
          autoComplete="off"
        />
        <div className="gb-doctor-actions">
          <Button label="Try an example" onClick={tryExample} />
          {text ? (
            <Button label="Clear" variant="ghost" onClick={() => setText("")} />
          ) : null}
        </div>
      </div>

      <div className="gb-doctor-output">
        {input.trim() === "" ? (
          <div className="gb-doctor-empty">
            <EmptyState
              title="Paste a README to check it"
              description="Or load yours by username. The doctor finds every old stats card, swaps the ones that stopped loading, and gives you the fixed Markdown to copy back."
              headingLevel={2}
              actions={<Button label="Try an example" onClick={tryExample} />}
            />
          </div>
        ) : result.changes.length === 0 ? (
          <Banner
            status="info"
            title="No old stats cards in this README"
            description="The doctor recognises github-readme-stats, streak stats, profile trophies, the activity graph, gh-card and the profile summary cards. None of them are here, so there is nothing to fix."
            container="card"
          />
        ) : (
          <>
            <div className="gb-doctor-summary">
              <p aria-live="polite">
                <strong>
                  {result.changes.length === 1
                    ? "1 card found"
                    : `${result.changes.length} cards found`}
                </strong>
                {`: ${summary(counts)}.`}
              </p>
              <CopyButton
                text={result.markdown}
                label="Copy fixed README"
                variant="primary"
              />
            </div>
            <TabList
              role="tablist"
              aria-label="Result"
              value={view}
              onChange={(next) => setView(next === "diff" ? "diff" : "fixed")}
              size="sm"
            >
              <Tab value="fixed" label="Fixed README" panelId={`${id}-fixed`} />
              <Tab value="diff" label="Changes" panelId={`${id}-diff`} />
            </TabList>
            <div
              id={`${id}-fixed`}
              role="tabpanel"
              aria-label="Fixed README"
              hidden={view !== "fixed"}
            >
              {changed ? null : (
                <p className="gb-doctor-quiet">
                  Nothing was replaced yet. Turn on an optional swap below, or
                  copy the README as it is.
                </p>
              )}
              <pre className="gb-doctor-code">
                <code>{result.markdown}</code>
              </pre>
            </div>
            <div
              id={`${id}-diff`}
              role="tabpanel"
              aria-label="Changes"
              hidden={view !== "diff"}
            >
              <DiffView before={input} after={result.markdown} />
            </div>
          </>
        )}
      </div>

      {result.changes.length > 0 ? (
        <div className="gb-doctor-details">
          <Heading level={2} className="gb-doctor-heading">
            What the doctor found
          </Heading>
          <ChangeList changes={result.changes} onToggle={onToggle} />
        </div>
      ) : null}
    </section>
  );
}
