import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Container } from "@/components/site/page";
import { HeroPlayground } from "./hero-playground";

export interface HeroProps {
  heading: string;
  lead: string;
}

/**
 * Top of the homepage: the page's `<h1>`, one sentence, and the playground.
 * The copy is rendered on the server; only the playground hydrates.
 */
export function Hero({ heading, lead }: HeroProps) {
  return (
    <Container as="section" className="gb-hero" aria-labelledby="hero-title">
      <div className="gb-hero-copy">
        <Heading
          level={1}
          id="hero-title"
          type="display-1"
          justify="center"
          textWrap="balance"
          className="gb-display"
        >
          {heading}
        </Heading>
        <Text
          as="p"
          color="secondary"
          justify="center"
          textWrap="balance"
          className="gb-hero-lead gb-lead"
        >
          {lead}
        </Text>
      </div>
      <HeroPlayground />
    </Container>
  );
}
