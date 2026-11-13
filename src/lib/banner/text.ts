"use no memo";

/**
 * Cleaning for text that arrives from outside (profile fields, repository
 * descriptions, custom titles) before it is measured, drawn or put in a URL.
 */

/** C0 and C1 controls, line and paragraph separators. */
function isControl(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

/**
 * Bidirectional overrides and isolates. Inside one line they can reorder the
 * text that follows them, so a name could rewrite how the rest of its line
 * reads. Plain right-to-left text does not need them.
 */
function isBidiControl(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  );
}

/** Half of a surrogate pair on its own: not a character, and `encodeURIComponent` throws on it. */
function isLoneSurrogate(char: string): boolean {
  const code = char.charCodeAt(0);
  return char.length === 1 && code >= 0xd800 && code <= 0xdfff;
}

/**
 * One line of displayable text: control characters and bidi overrides
 * removed, broken surrogates dropped, whitespace collapsed and trimmed.
 * Anything that is not a string becomes "".
 */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isLoneSurrogate(char) || isBidiControl(code)) continue;
    out += isControl(code) ? " " : char;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** `plainText`, cut to at most `max` characters (not UTF-16 units: an emoji is never halved). */
export function clipText(value: unknown, max: number): string {
  return [...plainText(value)].slice(0, Math.max(0, max)).join("").trim();
}
