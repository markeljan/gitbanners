# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** (GitHub's private vulnerability reporting). Do not open a public issue for a security problem.

Include what you found, the URL or code path involved, steps to reproduce and what an attacker could do with it. You will get an answer as soon as the maintainer can look at it, and a fix will be credited to you in the advisory unless you would rather not be named.

## In scope

- The site at https://gitbanners.com and this repository's code.
- Sign in with GitHub, sessions and their cookies, CSRF protection of the account routes.
- Saved banners and the account API: reading, changing or deleting another person's banners or account.
- The Pro check: getting Pro without starring, or taking it from someone else.
- Image rendering: making the server fetch something it should not (SSRF), injecting script or external resources into a served SVG, or exhausting the renderer with a crafted URL.
- The JSON API and the MCP server: bypassing rate limits at scale, leaking data that is not public on GitHub.
- Secrets or tokens exposed in responses, logs or the client bundle.

## Out of scope

- Public GitHub data shown on a banner. Banners only draw what GitHub already shows publicly.
- Denial of service by sheer volume, and reports from automated scanners without a demonstrated impact.
- Missing security headers on responses where they change nothing, and clickjacking of pages with no state-changing action.
- Vulnerabilities in GitHub, Vercel or Upstash themselves: report those to them.

Please do not access other people's data, run destructive tests against the live site, or degrade it for others while you investigate.
