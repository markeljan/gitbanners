/**
 * Type guard that drops `null` and `undefined`, for `filter`.
 *
 * Lives on its own so the pure modules (`normalize.ts`) can use it without
 * importing the transport.
 */
export function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
