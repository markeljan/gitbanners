/** Pre-fetch avatars ourselves (timeout, size cap, type sniffing, LRU) and hand the engine a data: URI. */
const ALLOWED_HOSTS = new Set(["avatars.githubusercontent.com"]);
const TIMEOUT_MS = 2500;
const MAX_BYTES = 512 * 1024;
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: Promise<string | null> }>();

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45
  )
    return "image/webp";
  return null;
}

export function avatarDataUri(
  rawUrl: string,
  size = 160,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname))
    return Promise.resolve(null);
  url.searchParams.set("s", String(size));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const res = await fetch(key, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    const type = sniff(buf);
    return type
      ? `data:${type};base64,${Buffer.from(buf).toString("base64")}`
      : null;
  })().catch(() => null);
  cache.set(key, { at: Date.now(), value });
  value.then((v) => v === null && cache.delete(key));
  if (cache.size > MAX_ENTRIES)
    cache.delete(cache.keys().next().value as string);
  return value;
}
