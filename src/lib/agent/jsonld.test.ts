import { afterEach, describe, expect, test } from "bun:test";
import { FAQ } from "@/content/faq";
import { home } from "@/content/home";
import { plainInline } from "@/content/inline";
import { contentMarkdown } from "@/content/pages";
import { pricing } from "@/content/pricing";
import { SAMPLE_ORG, SAMPLE_REPO, SAMPLE_USER } from "@/lib/github/samples";
import { site } from "@/lib/site";
import {
  entityJsonLd,
  homeJsonLd,
  ldJson,
  organizationNode,
  PRODUCT_TERMS,
  pageJsonLd,
} from "./jsonld";
import { markdownPath, pageMetadata, previewImagePath } from "./metadata";

type Node = Record<string, unknown>;
const nodes = (graph: Node) => graph["@graph"] as Node[];
const byType = (graph: Node, type: string) =>
  nodes(graph).find((node) => node["@type"] === type);

describe("homepage structured data", () => {
  const graph = homeJsonLd(FAQ);

  test("names the publisher, the site, the product, the FAQ and the trail", () => {
    expect(graph["@context"]).toBe("https://schema.org");
    expect(nodes(graph).map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
      "FAQPage",
      "BreadcrumbList",
    ]);
  });

  test("the product has a category and two free offers", () => {
    const app = byType(graph, "SoftwareApplication");
    expect(app?.name).toBe(site.name);
    expect(app?.applicationCategory).toBe("DeveloperApplication");
    const offers = app?.offers as Node[];
    expect(offers.map((offer) => offer.name)).toEqual(["Free", "Pro"]);
    for (const offer of offers) expect(offer.price).toBe("0");
    expect(String(app?.image)).toContain(`/${site.exampleLogin}.png?size=og`);
  });

  test("product terms are phrases the homepage really shows", () => {
    const shown = plainInline(contentMarkdown(home)).toLowerCase();
    expect(PRODUCT_TERMS.length).toBeGreaterThan(0);
    for (const term of PRODUCT_TERMS) {
      expect(`${term}: ${shown.includes(term.toLowerCase())}`).toBe(
        `${term}: true`,
      );
    }
  });

  test("the FAQ node holds the questions shown, as plain text", () => {
    const faq = byType(graph, "FAQPage");
    const entities = faq?.mainEntity as Node[];
    expect(entities.map((entity) => entity.name)).toEqual(
      FAQ.map((entry) => entry.question),
    );
    const answers = entities.map(
      (entity) => (entity.acceptedAnswer as Node).text as string,
    );
    expect(answers).toEqual(FAQ.map((entry) => plainInline(entry.answer)));
    // Links are flattened to their text: no site-relative Markdown link is left.
    for (const answer of answers) expect(answer).not.toMatch(/\]\(\//);
  });
});

describe("organization node", () => {
  test("links the repository and the maintainer, and invents nothing", () => {
    const org = organizationNode();
    expect(org.sameAs).toEqual([site.repo.url, site.maintainer.url]);
    expect((org.contactPoint as Node).contactType).toBe("customer support");
    expect((org.contactPoint as Node).url).toBe(`${site.url}/contact`);
    // Neither is configured in the test environment.
    expect(site.contactEmail).toBeNull();
    expect(site.address).toBeNull();
    expect(org.email).toBeUndefined();
    expect((org.contactPoint as Node).email).toBeUndefined();
    expect(org.address).toBeUndefined();
    expect(JSON.stringify(org)).not.toContain("telephone");
  });
});

describe("content page structured data", () => {
  test("a page and its breadcrumb", () => {
    const graph = pageJsonLd(pricing);
    const page = byType(graph, "WebPage");
    expect(page?.url).toBe(`${site.url}/pricing`);
    expect(page?.dateModified).toBe(pricing.updated);
    const crumbs = byType(graph, "BreadcrumbList")?.itemListElement as Node[];
    expect(crumbs.map((crumb) => crumb.name)).toEqual(["Home", "Pricing"]);
    expect(crumbs.map((crumb) => crumb.position)).toEqual([1, 2]);
  });
});

