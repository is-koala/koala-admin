import { z } from "zod";

/**
 * `core/dtos/user/response/SafeUserDto.java` — the only shape in which the
 * backend hands a *person* to an admin surface.
 *
 * It is called "safe" because it is the projection with no PII in it: no
 * e-mail, no phone, no identity number. The panel names a party in a money
 * confirmation with exactly these fields and nothing else, so a screen that
 * releases escrow never needs `user.read_pii` to say who is being paid.
 *
 * No `import "server-only"` here on purpose: this module is schema and string
 * handling, with no network in it, so a Client Component rendering a party name
 * in a confirmation dialog can import it.
 */

export const safeUserSchema = z.object({
  id: z.string(),
  firstName: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  lastName: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  username: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  profilePictureUrl: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

export type SafeUser = z.infer<typeof safeUserSchema>;

/**
 * A person's name as it should appear next to an amount of money.
 *
 * Falls back through username to the id rather than to an empty string: a
 * confirmation dialog that says "release ₺1.240,00 to  " is worse than one that
 * says "release ₺1.240,00 to 3f5a1c88-…", because only one of the two is
 * obviously wrong to the operator reading it.
 */
export function safeUserName(user: SafeUser | null | undefined): string {
  if (user === null || user === undefined) {
    return "—";
  }

  const full = [user.firstName, user.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();

  if (full.length > 0) return full;
  if (user.username !== null && user.username.length > 0) return user.username;
  return user.id;
}
