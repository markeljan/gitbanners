"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { NoPrefetchLink } from "@/components/app-link";
import { CopyButton } from "@/components/banner/copy-button";
import { DownloadButton } from "@/components/banner/download-button";
import { EmbedSnippets } from "@/components/banner/embed-snippets";
import {
  useProRepo,
  useSignInAvailable,
  useSiteOrigin,
} from "@/components/providers";
import { signInHref, withProCheck } from "@/components/site/links";
import { bannerPath, isProfileOf, SIZES } from "@/lib/banner";
import { bannerLinks } from "@/lib/embed";
import {
  createBanner,
  type SavedBanner,
  type SaveMessage,
  SaveProblem,
  saveMessage,
  updateBanner,
} from "./saved";
import { defaultBannerName } from "./state";
import { useStudioContext } from "./use-studio";

type SaveMode = "create" | "update";

/** The message for a refused save, with the action that helps. */
function SaveError({
  message,
  onRetry,
  onSaveAsNew,
}: {
  message: SaveMessage;
  onRetry: () => void;
  onSaveAsNew: () => void;
}) {
  const { href } = useStudioContext();
  const repo = useProRepo();
  const signInAvailable = useSignInAvailable();
  const actions = (() => {
    switch (message.remedy) {
      case "retry":
        return <Button label="Try again" size="sm" onClick={onRetry} />;
      case "sign-in":
        return signInAvailable ? (
          <Button
            label="Sign in with GitHub"
            size="sm"
            href={signInHref(href)}
            as="a"
          />
        ) : null;
      case "pro":
        return (
          <>
            <Button
              label="Star the repository"
              size="sm"
              href={repo.url}
              as="a"
              target="_blank"
              rel="noopener"
            />
            {signInAvailable ? (
              <Button
                label="Check again"
                size="sm"
                variant="ghost"
                href={signInHref(withProCheck(href))}
                as="a"
              />
            ) : null}
          </>
        );
      case "dashboard":
        return <Button label="Open dashboard" size="sm" href="/dashboard" />;
      case "save-as-new":
        return <Button label="Save as new" size="sm" onClick={onSaveAsNew} />;
      default:
        return null;
    }
  })();
  return (
    <Banner
      status="error"
      title={message.title}
      description={message.description}
      container="card"
      endContent={
        actions ? <div className="gb-studio-row">{actions}</div> : undefined
      }
    />
  );
}

