import "./pages.css";

import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { estimateBannerBox } from "@/components/banner/box";
import { Container } from "@/components/site/page";
import { PARAMETER_DOCS } from "@/lib/api/parameters";
import { DEFAULT_THEME_ID, getTheme, THEMES } from "@/lib/banner";
import { site } from "@/lib/site";
import { ThemesBrowser } from "./themes-browser";

/** The words of /themes. */
export const THEMES_PAGE = {
  path: "/themes",
  title: "GitHub banner themes: Dracula, Tokyo Night, Nord and more",
  description: `All ${THEMES.length} GitHub banner themes with their colours: GitHub dark, light and dimmed, Dracula, Tokyo Night, Catppuccin, Nord, Gruvbox, Solarized and more.`,
  heading: "Banner themes",
} as const;

/** Query keys that set one colour on top of a theme. */
const COLOR_KEYS = new Set([
  "bg",
  "surface",
  "border_color",
  "text",
  "muted",
  "accent",
  "heat",
]);

/**
 * /themes: every theme on a real banner with its colours, a filter, and how
 * to set colours by hand. Static.
 */
export function ThemesPage() {
  const login = site.exampleLogin;
  const box = estimateBannerBox({
    target: { kind: "owner", login },
    preset: "activity",
    query: "",
  });
  const fallback = getTheme(DEFAULT_THEME_ID);
  const colors = PARAMETER_DOCS.filter((doc) => COLOR_KEYS.has(doc.name));
  return (
    <Container className="gb-gallery">
      <div className="gb-gallery-head">
        <Heading level={1} className="gb-display">
          {THEMES_PAGE.heading}
        </Heading>
        <Text as="p" color="secondary" className="gb-lead">
          A theme sets every colour of a banner at once: the canvas, cards,
          lines, text, links and the five steps of the contribution graph. Add{" "}
          <code className="gb-code-inline">?theme=</code> and an id to any
          banner URL. Without one, banners use {fallback.name}, the same colours
          github.com uses. Here are all {THEMES.length}, each on the activity
          banner of @{login}.
        </Text>
      </div>

      <ThemesBrowser login={login} width={box.width} height={box.height} />

      <section className="gb-entity-section" aria-labelledby="custom-title">
        <div className="gb-entity-section-head">
          <Heading level={2} id="custom-title" className="gb-h2">
            Custom colours
          </Heading>
          <Text as="p" color="secondary">
            Start from any theme and replace single colours in the URL, as hex
            without the #. For example{" "}
            <code className="gb-code-inline">
              /{login}.svg?theme=nord&amp;accent=a855f7&amp;heat=a855f7
            </code>{" "}
            keeps Nord and paints links and the graph purple. One heat colour
            becomes a five-step ramp; five colours are used as given.
          </Text>
        </div>
        <div className="gb-table-wrap">
          <table className="gb-table">
            <caption className="sr-only">Colour parameters</caption>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">What it colours</th>
                <th scope="col">Example</th>
              </tr>
            </thead>
            <tbody>
              {colors.map((doc) => (
                <tr key={doc.name}>
                  <th scope="row">
                    <code className="gb-code-inline">{doc.name}</code>
                  </th>
                  <td>{doc.description}</td>
                  <td>
                    <code className="gb-code-inline">
                      {doc.name}={doc.example}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Container>
  );
}
