import { z } from "zod";

/**
 * `core/dtos/user/response/StaffPartyDto.java` — e-postalı taraf. `SafeUserDto`
 * ile karıştırılmasın: bu projeksiyon yalnız personel uçlarında (`/admin/jobs`,
 * `/admin/payouts/{id}`) döner ve o uçların izni PERSONAL_DATA/FINANCIAL'dır.
 */

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const staffPartySchema = z.object({
  id: z.string(),
  firstName: nullableString,
  lastName: nullableString,
  email: nullableString,
});

export type StaffParty = z.infer<typeof staffPartySchema>;

/**
 * Tarafın adı; ad yoksa e-posta, o da yoksa kimlik. Boş metin dönmez:
 * bir tutarın yanında "—" ya da bir kimlik, boşluktan daha okunur.
 */
export function staffPartyName(party: StaffParty | null | undefined): string {
  if (party === null || party === undefined) return "—";
  const full = [party.firstName, party.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  if (full.length > 0) return full;
  if (party.email !== null && party.email.length > 0) return party.email;
  return party.id;
}
