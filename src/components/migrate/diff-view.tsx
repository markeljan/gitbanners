import { collapseDiff, type DiffRow, diffLines } from "@/lib/migrate";

const SIGN = { same: " ", remove: "-", add: "+" } as const;
const SPOKEN = { same: "Unchanged", remove: "Removed", add: "Added" } as const;

function key(row: DiffRow, index: number): string {
  switch (row.type) {
    case "skip":
      return `skip-${index}`;
    case "same":
      return `same-${row.before}`;
    case "remove":
      return `remove-${row.before}`;
    case "add":
      return `add-${row.after}`;
  }
}

/**
 * Before and after as a unified line diff: removed lines, added lines, two
 * lines of context around each change, and the rest folded. Every changed
 * line says what it is in words for screen readers, and with a sign for
 * everyone, not with colour alone.
 */
export function DiffView({ before, after }: { before: string; after: string }) {
  const rows = collapseDiff(diffLines(before, after), 2);
  const changed = rows.some(
    (row) => row.type === "add" || row.type === "remove",
  );
  if (!changed) {
    return <p className="gb-doctor-quiet">Nothing changed.</p>;
  }
  return (
    <section className="gb-diff" aria-label="Changes, line by line">
      {rows.map((row, index) =>
        row.type === "skip" ? (
          <div key={key(row, index)} className="gb-diff-skip">
            {row.count === 1
              ? "1 unchanged line"
              : `${row.count} unchanged lines`}
          </div>
        ) : (
          <div
            key={key(row, index)}
            className="gb-diff-line"
            data-type={row.type}
          >
            <span className="gb-diff-number" aria-hidden="true">
              {row.type === "add" ? "" : row.before}
            </span>
            <span className="gb-diff-number" aria-hidden="true">
              {row.type === "remove" ? "" : row.after}
            </span>
            <span className="gb-diff-sign" aria-hidden="true">
              {SIGN[row.type]}
            </span>
            <span className="gb-diff-text">
              {row.type === "same" ? null : (
                <span className="sr-only">{SPOKEN[row.type]}: </span>
              )}
              {row.text || " "}
            </span>
          </div>
        ),
      )}
    </section>
  );
}
