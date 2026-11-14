import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import type { MigrationChange } from "@/lib/migrate";

const STATUS = {
  replace: { variant: "success", word: "Replaced" },
  optional: { variant: "accent", word: "Optional" },
  flag: { variant: "warning", word: "Left alone" },
} as const;

export interface ChangeListProps {
  changes: readonly MigrationChange[];
  /** Turns an optional swap on or off. */
  onToggle: (id: string, applied: boolean) => void;
}

/** Shortens a long URL for display; the full one is in the title. */
function short(url: string): string {
  return url.length > 96 ? `${url.slice(0, 93)}...` : url;
}

/**
 * Every card the doctor recognised: what it is, what happened to it and why,
 * the old and new URL, what carried over and what was dropped, and the new
 * banner itself. Optional swaps have a switch.
 */
export function ChangeList({ changes, onToggle }: ChangeListProps) {
  return (
    <ol className="gb-doctor-changes">
      {changes.map((change) => {
        const status = STATUS[change.action];
        const decoded = change.to?.replace(/&amp;/g, "&") ?? null;
        return (
          <li key={change.id} className="gb-doctor-change">
            <div className="gb-doctor-change-head">
              <StatusDot variant={status.variant} label={status.word} />
              <span className="gb-doctor-change-title">
                <strong>{status.word}</strong>
                {": "}
                {change.cardName}
                <span className="gb-doctor-change-meta">
                  {` · ${change.serviceName} · line ${change.line}`}
                </span>
              </span>
            </div>
            <p className="gb-doctor-change-reason">{change.reason}</p>
            <dl className="gb-doctor-urls">
              <dt>Old</dt>
              <dd>
                <code title={change.from}>{short(change.from)}</code>
              </dd>
              {change.to ? (
                <>
                  <dt>New</dt>
                  <dd>
                    <code title={change.to}>{short(change.to)}</code>
                  </dd>
                </>
              ) : null}
              {change.carried.length > 0 ? (
                <>
                  <dt>Kept</dt>
                  <dd>{change.carried.join("; ")}</dd>
                </>
              ) : null}
              {change.dropped.length > 0 ? (
                <>
                  <dt>Dropped</dt>
                  <dd>
                    {change.dropped.map((name, index) => (
                      <span key={name}>
                        {index > 0 ? ", " : null}
                        <code>{name}</code>
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
            {change.action === "optional" ? (
              <Switch
                label="Use the GitBanners banner"
                value={change.applied}
                onChange={(applied) => onToggle(change.id, applied)}
                size="sm"
              />
            ) : null}
            {decoded ? (
              // biome-ignore lint/performance/noImgElement: a live banner URL, already the optimised image
              <img
                className="gb-doctor-preview"
                src={decoded}
                alt={`New ${change.cardName.toLowerCase()} from GitBanners`}
                loading="lazy"
                decoding="async"
                data-applied={change.applied ? "" : undefined}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
