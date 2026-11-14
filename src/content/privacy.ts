import { site } from "@/lib/site";
import { FACTS } from "./facts";
import type { ContentPage } from "./types";

export const privacy: ContentPage = {
  path: "/privacy",
  title: "Privacy",
  description: `What ${site.name} reads from GitHub, what it stores when you sign in, which cookies it sets, who else is involved, and how to delete your account.`,
  updated: "2026-11-13",
  heading: "Privacy",
  lead: `${site.name} draws banners from public GitHub data. You can use all of it without an account, and when you do sign in, very little is kept. This page lists all of it.`,
  sections: [
    {
      id: "summary",
      title: "The short version",
      blocks: [
        {
          type: "list",
          items: [
            "Banners use public GitHub data only. Nothing private is read.",
            "No account is needed. Signing in is only for saving banners and for Pro.",
            "Sign in with GitHub asks for no permissions beyond your public profile, and the access token is never stored.",
            "No advertising, no tracking cookies, no sale or sharing of personal data.",
            "You can delete your account from the dashboard. It is removed at once.",
          ],
        },
      ],
    },
    {
      id: "public-data",
      title: "Banners and public GitHub data",
      blocks: [
        {
          type: "p",
          text: "A banner shows what GitHub already shows to anyone: a public profile, public repositories, the public contribution calendar. Anyone can make a banner of any public account, in the same way anyone can open its GitHub page.",
        },
        {
          type: "list",
          items: [
            `Data read from GitHub is cached for up to ${FACTS.dataRefreshMinutes} minutes. A last good copy is kept for up to ${FACTS.lastGoodDays} days, so a banner still draws when GitHub cannot be reached.`,
            'Private repositories are never read or named. If you turned on "Private contributions" in your GitHub profile settings, GitHub adds those counts to your public calendar, and a banner shows them as counts only.',
            "To change or remove what a banner shows, change it on GitHub. The banner follows.",
          ],
        },
      ],
    },
    {
      id: "visiting",
      title: "Visiting the site",
      blocks: [
        {
          type: "list",
          items: [
            "As with any website, the hosting provider processes your IP address and browser details to deliver pages and images.",
            "Rate limiting counts requests per IP address in short windows, to keep the API and sign-in usable for everyone. An IPv6 address is counted as its /64 network. The counters expire with their window.",
            "Vercel Web Analytics and Speed Insights measure page views and loading speed. They set no cookies.",
            "Your light or dark theme choice is kept in your browser's local storage. It is not sent to the server.",
          ],
        },
      ],
    },
    {
      id: "sign-in",
      title: "Signing in with GitHub",
      blocks: [
        {
          type: "p",
          text: "Signing in is optional. It asks GitHub for no permissions beyond your public profile. GitHub hands the site an access token; it is used during that one request to read your public identity and to check whether you starred the repository, and is then discarded. It is never stored.",
        },
        { type: "p", text: "Stored for each account:" },
        {
          type: "list",
          items: [
            "Your numeric GitHub id, login, display name and avatar URL.",
            "Whether the account has Pro, and when that was last checked.",
            "The banners you saved: a name, the target, the preset and the options.",
            "When the account and each banner were created and last changed.",
          ],
        },
        {
          type: "p",
          text: "No email address, no password, no repository access and no payment details are collected.",
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [
        {
          type: "p",
          text: "Cookies are set only when you sign in. There are three, all first-party:",
        },
        {
          type: "table",
          head: ["Cookie", "What it is for", "Lifetime"],
          rows: [
            [
              "`gb_session`",
              "The signed session: your GitHub id, login, name and avatar URL. Not readable by scripts.",
              `${FACTS.sessionDays} days, renewed while you keep using the site`,
            ],
            [
              "`gb_in`",
              'The value "1", readable by scripts. It tells a page that someone is signed in, so pages ask for account data only when there is some.',
              "Same as the session",
            ],
            [
              "`gb_signin`",
              "The state of one sign-in attempt, so the answer from GitHub can be matched to the browser that asked.",
              `${FACTS.signInMinutes} minutes`,
            ],
          ],
        },
        {
          type: "p",
          text: "On the live site the names carry a `__Host-` prefix. Signing out removes the session cookies.",
        },
      ],
    },
    {
      id: "third-parties",
      title: "Who else is involved",
      blocks: [
        {
          type: "table",
          head: ["Provider", "What for", "Where"],
          rows: [
            [
              "Vercel",
              "Hosting, the CDN, Web Analytics and Speed Insights.",
              "Functions run in Washington, D.C.",
            ],
            [
              "Upstash",
              "The Redis database for accounts, saved banners, cached GitHub data and rate limit counters.",
              "US East",
            ],
            [
              "GitHub",
              "The source of all banner data, and sign-in.",
              "github.com",
            ],
            [
              "Google Fonts",
              "When a banner contains characters that Mona Sans cannot draw, those characters are sent to Google Fonts to fetch a font that can.",
              "Requested by the server",
            ],
            [
              "jsDelivr",
              "Emoji artwork (Twemoji) for emoji that appear on a banner.",
              "Requested by the server",
            ],
          ],
        },
        {
          type: "p",
          text: "The requests to Google Fonts and jsDelivr are made by the server while it draws an image, not by your browser, so those providers do not see who is looking at a banner.",
        },
      ],
    },
    {
      id: "retention",
      title: "Retention and deletion",
      blocks: [
        {
          type: "list",
          items: [
            "Account data is kept until you delete the account.",
            "Deleting the account from the dashboard removes the account record, every saved banner and the Pro status, and signs you out. It happens at once and cannot be undone.",
            "Signing out removes the session cookies and keeps the account.",
            `Cached GitHub data expires by itself, after ${FACTS.lastGoodDays} days at the latest.`,
          ],
        },
      ],
    },
    {
      id: "questions",
      title: "Questions and changes",
      blocks: [
        {
          type: "p",
          text: "For anything this page does not answer, see the [contact page](/contact). When the product changes in a way that affects this page, the page changes with it, and the date at the top is updated.",
        },
      ],
    },
  ],
};
