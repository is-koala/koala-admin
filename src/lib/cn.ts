export type ClassValue = string | number | false | null | undefined;

/**
 * Join class names, dropping falsy entries.
 *
 * Deliberately not `clsx` + `tailwind-merge`: the component layer here is small
 * and owned locally, and no component takes a `className` that needs to defeat
 * its own base classes. If that changes, swap this out — not before.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string | number => Boolean(value)).join(" ");
}
