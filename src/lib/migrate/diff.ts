/**
 * A line diff for the before/after view: longest common subsequence over the
 * lines that differ, after trimming the common start and end. READMEs are a
 * few hundred lines and the doctor changes a handful, so the quadratic table
 * stays small; past `MAX_CELLS` the middle is shown as removed and added.
 */

export type DiffLine =
  | { type: "same"; text: string; before: number; after: number }
  | { type: "remove"; text: string; before: number }
  | { type: "add"; text: string; after: number };

export type DiffRow = DiffLine | { type: "skip"; count: number };

const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

/** Every line of both texts, marked same, removed or added. Line numbers are 1-based. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) {
    out.push({ type: "same", text: a[i] ?? "", before: i + 1, after: i + 1 });
  }

  const n = midA.length;
  const m = midB.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    midA.forEach((text, i) => {
      out.push({ type: "remove", text, before: head + i + 1 });
    });
    midB.forEach((text, j) => {
      out.push({ type: "add", text, after: head + j + 1 });
    });
  } else {
    // lcs[i][j]: length of the common subsequence of midA[i..] and midB[j..].
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(
                lcs[(i + 1) * width + j] ?? 0,
                lcs[i * width + j + 1] ?? 0,
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({
          type: "same",
          text: midA[i] ?? "",
          before: head + i + 1,
          after: head + j + 1,
        });
        i++;
        j++;
      } else if (
        i < n &&
        (j === m ||
          (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0))
      ) {
        // Removals before additions, as a unified diff prints them.
        out.push({ type: "remove", text: midA[i] ?? "", before: head + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: midB[j] ?? "", after: head + j + 1 });
        j++;
      }
    }
  }

  for (let k = 0; k < tail; k++) {
    const before = a.length - tail + k;
    const after = b.length - tail + k;
    out.push({
      type: "same",
      text: a[before] ?? "",
      before: before + 1,
      after: after + 1,
    });
  }
  return out;
}

/**
 * Keeps `context` unchanged lines around each change and folds the rest
 * into `skip` rows, like a unified diff.
 */
export function collapseDiff(
  lines: readonly DiffLine[],
  context = 2,
): DiffRow[] {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < lines.length) keep[k] = true;
    }
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) rows.push({ type: "skip", count: skipped });
      skipped = 0;
      rows.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) rows.push({ type: "skip", count: skipped });
  return rows;
}
