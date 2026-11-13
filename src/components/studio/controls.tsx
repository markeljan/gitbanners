"use client";

import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Link } from "@astryxdesign/core/Link";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PresetPicker } from "@/components/banner/preset-picker";
import { SizePicker } from "@/components/banner/size-picker";
import { TargetInput } from "@/components/banner/target-input";
import { KIND_LABELS } from "@/components/banner/target-options";
import { ThemePicker } from "@/components/banner/theme-picker";
import { useProRepo, useSignInAvailable } from "@/components/providers";
import { signInHref } from "@/components/site/links";
import {
  type FontId,
  getPreset,
  getTheme,
  OPTION_LIMITS,
  presetDefaults,
  type SectionId,
  SIZES,
  type StatId,
} from "@/lib/banner";
import { MIN_YEAR } from "@/lib/github/calendar";
import { ColorField } from "./color-field";
import {
  COLOR_FIELDS,
  colorOf,
  HIDE_BY_KIND,
  moveItem,
  SECTION_LABELS,
  SECTIONS_BY_KIND,
  STAT_LABELS,
  STATS_BY_KIND,
  yearChoices,
} from "./state";
import { useStudioContext } from "./use-studio";

/** Sections whose length `count` sets. */
const COUNTED: readonly SectionId[] = [
  "repos",
  "contributors",
  "people",
  "languages",
];

function TargetControls() {
  const studio = useStudioContext();
  return (
    <div className="gb-studio-stack">
      <TargetInput
        label="GitHub username or owner/repo"
        value={studio.text}
        onValueChange={studio.setText}
        onCommit={(target) => studio.setTarget(target, true)}
        onPreview={(target) => studio.setTarget(target, false)}
      />
      <div className="gb-studio-row">
        <Token
          label={KIND_LABELS[studio.kind]}
          size="sm"
          aria-label={`Kind: ${KIND_LABELS[studio.kind]}`}
        />
        <Text type="supporting" color="secondary">
          {studio.state.target
            ? "Presets and stats follow the kind."
            : "A sample profile. Type a username to start."}
        </Text>
      </div>
    </div>
  );
}

function SizeControls() {
  const { options, setOptions } = useStudioContext();
  const size = SIZES[options.size];
  return (
    <div className="gb-studio-stack">
      <SizePicker
        value={options.size}
        size="sm"
        onChange={(next) =>
          setOptions({ size: next, width: null, height: null })
        }
      />
      <div className="gb-studio-pair">
        <NumberInput
          label="Width"
          value={options.width}
          placeholder={String(size.width)}
          min={OPTION_LIMITS.width.min}
          max={OPTION_LIMITS.width.max}
          step={10}
          units="px"
          isIntegerOnly
          hasClear
          size="sm"
          onChange={(width) => setOptions({ width }, "width")}
        />
        <NumberInput
          label="Height"
          value={options.height}
          placeholder={size.height ? String(size.height) : "Auto"}
          min={OPTION_LIMITS.height.min}
          max={OPTION_LIMITS.height.max}
          step={10}
          units="px"
          isIntegerOnly
          hasClear
          size="sm"
          onChange={(height) => setOptions({ height }, "height")}
        />
      </div>
      <Text as="p" type="supporting" color="secondary">
        {`Custom sizes from ${OPTION_LIMITS.width.min} to ${OPTION_LIMITS.width.max} px. Clear a field to use the size's own.`}
      </Text>
    </div>
  );
}

function ColorControls() {
  const { options, setColor } = useStudioContext();
  const theme = getTheme(options.theme).colors;
  return (
    <div className="gb-studio-stack">
      {COLOR_FIELDS.map((field) => {
        const color = colorOf(theme, options, field.id);
        return (
          <ColorField
            key={field.id}
            label={field.label}
            value={color.value}
            isOverridden={color.isOverridden}
            onChange={(hex) => setColor(field.id, hex)}
          />
        );
      })}
      <ColorField
        label="Contribution colour"
        description="One colour; the lighter steps are built from it."
        {...colorOf(theme, options, "heat")}
        onChange={(hex) => setColor("heat", hex)}
      />
    </div>
  );
}

