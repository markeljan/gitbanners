import { Badge } from "@astryxdesign/core/Badge";

/**
 * The plan as an enumerated state: "Pro". Rendered only for Pro accounts;
 * the free plan carries no badge. Works in Server and Client Components.
 */
export function ProBadge() {
  return <Badge label="Pro" variant="success" />;
}
