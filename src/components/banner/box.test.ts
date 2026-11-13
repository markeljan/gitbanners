import { describe, expect, test } from "bun:test";
import { buildBanner, resolveOptions } from "@/lib/banner";
import { SAMPLE_USER } from "@/lib/github/samples";
import { estimateBannerBox, parseBannerRef } from "./box";
import { bannerNow } from "./build";

describe("parseBannerRef", () => {
  test("an owner path", () => {
    const ref = parseBannerRef("/torvalds");
    expect(ref?.target).toEqual({ kind: "owner", login: "torvalds" });
    expect(ref?.preset).toBeNull();
    expect(ref?.query).toBe("");
    expect(ref?.page).toBe("/torvalds");
    expect(ref?.image("svg")).toBe("/torvalds.svg");
    expect(ref?.image("png")).toBe("/torvalds.png");
  });
  test("an owner preset with options: the query is made canonical", () => {
    const ref = parseBannerRef("/gaearon/stats?theme=dracula&junk=1");
    expect(ref?.preset).toBe("stats");
    expect(ref?.query).toBe("theme=dracula");
    expect(ref?.image("svg")).toBe("/gaearon/stats.svg?theme=dracula");
    expect(ref?.page).toBe("/gaearon");
  });
  test("a repository with a preset keeps the dot in its name", () => {
    const ref = parseBannerRef("/vercel/next.js/contributors");
    expect(ref?.target).toEqual({
      kind: "repo",
      owner: "vercel",
      name: "next.js",
    });
    expect(ref?.preset).toBe("contributors");
    expect(ref?.image("svg")).toBe("/vercel/next.js/contributors.svg");
    expect(ref?.page).toBe("/vercel/next.js");
  });
  test("owners are lower-cased in URLs, repository names are not", () => {
    const ref = parseBannerRef("/Vercel/Next.js");
    expect(ref?.image("svg")).toBe("/vercel/Next.js.svg");
  });
  test("a login that collides with an app route is escaped", () => {
    expect(parseBannerRef("/@docs")?.page).toBe("/@docs");
    expect(parseBannerRef("/docs")).toBeNull();
  });
  test("anything that is not a banner path is null", () => {
    expect(parseBannerRef("")).toBeNull();
    expect(parseBannerRef("/")).toBeNull();
    expect(parseBannerRef("/a/b/c/d")).toBeNull();
    expect(parseBannerRef("/wp-login.php")).toBeNull();
  });
});

describe("estimateBannerBox", () => {
  const box = (path: string, kind?: "user" | "org" | "repo") => {
    const ref = parseBannerRef(path);
    if (!ref) throw new Error(`not a banner path: ${path}`);
    return estimateBannerBox(ref, kind);
  };
  test("fixed canvases are exact", () => {
    expect(box("/anyone?size=x")).toEqual({ width: 1500, height: 500 });
    expect(box("/anyone?size=og")).toEqual({ width: 1200, height: 630 });
    expect(box("/acme/rocket/social")).toEqual({ width: 1280, height: 640 });
    expect(box("/anyone?size=square")).toEqual({ width: 1080, height: 1080 });
  });
  test("a bundled sample gives the real size of its card", () => {
    const built = buildBanner(SAMPLE_USER, resolveOptions("user", "overview"), {
      image: () => "",
      now: bannerNow(SAMPLE_USER),
      host: "any.host",
    });
    expect(box(`/${SAMPLE_USER.login}`)).toEqual({
      width: built.width,
      height: built.height,
    });
  });
  test("measures with a brand mark, like the image route draws it", () => {
    // The languages card gives the mark a line of its own: measured without
    // a host it would come out shorter than the real image.
    const env = { image: () => "", now: bannerNow(SAMPLE_USER) };
    const options = resolveOptions("user", "languages");
    const marked = buildBanner(SAMPLE_USER, options, { ...env, host: "a.b" });
    const bare = buildBanner(SAMPLE_USER, options, { ...env, host: "" });
    expect(marked.height).toBeGreaterThan(bare.height);
    expect(box(`/${SAMPLE_USER.login}/languages`).height).toBe(marked.height);
  });
  test("an unknown owner is estimated from demo data of the stated kind", () => {
    const user = box("/someone-unknown");
    const org = box("/someone-unknown", "org");
    expect(user.width).toBe(846);
    expect(org.width).toBe(846);
    expect(user.height).toBeGreaterThan(120);
    expect(org.height).toBeGreaterThan(120);
    // Users get the contribution graph, organizations a row of people.
    expect(user.height).not.toBe(org.height);
  });
  test("the compact card keeps its own width", () => {
    expect(box("/someone-unknown/card").width).toBe(495);
  });
  test("a repository path ignores the kind hint", () => {
    expect(box("/acme/rocket", "user")).toEqual(box("/acme/rocket"));
  });
});
