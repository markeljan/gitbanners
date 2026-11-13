/**
 * README doctor: public surface. Pure and isomorphic; safe in the browser.
 */
export { collapseDiff, type DiffLine, type DiffRow, diffLines } from "./diff";
export { EXAMPLE_README } from "./example";
export {
  type ChangeAction,
  type MigrateOptions,
  type MigrationChange,
  type MigrationResult,
  migrateReadme,
} from "./migrate";
export {
  CARD_NAMES,
  type CardKind,
  identifyCard,
  SERVICES,
  SERVICES_CHECKED,
  type ServiceHealth,
  type ServiceId,
} from "./services";