function FrameControls() {
  const { options, setOptions } = useStudioContext();
  return (
    <div className="gb-studio-stack">
      <SegmentedControl
        label="Font"
        size="sm"
        layout="fill"
        value={options.font}
        onChange={(font) => setOptions({ font: font as FontId })}
      >
        <SegmentedControlItem value="mona" label="Mona Sans" />
        <SegmentedControlItem value="mono" label="Mona Sans Mono" />
      </SegmentedControl>
      <NumberInput
        label="Corner radius"
        value={options.radius}
        placeholder="Auto"
        min={OPTION_LIMITS.radius.min}
        max={OPTION_LIMITS.radius.max}
        units="px"
        isIntegerOnly
        hasClear
        size="sm"
        onChange={(radius) => setOptions({ radius }, "radius")}
      />
      <SegmentedControl
        label="Border"
        size="sm"
        layout="fill"
        value={options.border === null ? "auto" : options.border ? "on" : "off"}
        onChange={(value) =>
          setOptions({ border: value === "auto" ? null : value === "on" })
        }
      >
        <SegmentedControlItem value="auto" label="Auto" />
        <SegmentedControlItem value="on" label="On" />
        <SegmentedControlItem value="off" label="Off" />
      </SegmentedControl>
    </div>
  );
}

function StatsControl() {
  const { kind, options, preset, setOptions } = useStudioContext();
  const fallback =
    presetDefaults(kind, preset)?.stats ??
    presetDefaults(kind, getPreset(kind, null).id)?.stats ??
    [];
  const chosen: readonly StatId[] = options.stats ?? fallback;
  const rest = STATS_BY_KIND[kind].filter((id) => !chosen.includes(id));
  const set = (stats: StatId[]) =>
    setOptions({ stats: stats.length > 0 ? stats : null });
  return (
    <fieldset className="gb-studio-fieldset">
      <legend>
        <Text type="label">Stats, in order</Text>
      </legend>
      <ul className="gb-stat-list">
        {chosen.map((id, at) => (
          <li key={id} className="gb-stat-row">
            <CheckboxInput
              label={STAT_LABELS[id]}
              size="sm"
              value
              onChange={() => set(chosen.filter((stat) => stat !== id))}
            />
            <IconButton
              label={`Move ${STAT_LABELS[id].toLowerCase()} up`}
              icon={<Icon icon={ArrowUp} />}
              size="sm"
              variant="ghost"
              isDisabled={at === 0}
              onClick={() => set(moveItem(chosen, at, -1))}
            />
            <IconButton
              label={`Move ${STAT_LABELS[id].toLowerCase()} down`}
              icon={<Icon icon={ArrowDown} />}
              size="sm"
              variant="ghost"
              isDisabled={at === chosen.length - 1}
              onClick={() => set(moveItem(chosen, at, 1))}
            />
          </li>
        ))}
        {rest.map((id) => (
          <li key={id} className="gb-stat-row">
            <CheckboxInput
              label={STAT_LABELS[id]}
              size="sm"
              value={false}
              onChange={() => set([...chosen, id])}
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ContentControls() {
  const studio = useStudioContext();
  const { kind, options, preset, entity, setOptions } = studio;
  const sections = options.sections ?? getPreset(kind, preset).sections;
  const hidden = new Set(options.hide);
  const years =
    kind === "user"
      ? yearChoices(
          entity?.kind === "user" ? entity.createdAt : null,
          new Date(),
          MIN_YEAR,
        )
      : [];
  const isCounted = sections.some((id) => COUNTED.includes(id));
  return (
    <div className="gb-studio-stack">
      <TextInput
        label="Title"
        description={`Replaces the name. Up to ${OPTION_LIMITS.title} characters.`}
        value={options.title ?? ""}
        placeholder={
          entity?.kind === "repo"
            ? entity.name
            : entity
              ? (entity.name ?? entity.login)
              : ""
        }
        hasClear
        size="sm"
        width="100%"
        onChange={(title) =>
          setOptions(
            { title: title.slice(0, OPTION_LIMITS.title) || null },
            "title",
          )
        }
      />
      {kind === "user" ? (
        <Selector
          label="Year"
          size="sm"
          value={options.year === null ? "last" : String(options.year)}
          options={[
            { value: "last", label: "Last 12 months" },
            ...years.map((year) => ({
              value: String(year),
              label: String(year),
            })),
          ]}
          onChange={(value) =>
            setOptions({ year: value === "last" ? null : Number(value) })
          }
          width="100%"
        />
      ) : null}
      <fieldset className="gb-studio-fieldset">
        <legend>
          <Text type="label">Sections</Text>
        </legend>
        {SECTIONS_BY_KIND[kind].map((id) => (
          <CheckboxInput
            key={id}
            label={SECTION_LABELS[id]}
            size="sm"
            value={sections.includes(id)}
            onChange={(checked) => {
              const next = SECTIONS_BY_KIND[kind].filter((section) =>
                section === id ? checked : sections.includes(section),
              );
              setOptions({ sections: next.length > 0 ? next : null });
            }}
          />
        ))}
      </fieldset>
      {sections.includes("stats") ? <StatsControl /> : null}
      <fieldset className="gb-studio-fieldset">
        <legend>
          <Text type="label">Show</Text>
        </legend>
        {HIDE_BY_KIND[kind].map(({ id, label }) => (
          <CheckboxInput
            key={id}
            label={label}
            size="sm"
            value={!hidden.has(id)}
            onChange={(shown) =>
              setOptions({
                hide: shown
                  ? options.hide.filter((item) => item !== id)
                  : [...options.hide, id],
              })
            }
          />
        ))}
      </fieldset>
      {isCounted ? (
        <NumberInput
          label="How many to show"
          description="Repositories, people or languages. Clear it to fit the layout."
          value={options.count}
          placeholder="Auto"
          min={OPTION_LIMITS.count.min}
          max={OPTION_LIMITS.count.max}
          isIntegerOnly
          hasClear
          size="sm"
          onChange={(count) => setOptions({ count }, "count")}
        />
      ) : null}
    </div>
  );
}

function ProControls() {
  const { options, setOptions, me, href } = useStudioContext();
  const repo = useProRepo();
  const signInAvailable = useSignInAvailable();
  const { canHideBrand, canAnimate } = me.entitlements;
  const isPro = me.pro;
  return (
    <div className="gb-studio-stack">
      <Switch
        label="Hide the brand mark"
        value={!options.brand}
        isDisabled={!canHideBrand}
        disabledMessage="Pro: star the repository to remove the mark"
        labelPosition="start"
        labelSpacing="spread"
        size="sm"
        onChange={(hide) => setOptions({ brand: !hide })}
      />
      <Switch
        label="Animate the contribution graph"
        value={options.animate}
        isDisabled={!canAnimate}
        disabledMessage="Pro: star the repository to animate the graph"
        labelPosition="start"
        labelSpacing="spread"
        size="sm"
        onChange={(animate) => setOptions({ animate })}
      />
      <Text as="p" type="supporting" color="secondary">
        Both apply to saved banners only. Copied links and downloads always show
        the mark and stay still, and the preview does not animate.
      </Text>
      {/* Pro needs an account: nothing to offer where nobody can sign in. */}
      {isPro || !signInAvailable ? null : (
        <Text as="p" type="supporting" color="secondary">
          {"Pro is free: "}
          <Link href={repo.url} isExternalLink>
            Star the repository
          </Link>
          {me.status === "signed-in" ? (
            <>
              {", then "}
              <a className="gb-inline-link" href={signInHref(href)}>
                check again
              </a>
              .
            </>
          ) : (
            <>
              {" and "}
              <a className="gb-inline-link" href={signInHref(href)}>
                sign in with GitHub
              </a>
              .
            </>
          )}
        </Text>
      )}
    </div>
  );
}

const SECTIONS = [
  { value: "target", title: "Banner", body: TargetControls },
  { value: "preset", title: "Layout", body: PresetControls },
  { value: "size", title: "Canvas", body: SizeControls },
  { value: "theme", title: "Colours", body: ThemeControls },
  { value: "colors", title: "Colour overrides", body: ColorControls },
  { value: "frame", title: "Frame and type", body: FrameControls },
  { value: "content", title: "Content", body: ContentControls },
  { value: "pro", title: "Pro", body: ProControls },
] as const;

function PresetControls() {
  const { kind, preset, setPreset } = useStudioContext();
  return (
    <PresetPicker
      kind={kind}
      value={preset}
      onChange={setPreset}
      variant="list"
      label="Preset"
      size="sm"
    />
  );
}

function ThemeControls() {
  const { options, setOptions } = useStudioContext();
  return (
    <ThemePicker
      value={options.theme}
      onChange={(theme) => setOptions({ theme })}
      label="Banner theme"
    />
  );
}

/** Every option of the banner, in collapsible groups. */
export function StudioControls() {
  return (
    <CollapsibleGroup
      type="multiple"
      defaultValue={["target", "preset", "size", "theme"]}
      hasDividers
    >
      {SECTIONS.map(({ value, title, body: Body }) => (
        <Collapsible
          key={value}
          value={value}
          trigger={<Text type="label">{title}</Text>}
        >
          <div className="gb-studio-group">
            <Body />
          </div>
        </Collapsible>
      ))}
    </CollapsibleGroup>
  );
}