function SavedLinks({ banner }: { banner: SavedBanner }) {
  const origin = useSiteOrigin();
  const svg = `${origin}/b/${banner.id}.svg`;
  const png = `${origin}/b/${banner.id}.png`;
  return (
    <div className="gb-studio-stack">
      <Text type="label">Saved banner URL</Text>
      <code className="gb-url">{svg.replace(/^https?:\/\//, "")}</code>
      <div className="gb-studio-row">
        <CopyButton text={svg} label="Copy SVG URL" size="sm" />
        <CopyButton text={png} label="Copy PNG URL" size="sm" />
      </div>
      <Text as="p" type="supporting" color="secondary">
        This URL always shows the saved version. Save changes to update it.
      </Text>
    </div>
  );
}

/**
 * Where the banner goes next: embed snippets, the image URL, downloads, the
 * target's page, and saving it to the account.
 */
export function StudioOutput() {
  const studio = useStudioContext();
  const showToast = useToast();
  const origin = useSiteOrigin();
  const signInAvailable = useSignInAvailable();
  const { target, preset, linkQuery, banner, options, kind, me, saved } =
    studio;
  const links = bannerLinks({ target, preset, query: linkQuery, origin });
  const fixedWidth =
    options.width ??
    (SIZES[options.size].height === null ? null : banner.width);

  const [dialog, setDialog] = useState<SaveMode | null>(null);
  const [name, setName] = useState("");
  const [isDefault, setDefault] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const editing = studio.state.bannerId ? saved.banner : null;
  // `/{login}.svg` only serves a banner of the user's own profile, so the
  // profile default is offered for that target alone.
  const ownProfile = me.user ? isProfileOf(target, me.user.login) : false;

  const open = (mode: SaveMode) => {
    // Said before the attempt when the session already knows the answer.
    const isFull = mode === "create" && me.banners.count >= me.banners.max;
    setProblem(
      isFull
        ? new SaveProblem(403, "banner_limit_reached", "Limit reached", {
            limit: me.banners.max,
          })
        : null,
    );
    setName(
      mode === "update" && editing
        ? editing.name
        : defaultBannerName(target, kind, preset),
    );
    setDefault(mode === "update" && editing ? editing.isDefault : false);
    setDialog(mode);
  };

  const save = async (mode: SaveMode) => {
    setSaving(true);
    setProblem(null);
    const input = {
      name: name.trim() || defaultBannerName(target, kind, preset),
      target,
      preset,
      query: studio.query,
      // Another target can never stay the default: saving it clears the
      // pointer instead of being refused.
      ...(me.entitlements.canSetDefault || isDefault
        ? { isDefault: isDefault && ownProfile }
        : {}),
    };
    try {
      const result =
        mode === "update" && editing
          ? await updateBanner(editing.id, input)
          : await createBanner(input);
      studio.adoptSaved(result);
      me.refresh();
      setDialog(null);
      showToast({
        body: mode === "update" ? "Changes saved" : `Saved as "${result.name}"`,
      });
    } catch (error) {
      setProblem(
        error instanceof SaveProblem
          ? error
          : new SaveProblem(0, "unavailable", "The banner was not saved."),
      );
    } finally {
      setSaving(false);
    }
  };

  const message = problem
    ? saveMessage(problem, { limit: me.banners.max, isPro: me.pro })
    : null;

  const saveActions =
    me.status === "signed-in" ? (
      editing ? (
        <>
          <Button
            label="Save changes"
            variant="primary"
            onClick={() => open("update")}
          />
          <Button label="Save as new" onClick={() => open("create")} />
        </>
      ) : (
        <Button
          label="Save banner"
          variant="primary"
          onClick={() => open("create")}
        />
      )
    ) : me.status === "loading" ? (
      <Button label="Save banner" variant="primary" isLoading />
    ) : signInAvailable ? (
      <Button
        label="Sign in with GitHub to save"
        variant="primary"
        href={signInHref(studio.href)}
        as="a"
      />
    ) : // Saving needs an account, and this deployment has none to offer.
    null;

  return (
    <section className="gb-output" aria-labelledby="gb-output-title">
      <div className="gb-output-head">
        <Heading level={2} id="gb-output-title">
          Use this banner
        </Heading>
        <div className="gb-studio-row">{saveActions}</div>
      </div>
      {me.status === "signed-in" ? (
        <Text as="p" type="supporting" color="secondary">
          {`${me.banners.count} of ${me.banners.max} saved banners used.`}
        </Text>
      ) : null}
      {editing ? <SavedLinks banner={editing} /> : null}
      <div className="gb-studio-row">
        <CopyButton text={links.svg} label="Copy URL" />
        <DownloadButton
          target={target}
          preset={preset}
          query={linkQuery}
          format="png"
        />
        <DownloadButton
          target={target}
          preset={preset}
          query={linkQuery}
          format="svg"
        />
        <Button
          label="Open page"
          href={bannerPath(target)}
          // The target follows typing: prefetching each one would too.
          as={NoPrefetchLink}
          variant="ghost"
          endContent={<Icon icon={ArrowUpRight} size="sm" />}
        />
      </div>
      <EmbedSnippets
        target={target}
        preset={preset}
        query={linkQuery}
        alt={banner.alt}
        width={fixedWidth}
      />
      <Dialog
        isOpen={dialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        width={440}
        purpose="form"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog) void save(dialog);
          }}
        >
          <Layout
            header={
              <DialogHeader
                title={dialog === "update" ? "Save changes" : "Save banner"}
                subtitle={
                  dialog === "update"
                    ? "Everyone who embeds the saved URL sees the new version."
                    : "A saved banner gets its own URL. Changes you save later show up there."
                }
                onOpenChange={(isOpen) => {
                  if (!isOpen) setDialog(null);
                }}
              />
            }
            content={
              <LayoutContent>
                <div className="gb-studio-stack">
                  <TextInput
                    label="Name"
                    value={name}
                    onChange={(next) => setName(next.slice(0, 60))}
                    description="Only you see it, in your dashboard."
                    hasAutoFocus
                    width="100%"
                  />
                  {ownProfile ? (
                    <Switch
                      label="Use as my profile default"
                      description={
                        me.entitlements.canSetDefault
                          ? `Served at ${new URL(origin).host}/${me.user?.login ?? "you"}.svg instead of the standard banner.`
                          : "Pro: star the repository to choose the banner at your own profile URL."
                      }
                      value={isDefault}
                      isDisabled={!me.entitlements.canSetDefault}
                      onChange={setDefault}
                      labelPosition="start"
                      labelSpacing="spread"
                    />
                  ) : isDefault ? (
                    <Text as="p" type="supporting" color="secondary">
                      This banner is your profile default, which can only show
                      your own profile. Saving it for another target stops using
                      it as your default.
                    </Text>
                  ) : null}
                  {message ? (
                    <SaveError
                      message={message}
                      onRetry={() => {
                        if (dialog) void save(dialog);
                      }}
                      onSaveAsNew={() => {
                        setDialog("create");
                        void save("create");
                      }}
                    />
                  ) : null}
                </div>
              </LayoutContent>
            }
            footer={
              <LayoutFooter>
                <div className="gb-studio-row gb-studio-row-end">
                  <Button
                    label="Cancel"
                    variant="ghost"
                    onClick={() => setDialog(null)}
                  />
                  <Button
                    label={dialog === "update" ? "Save changes" : "Save banner"}
                    variant="primary"
                    type="submit"
                    isLoading={isSaving}
                  />
                </div>
              </LayoutFooter>
            }
          />
        </form>
      </Dialog>
    </section>
  );
}
