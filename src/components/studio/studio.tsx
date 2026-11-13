"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useEffectEvent } from "react";
import { useSignInAvailable } from "@/components/providers";
import { signInHref } from "@/components/site/links";
import { StudioControls } from "./controls";
import { StudioOutput } from "./output";
import {
  StageBar,
  StageNotice,
  StageView,
  StageZoneNote,
  useStageSettings,
} from "./stage";
import { hasOverrides } from "./state";
import {
  StudioProvider,
  type Studio as StudioValue,
  useStudio,
} from "./use-studio";

/** True when a key press belongs to a field with its own undo. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    !["checkbox", "radio", "range", "color", "button"].includes(target.type)
  );
}

function SavedNotice({ studio }: { studio: StudioValue }) {
  const { state, me, saved } = studio;
  const signInAvailable = useSignInAvailable();
  if (!state.bannerId) return null;
  if (me.status === "anonymous" && !signInAvailable) {
    return (
      <Banner
        status="info"
        title="Accounts are not available on this deployment"
        description="Saved banners belong to the account that saved them. You can keep editing here and copy the banner's link."
        container="card"
      />
    );
  }
  if (me.status === "anonymous") {
    return (
      <Banner
        status="info"
        title="Sign in with GitHub to edit this saved banner"
        description="Saved banners belong to the account that saved them."
        container="card"
        endContent={
          <Button
            label="Sign in with GitHub"
            size="sm"
            href={signInHref(studio.href)}
            as="a"
          />
        }
      />
    );
  }
  if (!saved.failure) return null;
  return (
    <Banner
      status="error"
      title={
        saved.failure === "not_found"
          ? "You have no saved banner with this id"
          : "The saved banner did not load"
      }
      description={
        saved.failure === "not_found"
          ? "It may have been deleted. You can keep editing and save it as a new banner."
          : "Try again in a moment. You can keep editing in the meantime."
      }
      container="card"
      endContent={
        <Button
          label="Start a new banner"
          size="sm"
          onClick={studio.detachSaved}
        />
      }
    />
  );
}

/**
 * The banner studio: controls on the left, the live canvas in the middle,
 * what to do with the banner under it. On phones the canvas stays pinned at
 * the top while the controls scroll beneath it.
 */
export function Studio() {
  const studio = useStudio();
  const stage = useStageSettings();
  const { kind, state, saved, canUndo, canRedo } = studio;
  const editing = state.bannerId ? saved.banner : null;

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = (key === "z" && event.shiftKey) || key === "y";
    if (!isUndo && !isRedo) return;
    // Text fields keep their own undo.
    if (isTextEntry(event.target)) return;
    event.preventDefault();
    if (isUndo) studio.undo();
    else studio.redo();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <StudioProvider value={studio}>
      <div className="gb-studio">
        <div className="gb-studio-head">
          <Text type="label" color="secondary" maxLines={1}>
            {editing
              ? `Editing: ${editing.name}`
              : state.bannerId && saved.isLoading
                ? "Loading saved banner"
                : "New banner"}
          </Text>
          <div className="gb-studio-row">
            <IconButton
              label="Undo"
              tooltip="Undo (Ctrl or ⌘ Z)"
              icon={<Icon icon={Undo2} />}
              size="sm"
              variant="ghost"
              isDisabled={!canUndo}
              onClick={studio.undo}
            />
            <IconButton
              label="Redo"
              tooltip="Redo (Shift Ctrl or ⌘ Z)"
              icon={<Icon icon={Redo2} />}
              size="sm"
              variant="ghost"
              isDisabled={!canRedo}
              onClick={studio.redo}
            />
            <Button
              label="Reset to preset"
              size="sm"
              variant="ghost"
              icon={<Icon icon={RotateCcw} />}
              isDisabled={!hasOverrides(kind, state)}
              onClick={studio.reset}
            />
          </div>
        </div>
        <div className="gb-studio-bar">
          <StageBar settings={stage} />
          <SavedNotice studio={studio} />
          <StageNotice />
        </div>
        <section className="gb-studio-canvas" aria-label="Banner preview">
          <StageView settings={stage} />
        </section>
        <aside className="gb-studio-controls" aria-label="Banner settings">
          <StudioControls />
        </aside>
        <div className="gb-studio-output">
          <StageZoneNote settings={stage} />
          <StudioOutput />
        </div>
      </div>
    </StudioProvider>
  );
}
