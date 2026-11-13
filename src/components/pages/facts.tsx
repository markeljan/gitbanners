import { Heading } from "@astryxdesign/core/Heading";
import Link from "next/link";
import { bannerPath, formatNumber } from "@/lib/banner";
import {
  type Entity,
  isValidLogin,
  type RepoSummary,
} from "@/lib/github/schema";
import { ownerPath } from "@/lib/reserved";
import { headlineFacts, languageFacts } from "./copy";

function RepoLink({ repo }: { repo: RepoSummary }) {
  const target = { kind: "repo", owner: repo.owner, name: repo.name } as const;
  return (
    <li>
      <Link href={bannerPath(target)} prefetch={false} className="gb-link">
        {repo.owner}/{repo.name}
      </Link>
      {`: ${formatNumber(repo.stars)} stars`}
      {repo.language ? `, ${repo.language.name}` : ""}
      {repo.description ? `. ${repo.description}` : ""}
    </li>
  );
}

function PersonLinks({
  people,
  label,
}: {
  people: readonly { login: string; detail?: string }[];
  label: string;
}) {
  return (
    <ul className="gb-facts-inline" aria-label={label}>
      {people.map((person) => (
        <li key={person.login}>
          {/* Bots ("dependabot[bot]") have no page of their own. */}
          {isValidLogin(person.login) ? (
            <Link
              href={ownerPath(person.login.toLowerCase())}
              prefetch={false}
              className="gb-link"
            >
              {person.login}
            </Link>
          ) : (
            person.login
          )}
          {person.detail ? ` ${person.detail}` : ""}
        </li>
      ))}
    </ul>
  );
}

/**
 * The facts block: what the banner shows, as text a search engine or an
 * agent can read, with links to the pages of related accounts and
 * repositories. Numbers in full.
 */
export function Facts({ entity }: { entity: Entity }) {
  const facts = headlineFacts(entity);
  const languages = languageFacts(entity);
  const repos = entity.kind === "repo" ? [] : entity.repos;
  return (
    <div className="gb-facts">
      <div>
        <Heading level={3} className="gb-h3">
          Numbers
        </Heading>
        <dl className="gb-facts-list">
          {facts.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="gb-entity-note">
          Read from GitHub on{" "}
          <time dateTime={entity.fetchedAt}>
            {entity.fetchedAt.slice(0, 10)}
          </time>
          . The banners refresh on their own.
        </p>
      </div>
      <div className="gb-facts-side">
        {languages.length > 0 ? (
          <section aria-labelledby="facts-languages">
            <Heading level={3} id="facts-languages" className="gb-h3">
              Languages
            </Heading>
            <p>{languages.join(", ")}.</p>
          </section>
        ) : null}
        {entity.kind === "repo" && entity.topics.length > 0 ? (
          <section aria-labelledby="facts-topics">
            <Heading level={3} id="facts-topics" className="gb-h3">
              Topics
            </Heading>
            <ul className="gb-facts-inline">
              {entity.topics.map((topic) => (
                <li key={topic}>
                  <code className="gb-code-inline">{topic}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {repos.length > 0 ? (
          <section aria-labelledby="facts-repos">
            <Heading level={3} id="facts-repos" className="gb-h3">
              Top repositories
            </Heading>
            <ul className="gb-facts-rows">
              {repos.map((repo) => (
                <RepoLink key={`${repo.owner}/${repo.name}`} repo={repo} />
              ))}
            </ul>
          </section>
        ) : null}
        {entity.kind === "user" && entity.organizations.length > 0 ? (
          <section aria-labelledby="facts-orgs">
            <Heading level={3} id="facts-orgs" className="gb-h3">
              Organizations
            </Heading>
            <PersonLinks
              people={entity.organizations}
              label="Public organization memberships"
            />
          </section>
        ) : null}
        {entity.kind === "org" && entity.people.length > 0 ? (
          <section aria-labelledby="facts-people">
            <Heading level={3} id="facts-people" className="gb-h3">
              People
            </Heading>
            <p>
              {formatNumber(entity.stats.members ?? entity.people.length)}{" "}
              public members, among them:
            </p>
            <PersonLinks
              people={entity.people.slice(0, 12)}
              label="Public members"
            />
          </section>
        ) : null}
        {entity.kind === "repo" && entity.contributors.length > 0 ? (
          <section aria-labelledby="facts-contributors">
            <Heading level={3} id="facts-contributors" className="gb-h3">
              Top contributors
            </Heading>
            <PersonLinks
              people={entity.contributors.slice(0, 10).map((person) => ({
                login: person.login,
                detail: `(${formatNumber(person.contributions)} commits)`,
              }))}
              label="Top contributors by commits"
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
