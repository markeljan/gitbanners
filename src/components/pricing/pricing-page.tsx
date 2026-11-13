import "@/components/content/content.css";
import "./pricing.css";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { BlockView } from "@/components/content/blocks";
import { Inline } from "@/components/content/inline";
import { Check } from "@/components/icons";
import { longDate } from "@/content/format";
import { PLANS, PRICING_FAQ, PRO_STEPS, pricing } from "@/content/pricing";
import type { Plan, Section } from "@/content/types";
import { markdownPath } from "@/lib/agent/metadata";
import { PlanAction } from "./plan-action";

function section(id: string): Section {
  const found = pricing.sections.find((entry) => entry.id === id);
  if (!found) throw new Error(`The pricing copy has no section "${id}"`);
  return found;
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <section className="gb-plan" data-plan={plan.id} aria-labelledby={plan.id}>
      <div className="gb-plan-head">
        <Heading level={2} id={plan.id}>
          {plan.name}
        </Heading>
        <p className="gb-plan-price">{plan.price}</p>
        <p className="gb-plan-summary">
          <Inline text={plan.summary} />
        </p>
      </div>
      <ul className="gb-plan-features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <Icon icon={Check} size="sm" color="secondary" />
            <span>
              <Inline text={feature} />
            </span>
          </li>
        ))}
      </ul>
      <div className="gb-plan-foot">
        {plan.id === "pro" ? (
          <PlanAction />
        ) : (
          <Button label="Make a banner" href="/studio" width="100%" />
        )}
      </div>
    </section>
  );
}

function SectionHeading({ id }: { id: string }) {
  return (
    <Heading level={2} id={id}>
      {section(id).title}
    </Heading>
  );
}

/**
 * /pricing: the two plans side by side, how to unlock Pro, the comparison
 * table and the pricing questions. Rendered from the same objects as
 * /pricing.md; only the Pro plan's button depends on the visitor, after
 * hydration.
 */
export function PricingPageView() {
  return (
    <div className="gb-page gb-pricing">
      <article className="gb-article">
        <div className="gb-head">
          <Heading level={1} type="display-3" textWrap="balance">
            {pricing.heading}
          </Heading>
          <p className="gb-lead">
            <Inline text={pricing.lead} />
          </p>
        </div>

        <div className="gb-plans">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>

        <div className="gb-body">
          <SectionHeading id="unlock-pro" />
          <ol className="gb-steps">
            {PRO_STEPS.map((step, index) => (
              <li key={step.title} className="gb-step">
                <span className="gb-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="gb-step-text">
                  <strong className="gb-step-title">{step.title}</strong>
                  <span>
                    <Inline text={step.text} />
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <SectionHeading id="plans" />
          {section("plans").blocks.map((block, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks of static copy, never reordered
            <BlockView key={index} block={block} />
          ))}

          <SectionHeading id="questions" />
          {PRICING_FAQ.map((entry) => (
            <section key={entry.id} aria-labelledby={entry.id}>
              <Heading level={3} id={entry.id}>
                {entry.question}
              </Heading>
              <p>
                <Inline text={entry.answer} />
              </p>
            </section>
          ))}

          <SectionHeading id="paid-plans" />
          {section("paid-plans").blocks.map((block, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks of static copy, never reordered
            <BlockView key={index} block={block} />
          ))}

          <p className="gb-meta">
            Updated{" "}
            <time dateTime={pricing.updated}>{longDate(pricing.updated)}</time>
            {". "}
            <a href={markdownPath(pricing.path)}>Read this page as Markdown</a>.
          </p>
        </div>
      </article>
    </div>
  );
}
