/**
 * Just enough TrueType/OpenType parsing to answer two questions the renderer
 * cares about: which code points a font maps to a real glyph (its `cmap`), and
 * how to blank out its `.notdef` glyph (glyph 0).
 *
 * Only uncompressed sfnt data (TTF/OTF) is read. Google Fonts serves
 * `format('truetype')` to non-browser clients, and the base fonts are TTFs.
 */

type Table = { offset: number; length: number };

function tables(view: DataView): Map<string, Table> {
  const out = new Map<string, Table>();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    out.set(tag, {
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
    });
  }
  return out;
}

function asView(data: ArrayBuffer | Uint8Array): DataView {
  return data instanceof Uint8Array
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
}

function addFormat4(view: DataView, at: number, into: Set<number>): void {
  const segCount = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = view.getUint16(ends + s * 2);
    const start = view.getUint16(starts + s * 2);
    const delta = view.getUint16(deltas + s * 2);
    const rangeAt = rangeOffsets + s * 2;
    const rangeOffset = view.getUint16(rangeAt);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const glyphAt = rangeAt + rangeOffset + (cp - start) * 2;
        if (glyphAt + 2 > view.byteLength) continue;
        glyph = view.getUint16(glyphAt);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) into.add(cp);
    }
  }
}

function addFormat12(view: DataView, at: number, into: Set<number>): void {
  const groups = view.getUint32(at + 12);
  for (let g = 0; g < groups; g++) {
    const group = at + 16 + g * 12;
    const start = view.getUint32(group);
    const end = Math.min(view.getUint32(group + 4), 0x10ffff);
    const firstGlyph = view.getUint32(group + 8);
    for (let cp = start; cp <= end; cp++) {
      if (firstGlyph + (cp - start) !== 0) into.add(cp);
    }
  }
}

/**
 * Every code point the font maps to a glyph other than `.notdef`. Reads the
 * Unicode subtables (platform 0, or Windows platform 3 encodings 1 and 10).
 * Returns an empty set for data it cannot read rather than throwing.
 */
export function fontCoverage(data: ArrayBuffer | Uint8Array): Set<number> {
  const covered = new Set<number>();
  try {
    const view = asView(data);
    const cmap = tables(view).get("cmap");
    if (!cmap) return covered;
    const count = view.getUint16(cmap.offset + 2);
    for (let i = 0; i < count; i++) {
      const record = cmap.offset + 4 + i * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      const unicode =
        platform === 0 ||
        (platform === 3 && (encoding === 1 || encoding === 10));
      if (!unicode) continue;
      const at = cmap.offset + view.getUint32(record + 4);
      const format = view.getUint16(at);
      if (format === 4) addFormat4(view, at, covered);
      else if (format === 12) addFormat12(view, at, covered);
    }
  } catch {
    // Truncated or unexpected data: report what was read so far.
  }
  return covered;
}

/**
 * A copy of a TrueType font whose `.notdef` glyph (glyph 0) is empty, so a
 * character no font can draw takes up space but draws nothing. Mona Sans's
 * `.notdef` is the GitHub Invertocat, which must never appear inside a user's
 * name or bio. Fonts without a `loca` table (CFF) are returned unchanged.
 */
export function withEmptyNotdef(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data);
  const view = asView(copy);
  const all = tables(view);
  const head = all.get("head");
  const loca = all.get("loca");
  if (!head || !loca) return copy;
  // Glyph 0 spans loca[0]..loca[1]; moving loca[0] up to loca[1] empties it
  // without touching any other glyph.
  if (view.getInt16(head.offset + 50) === 0) {
    view.setUint16(loca.offset, view.getUint16(loca.offset + 2));
  } else {
    view.setUint32(loca.offset, view.getUint32(loca.offset + 4));
  }
  return copy;
}