describe("banner page structured data", () => {
  test("a user is a Person, an organization an Organization", () => {
    const user = byType(
      entityJsonLd(SAMPLE_USER, { title: "t", description: "d" }),
      "WebPage",
    );
    expect((user?.about as Node | undefined)?.["@type"]).toBe("Person");
    expect((user?.about as Node | undefined)?.url).toBe(
      `https://github.com/${SAMPLE_USER.login}`,
    );
    expect(user?.url).toBe(`${site.url}/${SAMPLE_USER.login.toLowerCase()}`);
    const org = byType(
      entityJsonLd(SAMPLE_ORG, { title: "t", description: "d" }),
      "WebPage",
    );
    expect((org?.about as Node | undefined)?.["@type"]).toBe("Organization");
  });

  test("a repository is source code, below its owner in the trail", () => {
    const graph = entityJsonLd(SAMPLE_REPO, {
      title: "t",
      description: "d",
      preset: "contributors",
    });
    const page = byType(graph, "WebPage");
    expect(page?.url).toBe(`${site.url}/vercel/next.js/contributors`);
    expect((page?.about as Node | undefined)?.["@type"]).toBe(
      "SoftwareSourceCode",
    );
    expect((page?.about as Node | undefined)?.codeRepository).toBe(
      "https://github.com/vercel/next.js",
    );
    expect((page?.primaryImageOfPage as Node | undefined)?.url).toBe(
      `${site.url}/vercel/next.js/contributors.png?size=og`,
    );
    const crumbs = byType(graph, "BreadcrumbList")?.itemListElement as Node[];
    expect(crumbs.map((crumb) => crumb.name)).toEqual([
      "Home",
      "vercel",
      "next.js",
    ]);
  });
});

describe("ldJson", () => {
  test("cannot close the script element it is printed into", () => {
    const out = ldJson({ bio: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).bio).toBe("</script><script>alert(1)</script>");
  });
});

describe("pageMetadata", () => {
  const restore = () => {};
  afterEach(() => restore());

  test("fills canonical, Markdown alternate, Open Graph and the X card", () => {
    const meta = pageMetadata(pricing);
    expect(meta.title).toBe("Pricing");
    expect(meta.alternates).toEqual({
      canonical: "/pricing",
      types: { "text/markdown": "/pricing.md" },
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.type).toBe("website");
    expect(og.url).toBe("/pricing");
    expect(og.title).toBe(`Pricing · ${site.name}`);
    expect(og.images).toEqual([
      {
        url: `/${site.exampleLogin}.png?size=og`,
        width: 1200,
        height: 630,
        alt: expect.stringContaining(site.exampleLogin),
      },
    ]);
    const twitter = meta.twitter as Record<string, unknown>;
    expect(twitter.card).toBe("summary_large_image");
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  test("a title that names the site stands alone", () => {
    const meta = pageMetadata(home);
    expect(meta.title).toEqual({ absolute: home.title });
    expect((meta.openGraph as Record<string, unknown>).title).toBe(home.title);
    expect(meta.alternates?.types).toEqual({ "text/markdown": "/index.md" });
  });

  test("banner pages preview their own banner and can opt out of indexing", () => {
    const meta = pageMetadata({
      path: "/vercel/next.js",
      title: "vercel/next.js GitHub banner",
      description: "d",
      banner: { path: "/vercel/next.js/contributors", alt: "alt" },
      noindex: true,
      markdown: false,
    });
    expect(
      (meta.openGraph as { images: { url: string }[] }).images[0].url,
    ).toBe("/vercel/next.js/contributors.png?size=og");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toEqual({ canonical: "/vercel/next.js" });
  });

  test("helpers", () => {
    expect(markdownPath("/")).toBe("/index.md");
    expect(markdownPath("/docs")).toBe("/docs.md");
    expect(previewImagePath("/torvalds?theme=dracula")).toBe(
      "/torvalds.png?theme=dracula&size=og",
    );
    expect(previewImagePath("/torvalds?size=x")).toBe("/torvalds.png?size=og");
  });
});
