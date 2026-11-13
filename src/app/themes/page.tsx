import type { Metadata } from "next";
import { JsonLd } from "@/components/content/json-ld";
import { collectionJsonLd } from "@/components/pages/jsonld";
import { THEMES_PAGE, ThemesPage } from "@/components/pages/themes";
import { pageMetadata } from "@/lib/agent/metadata";
import { THEMES } from "@/lib/banner";
import { site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  path: THEMES_PAGE.path,
  title: THEMES_PAGE.title,
  description: THEMES_PAGE.description,
  banner: {
    path: `/${site.exampleLogin}/activity?theme=dracula`,
    alt: `Contribution graph banner for ${site.exampleLogin} in the Dracula theme`,
  },
  // No Markdown version of this page yet: do not point agents at one.
  markdown: false,
});

/** /themes: static, rendered at build time. Theme ids are anchors: /themes#dracula. */
export default function ThemesRoute() {
  return (
    <>
      <JsonLd
        data={collectionJsonLd({
          path: THEMES_PAGE.path,
          title: THEMES_PAGE.title,
          description: THEMES_PAGE.description,
          heading: THEMES_PAGE.heading,
          items: THEMES.map((theme) => ({
            name: theme.name,
            path: `/themes#${theme.id}`,
          })),
        })}
      />
      <ThemesPage />
    </>
  );
}
