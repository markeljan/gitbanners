/**
 * Preloaded by `bun test` (see bunfig.toml).
 *
 * A few modules are Next-only at import time. Tests exercise the logic around
 * them, so they are replaced with inert stand-ins here instead of running the
 * whole suite under the `react-server` export condition (which would swap in
 * the server build of React and break component tests).
 */
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  cacheLife() {},
  cacheTag() {},
  revalidateTag() {},
  revalidatePath() {},
  updateTag() {},
  refresh() {},
}));
