/**
 * Runs once per server instance, before the first request.
 *
 * Backs the GitHub snapshot cache with the durable store, so the last good
 * upstream answer outlives a deployment and is shared between instances
 * (the framework's own caches are emptied on every deploy).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ setSnapshotStore }, { getStore, snapshotStore }] = await Promise.all(
    [import("@/lib/github/snapshot"), import("@/lib/store")],
  );
  // The in-memory twin adds nothing over the snapshot layer's own memory.
  if (getStore().kind === "upstash") setSnapshotStore(snapshotStore());
}
