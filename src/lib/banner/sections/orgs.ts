"use no memo";

import type { Block, Ctx } from "@/lib/banner/context";
import { image } from "@/lib/banner/draw";

/** Organizations a user belongs to, as a row of rounded-square avatars. */

const MAX_ORGS = 8;

export interface OrgsSpec {
  width: number;
}

/** Plans the avatar row. Returns `null` for anything but a user with public memberships. */
export function planOrgs(ctx: Ctx, spec: OrgsSpec): Block | null {
  const { entity, ramp, palette } = ctx;
  if (entity.kind !== "user" || !Array.isArray(entity.organizations)) {
    return null;
  }
  const size = Math.round(ramp.small * 2.67);
  const gap = Math.round(ramp.small * 0.67);
  const fits = Math.floor((spec.width + gap) / (size + gap));
  const orgs = entity.organizations
    .filter((org) => org && typeof org.avatarUrl === "string")
    .slice(0, Math.min(MAX_ORGS, fits));
  if (orgs.length === 0) return null;
  return {
    width: orgs.length * (size + gap) - gap,
    height: size,
    at: (x, y) =>
      orgs.map((org, index) =>
        image({
          src: ctx.image(org.avatarUrl, size),
          x: x + index * (size + gap),
          y,
          size,
          radius: Math.max(3, Math.round(size * 0.16)),
          ring: palette.colors.border,
          ringWidth: ramp.hair,
          placeholder: palette.colors.surface,
        }),
      ),
  };
}
