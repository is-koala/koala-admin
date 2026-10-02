import type { AdminUserCounts } from "@/server/api/marketplace-users";
import type { Permission } from "@/server/authz/permissions";

/**
 * Kullanıcı sayfasının sekmeleri (koala-admin#103) — tek kaynak. Sekme
 * anahtarı, etiketi, listesini açan izin ve sayaç toplamı burada; URL
 * sözlüğü (`USER_TABS`), sekme şeridi, sayaç bağlantıları ve satır içi
 * bölümler hepsi buradan okur. İzin kuralı bir daha yazılmaz.
 *
 * `permission: null` → `user.read` yeter (sayfanın kendi kapısı).
 * `count: null` → sekme rozeti yok (genel ve denetim sayaçsız).
 */
export interface UserTabSpecBody {
  readonly label: string;
  readonly permission: Permission | null;
  readonly count: ((counts: AdminUserCounts) => number) | null;
}

export const USER_TAB_SPECS = {
  genel: { label: "Genel", permission: null, count: null },
  atamalar: {
    label: "Atamalar",
    permission: "payment.read",
    count: (counts) => counts.assignmentsAsWorker + counts.assignmentsAsEmployer,
  },
  hakedisler: {
    label: "Hakedişler",
    permission: "payout.reconcile",
    count: (counts) => counts.payouts,
  },
  /**
   * koala-admin#108: banka hesapları ucu `user.read_pii` (PERSONAL_DATA);
   * sekmenin ikinci yarısı (bekleyen IBAN doğrulamaları) `bank.account.verify`
   * ister ve sekmenin içinde ayrıca kapanır. DTO banka sayacı taşımaz.
   */
  banka: { label: "Banka", permission: "user.read_pii", count: null },
  /**
   * koala-admin#128: `GET /admin/users/{id}/identity-reveals` — işverenlerin
   * bu işçinin kimlik bilgilerini (TCKN) ne zaman gördüğü. `user.read_pii`
   * (PERSONAL_DATA) ve her okuma denetim satırı yazar; ayrı sekme çünkü liste
   * yalnız bilinçle açılınca istenmeli. DTO sayaç taşımaz.
   */
  kimlik: { label: "Kimlik görüntüleme", permission: "user.read_pii", count: null },
  uyusmazliklar: {
    label: "Uyuşmazlıklar",
    permission: "dispute.resolve",
    count: (counts) => counts.disputes,
  },
  sikayetler: {
    label: "Şikayetler",
    permission: "content.moderate",
    count: (counts) => counts.reportsReceived + counts.reportsMade,
  },
  denetim: { label: "Rol / Denetim", permission: null, count: null },
} as const satisfies Record<string, UserTabSpecBody>;

export type UserTab = keyof typeof USER_TAB_SPECS;

/** Sekme sırası nesnenin yazım sırası; `?sekme=` bu değerlerden birini alır. */
export const USER_TABS = Object.keys(USER_TAB_SPECS) as readonly UserTab[];

export const USER_TAB_PARAM = "sekme";

export function isTabEnabled(tab: UserTab, held: ReadonlySet<Permission>): boolean {
  const permission: Permission | null = USER_TAB_SPECS[tab].permission;
  return permission === null || held.has(permission);
}
