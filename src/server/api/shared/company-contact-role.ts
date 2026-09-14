/**
 * `entities/CompanyContactRole.java` — şirket yetkilisinin rolü. Şirket
 * sayfası (`companies.ts`) ve kullanıcı sayfasındaki üyelikler
 * (`marketplace-users.ts`) aynı sözlüğü okur; iki yerde iki politika
 * olmasın diye tek kaynak. Şema serbest dize okur, etiket bilinmeyen kodu
 * olduğu gibi yazar: rol yalnız gösterim, para kararı taşımaz.
 *
 * `server-only` yok: yalnız sözlük.
 */

export const COMPANY_CONTACT_ROLES = ["ADMIN", "STAFF"] as const;
export type CompanyContactRole = (typeof COMPANY_CONTACT_ROLES)[number];

const LABELS: Readonly<Record<string, string>> = {
  ADMIN: "Yetkili",
  STAFF: "Personel",
} satisfies Record<CompanyContactRole, string>;

export function companyContactRoleLabel(role: string | null): string {
  if (role === null) return "—";
  return LABELS[role] ?? role;
}
