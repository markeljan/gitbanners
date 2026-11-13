"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Star } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { knownTargets } from "@/hooks/targets";
import { prefetchEntity } from "@/hooks/use-entity";
import {
  rememberRecentTarget,
  useRecentTargets,
} from "@/hooks/use-recent-targets";
import { useSuggestions } from "@/hooks/use-suggestions";
import { type BannerTarget, formatCount } from "@/lib/banner";
import { parseTargetSlug, targetSlug } from "@/lib/embed";
import { browserImage } from "./scale";
import {
  buildOptionGroups,
  findOption,
  KIND_LABELS,
  moveActive,
  optionForTarget,
  POPULAR_TARGETS,
  type TargetOption,
  targetFromUrl,
} from "./target-options";

/**
 * How long typing must pause before text is looked up when the search is
 * unavailable and cannot say whether the name exists.
 */
export const SETTLE_MS = 350;
/** A top suggestion is fetched ahead once it has been on screen this long. */
const PREFETCH_TOP_MS = 120;

export interface TargetInputProps {
  /** Text in the field. The component is controlled. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * The visitor chose a target on purpose: Enter, a picked suggestion, Tab
   * on a highlighted one, or a pasted github.com URL.
   */
  onCommit: (target: BannerTarget) => void;
  /**
   * The typed text became a target known to exist: it equals a suggestion,
   * a recent or popular target, or something already loaded. Give it to a
   * live preview; leave it out when only deliberate choices matter, such as
   * a field that navigates.
   */
  onPreview?: (target: BannerTarget) => void;
  /** Accessible name of the field. It is always present, visually hidden. */
  label?: string;
  placeholder?: string;
  /** `lg` is the 48px hero field; `md` fits toolbars and forms. */
  size?: "md" | "lg";
  /** Static text in front of the field, such as the site host. Replaces the search glyph. */
  prefix?: ReactNode;
  hasAutoFocus?: boolean;
  /** Examples offered while the field is empty. */
  popular?: readonly TargetOption[];
  className?: string;
}

function optionTarget(option: TargetOption): BannerTarget | null {
  return parseTargetSlug(option.slug);
}

function OptionRow({ option }: { option: TargetOption }) {
  return (
    <>
      {option.avatarUrl ? (
        // biome-ignore lint/performance/noImgElement: a 24px GitHub avatar from their CDN
        <img
          src={browserImage(option.avatarUrl, 24)}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          decoding="async"
          className="gb-target-avatar"
          data-kind={option.kind}
        />
      ) : (
        <span className="gb-target-avatar" data-kind={option.kind} />
      )}
      <span className="gb-target-slug">{option.slug}</span>
      {option.title ? (
        <span className="gb-target-title">{option.title}</span>
      ) : null}
      <span className="gb-target-meta">
        {option.stars !== null && option.stars > 0 ? (
          <span className="gb-target-stars">
            <Icon icon={Star} size="xsm" />
            {formatCount(option.stars)}
          </span>
        ) : null}
        <span>{KIND_LABELS[option.kind]}</span>
      </span>
    </>
  );
}

/**
 * The field every banner starts from: type a GitHub username, `owner/repo`
 * or paste a github.com URL.
 *
 * A combobox after the WAI-ARIA 1.2 pattern with list autocomplete: focus
 * stays in the field, the highlighted suggestion is exposed through
 * `aria-activedescendant`, and result counts are announced politely.
 *
 * - Arrow down / up move the highlight (and open the list); Enter picks the
 *   highlight, or commits the typed text when nothing is highlighted; Tab
 *   picks the highlight and moves on; Escape closes the list, and clears the
 *   field when the list is already closed.
 * - Suggestions come from `/api/v1/search` (accounts for a prefix,
 *   repositories after a slash). An empty field offers recent targets (kept
 *   in local storage) and popular examples.
 * - The highlighted suggestion and the top one are fetched ahead, so
 *   choosing them shows a banner at once.
 *
 * The list is positioned under the field in normal flow order (no portal),
 * so do not put the component inside a container that clips overflow.
 */
export function TargetInput({
  value,
  onValueChange,
  onCommit,
  onPreview,
  label = "GitHub username or owner/repo",
  placeholder = "username or owner/repo",
  size = "md",
  prefix,
  hasAutoFocus = false,
  popular = POPULAR_TARGETS,
  className,
}: TargetInputProps) {
  const listboxId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const { suggestions, isLoading, failure } = useSuggestions(value);
  const recents = useRecentTargets();
  const groups = buildOptionGroups({
    text: value,
    suggestions,
    recents: recents.map((recent) => ({ ...recent, stars: null })),
    popular,
  });
  const options = groups.flatMap((group) => group.options);
  const typed = parseTargetSlug(value);
  const typedSlug = typed ? targetSlug(typed) : null;
  const hasText = value.trim() !== "";

  // A line under (or instead of) the list, when the list alone would leave
  // the visitor guessing what Enter does.
  const hint = !hasText
    ? null
    : options.length > 0
      ? null
      : isLoading
        ? null
        : typedSlug
          ? failure
            ? `Search is not answering. Press Enter to load ${typedSlug}.`
            : `No suggestions. Press Enter to load ${typedSlug}.`
          : "Type a GitHub username, or owner/repo for a repository.";
  const isListShown = isOpen && options.length > 0;
  const isPopupShown = isOpen && (options.length > 0 || hint !== null);
  const activeOption = isListShown ? (options[active] ?? null) : null;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const commit = (target: BannerTarget, option: TargetOption | null) => {
    close();
    const chosen =
      option ?? findOption(options, target) ?? optionForTarget(target);
    rememberRecentTarget({
      slug: chosen.slug,
      kind: chosen.kind,
      title: chosen.title,
      avatarUrl: chosen.avatarUrl,
    });
    onCommit(target);
    // On a phone the keyboard covers the banner the visitor just asked for.
    if (window.matchMedia("(pointer: coarse)").matches) input.current?.blur();
  };

  const choose = (option: TargetOption) => {
    const target = optionTarget(option);
    if (!target) return;
    onValueChange(option.slug);
    commit(target, option);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys pressed while an input method composes text belong to it.
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (options.length === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive(
          moveActive(
            isListShown ? active : -1,
            options.length,
            event.key === "ArrowDown" ? 1 : -1,
          ),
        );
        return;
      }
      case "Enter": {
        event.preventDefault();
        if (activeOption) choose(activeOption);
        else if (typed) commit(typed, null);
        else setOpen(true);
        return;
      }
      case "Tab": {
        // Focus moves on by itself; the highlighted suggestion comes along.
        if (activeOption) choose(activeOption);
        else close();
        return;
      }
      case "Escape": {
        if (isPopupShown) {
          event.preventDefault();
          close();
        } else if (value !== "") {
          event.preventDefault();
          onValueChange("");
        }
        return;
      }
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const target = targetFromUrl(event.clipboardData.getData("text"));
    if (!target) return;
    event.preventDefault();
    onValueChange(targetSlug(target));
    commit(target, null);
  };

  // Live preview. A name known to exist (a suggestion, a recent or popular
  // target, anything loaded before) is shown at once. Anything else waits
  // for Enter: half-typed names are real accounts surprisingly often, and
  // their banners must not flash by. Only when the search cannot answer
  // (no token, GitHub down) is the typed text looked up after a pause.
  const previewTarget = useEffectEvent(() => {
    if (typed) onPreview?.(typed);
  });
  const isKnown =
    typedSlug !== null &&
    (knownTargets.has(typedSlug) ||
      options.some(
        (option) => option.slug.toLowerCase() === typedSlug.toLowerCase(),
      ));
  const hasPreview = onPreview !== undefined;
  const isSearchDown = failure !== null;
  useEffect(() => {
    // Depending on the slug restarts the wait for every new name.
    if (!hasPreview || typedSlug === null) return;
    if (isKnown) {
      previewTarget();
      return;
    }
    if (!isSearchDown) return;
    const timer = setTimeout(previewTarget, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [hasPreview, isKnown, isSearchDown, typedSlug]);

  // Fetch ahead what Enter would pick: the highlighted row, or the best
  // match once it has stayed at the top for a moment.
  const activeSlug = activeOption?.slug ?? null;
  const topSlug = hasText ? (suggestions[0]?.slug ?? null) : null;
  useEffect(() => {
    const target = activeSlug ? parseTargetSlug(activeSlug) : null;
    if (target) prefetchEntity(target);
  }, [activeSlug]);
  useEffect(() => {
    const target = topSlug ? parseTargetSlug(topSlug) : null;
    if (!target) return;
    const timer = setTimeout(() => prefetchEntity(target), PREFETCH_TOP_MS);
    return () => clearTimeout(timer);
  }, [topSlug]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listboxId}-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listboxId]);

  const announcement = !isOpen
    ? ""
    : hint !== null
      ? hint
      : hasText && !isLoading && options.length > 0
        ? `${options.length} ${options.length === 1 ? "suggestion" : "suggestions"}`
        : "";

  // Position of each group's first row in the flat list the arrow keys walk.
  const offsets = groups.map((_, at) =>
    groups.slice(0, at).reduce((sum, group) => sum + group.options.length, 0),
  );
  return (
    <div
      className={className ? `gb-target ${className}` : "gb-target"}
      data-size={size}
    >
      <TextInput
        ref={input}
        label={label}
        isLabelHidden
        value={value}
        onChange={(next) => {
          onValueChange(next);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onPaste={handlePaste}
        placeholder={placeholder}
        size="lg"
        width="100%"
        startIcon={
          prefix ? <span className="gb-target-prefix">{prefix}</span> : "search"
        }
        hasClear
        hasAutoFocus={hasAutoFocus}
        autoComplete="off"
        autoCapitalize="none"
        hasAutoCorrect={false}
        hasSpellCheck={false}
        enterKeyHint="go"
        controlClassName="gb-target-control"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isListShown}
        aria-controls={isListShown ? listboxId : undefined}
        aria-activedescendant={activeOption ? optionId(active) : undefined}
      />
      {isPopupShown ? (
        // Pressing inside the popup must not take focus from the field.
        // biome-ignore lint/a11y/noStaticElementInteractions: not an action, only keeps focus where it is
        <div
          className="gb-target-popup"
          onMouseDown={(event) => event.preventDefault()}
        >
          {isListShown ? (
            // Focus stays in the field: rows are reached through
            // aria-activedescendant, so none of them is focusable.
            <div
              id={listboxId}
              role="listbox"
              aria-label={hasText ? "Suggestions" : "Recent and popular"}
            >
              {groups.map((group, groupAt) => (
                // biome-ignore lint/a11y/useSemanticElements: a listbox group, not a form fieldset
                <div
                  key={group.id}
                  role="group"
                  aria-label={group.label ?? undefined}
                >
                  {group.label ? (
                    <div className="gb-target-group" aria-hidden="true">
                      {group.label}
                    </div>
                  ) : null}
                  {group.options.map((option, optionAt) => {
                    const position = offsets[groupAt] + optionAt;
                    return (
                      // biome-ignore lint/a11y/useFocusableInteractive: see the listbox above
                      // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the field
                      <div
                        key={`${group.id}:${option.slug}`}
                        id={optionId(position)}
                        role="option"
                        aria-selected={position === active}
                        className="gb-target-option"
                        onPointerMove={() => setActive(position)}
                        onClick={() => choose(option)}
                      >
                        <OptionRow option={option} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
          {hint !== null ? <div className="gb-target-hint">{hint}</div> : null}
        </div>
      ) : null}
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
    </div>
  );
}
