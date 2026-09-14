import "server-only";

import { z } from "zod";

import { asRoleCode } from "@/lib/role-identity";

import { koalaApi, koalaRequestNoData } from "./koala";
import { MAX_PAGE_SIZE, pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * `/admin/staff` — dış yönetim konsolunun yerini alan yüzey (ADR-0014).
 *
 * `StaffMembersController`, birebir:
 *
 * ```java
 * GET    /admin/staff                              staff.read   ?query= + Pageable
 * GET    /admin/staff/{staffId}                    staff.read
 * POST   /admin/staff                              staff.manage CreateStaffMemberDto  → 201
 * PATCH  /admin/staff/{staffId}                    staff.manage UpdateStaffMemberDto{active}
 * POST   /admin/staff/{staffId}/roles/{roleCode}   staff.manage
 * DELETE /admin/staff/{staffId}/roles/{roleCode}   staff.manage
 * POST   /admin/staff/{staffId}/password           staff.manage ResetStaffPasswordDto{password}
 * ```
 *
 * **Okuma ve yazma iki ayrı izin.** Liste `staff.read` ister, her yazım
 * `staff.manage`. Panel bu ayrımı taklit etmiyor, yansıtıyor: sayfa
 * `staff.read` ile açılıyor, yazma formları yalnız `staff.manage` varken
 * çiziliyor ve her Server Action izni ayrıca yeniden çözüyor.
 *
 * **Rol adresi UUID değil kod.** `@PathVariable String roleCode` — yani
 * `SUPPORT_AGENT`. Rol→izin tarafı UUID ile, üyelik tarafı kodla çalışıyor;
 * ikisini karıştırmak 404 `STAFF_ROLE_NOT_FOUND` demek.
 *
 * ## Backend'in yazdığı, panelin uydurmadığı üç şey
 *
 *  - **Ad ve e-posta oluşturulduktan sonra değiştirilemez.** `PATCH` yalnız
 *    `active` alıyor; başka bir alan gönderilse okunmazdı.
 *  - **Parola sıfırlama e-postasız.** Yönetici parolayı yazar, hesap "ilk
 *    girişte değiştir" bayrağını alır, token'ları ölür. Ek tablo, şablon ve
 *    süreli bağlantı yok — koala-backend#98 bunu açıkça kapsam dışı bıraktı.
 *  - **MFA yok.** ADR-0014 bunu açık bir gerileme olarak kaydetti;
 *    {@link STAFF_MFA_NOTICE} onu ekranda tutuyor.
 */

export const STAFF_PATH = "/admin/staff";

/** `StaffAccountManager.SORTABLE` ve varsayılan sıralaması, kopyalanmış. */
export const STAFF_PAGING: PagingContract = {
  sortable: ["createdAt", "email", "displayName"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

/**
 * `PasswordPolicy` — `@ValidPassword`'ün iki koşulu.
 *
 * Panel ikisini de formda uyguluyor ve Server Action'da tekrar ediyor, ama
 * kararı yine backend veriyor: buradaki kontrol, kullanıcıya "12 karakter"
 * demek yerine 400 döndürmemek için var.
 */
export const STAFF_PASSWORD_MIN_LENGTH = 12;
export const STAFF_PASSWORD_MAX_BYTES = 72;

const nullableInstant = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `StaffMemberDto`.
 *
 * `roles` **yalnız doğrudan üyelikler** — `staff_member_roles` satırları.
 * `/admin/me`'nin `roles` alanıyla aynı ada sahip ama aynı şey değil: orada
 * kapanış var, burada tohum. Ekran bunu yazıyor, çünkü "bu personel neye
 * ulaşıyor" sorusunun cevabı rol grafiğinde.
 *
 * `displayName` null olabilir; backend `displayNameOf` ile e-postaya düşüyor
 * ama bunu yalnız `StaffPrincipal` üretirken yapıyor, DTO'da değil.
 */
export const staffMemberSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z
    .string()
    .nullish()
    .transform((value) => (value === null || value === undefined || value === "" ? null : value)),
  active: z.boolean(),
  /** Açıkken hesap `/admin/**`'ın tamamından 403 alır; yalnız parola ucu çalışır. */
  mustChangePassword: z.boolean(),
  /** Kaba kuvvet kilidi. Geçmiş bir zaman "kilit düşmüş" demek. */
  lockedUntil: nullableInstant,
  createdAt: nullableInstant,
  /** Rol **kodları** — üyelik uçlarının adresi; UUID değil (`RoleCode`). */
  roles: z.array(z.string().transform(asRoleCode)),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

/**
 * Kilit hâli: hiç kilitlenmemiş, kilidi sürüyor, ya da kilidi geçmişte kalmış.
 *
 * `now` bir parametre — `isAccessTokenFresh` ile aynı gerekçe. İki sebep:
 * karar bir testte sabitlenebilsin, ve "şu an" bir bileşenin render'ı içinde
 * okunmasın (React saf render bekliyor, `react-hooks/purity` de onu denetliyor).
 *
 * Ayrım gösterilmeye değer: `lockedUntil` dolu ama geçmişte olan bir hesap
 * kilitli **değildir** — backend kilidi silmiyor, yalnız tarihi geçiyor
 * (`isLocked` sadece `isAfter(now)` bakıyor). "Kilitli" rozeti asmak, girişi
 * çalışan bir hesabı bozuk göstermek olurdu.
 */
export type StaffLockState = "NONE" | "ACTIVE" | "EXPIRED";

export function staffLockState(
  member: Pick<StaffMember, "lockedUntil">,
  now: number = Date.now(),
): StaffLockState {
  if (member.lockedUntil === null) return "NONE";

  const until = Date.parse(member.lockedUntil);
  if (Number.isNaN(until)) return "NONE";

  return until > now ? "ACTIVE" : "EXPIRED";
}

export interface StaffQuery {
  /** `@RequestParam(required = false) String query` — ad/e-posta araması. */
  readonly query: string | null;
  readonly paging: Paging;
}

export function getStaffMembers(
  accessToken: string,
  query: StaffQuery,
): Promise<PageDto<StaffMember>> {
  return koalaApi.get({
    path: STAFF_PATH,
    schema: pageDtoSchema(staffMemberSchema),
    query: { query: query.query, ...pagingQuery(query.paging) },
    accessToken,
    cache: "no-store",
  });
}

/**
 * `GET /admin/staff/{staffId}` — tek personel, `staff.read`. Nesne
 * sayfalarındaki `approvedByStaffId` türü kimlikleri ada çevirmek için
 * (koala-admin#112); toplu ve tekilleştirilmiş çağrı `resolveStaffRefs`'te.
 */
export function getStaffMember(accessToken: string, staffId: string): Promise<StaffMember> {
  return koalaApi.get({
    path: `${STAFF_PATH}/${encodeURIComponent(staffId)}`,
    schema: staffMemberSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * Rol grafiği yazımından etkilenebilecek doğrudan üyeliklerin tamamı.
 *
 * Backend bir kapsama eklerken yalnız ekrandaki yirmi kişiyi değil bütün
 * `staff_member_roles` satırlarını denetliyor. `/roles` ön izlemesinin aynı
 * sonucu verebilmesi için sayfalı ucu son sayfaya kadar okumak zorunda; tek
 * sayfa sessiz bir yanlış-negatif üretirdi. Bu yalnız `staff.read` taşıyan
 * çağıranlar içindir ve nihai karar yine yazım ucundaki backend guard'ıdır.
 */
export async function getAllStaffMembers(accessToken: string): Promise<StaffMember[]> {
  const members: StaffMember[] = [];
  let pageNumber = 0;

  while (true) {
    const page = await getStaffMembers(accessToken, {
      query: null,
      paging: {
        page: pageNumber,
        size: MAX_PAGE_SIZE,
        sort: STAFF_PAGING.defaultSort,
      },
    });
    members.push(...page.content);

    if (page.last || pageNumber + 1 >= page.totalPages) return members;
    pageNumber += 1;
  }
}

/** `POST /admin/staff` → 201. Hesap "ilk girişte parola değiştir" ile doğar. */
export function createStaffMember(
  accessToken: string,
  input: { email: string; displayName: string | null; password: string },
): Promise<StaffMember> {
  return koalaApi.post({
    path: STAFF_PATH,
    schema: staffMemberSchema,
    body: {
      email: input.email,
      // Backend `null`/boş ayrımı yapıyor ve boşu null'a çeviriyor; panel
      // gönderilmeyeni gönderilmemiş bırakıyor.
      ...(input.displayName === null ? {} : { displayName: input.displayName }),
      password: input.password,
    },
    accessToken,
    cache: "no-store",
  });
}

/**
 * `PATCH /admin/staff/{staffId}` — devre dışı bırakma ve geri açma.
 *
 * Devre dışı bırakmak `tokenVersion`'ı artırıyor: o personelin bütün açık
 * oturumları anında ölüyor ve `login` de reddediliyor. "Giriş yapamaz" cümlesi
 * bu yüzden bir vaat değil, gözlenebilir bir sonuç.
 */
export function setStaffMemberActive(
  accessToken: string,
  staffId: string,
  active: boolean,
): Promise<StaffMember> {
  return koalaApi.patch({
    path: `${STAFF_PATH}/${encodeURIComponent(staffId)}`,
    schema: staffMemberSchema,
    body: { active },
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/staff/{staffId}/roles/{roleCode}`. İdempotent, gövdesiz. */
export function grantStaffRole(
  accessToken: string,
  staffId: string,
  roleCode: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${STAFF_PATH}/${encodeURIComponent(staffId)}/roles/${encodeURIComponent(roleCode)}`,
    method: "POST",
    accessToken,
    cache: "no-store",
  });
}

/** `DELETE /admin/staff/{staffId}/roles/{roleCode}`. */
export function revokeStaffRole(
  accessToken: string,
  staffId: string,
  roleCode: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${STAFF_PATH}/${encodeURIComponent(staffId)}/roles/${encodeURIComponent(roleCode)}`,
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}

/**
 * `POST /admin/staff/{staffId}/password` — yönetici parolayı atar.
 *
 * Sonuç: parola özeti değişir, "ilk girişte değiştir" bayrağı kalkar (açılır),
 * kilit temizlenir ve `tokenVersion` artar. Yani hedefin açık oturumları da
 * biter. Kişiye parolayı **panel dışından** iletmek gerekir; backend e-posta
 * göndermez.
 */
export function resetStaffPassword(
  accessToken: string,
  staffId: string,
  password: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${STAFF_PATH}/${encodeURIComponent(staffId)}/password`,
    method: "POST",
    body: { password },
    accessToken,
    cache: "no-store",
  });
}

/**
 * ADR-0014'ün açıkça "gerileme" diye kaydettiği şey, ekranda kalması için.
 *
 * Issue'nun maddesi: "Ekran bunu gizlemesin; personel oluşturma akışı parolanın
 * tek savunma olduğunu söyleyen bir uyarı taşısın."
 */
export const STAFF_MFA_NOTICE = {
  title: "MFA yok — parola tek savunma",
  detail:
    "ADR-0014 çok adımlı doğrulamayı açık bir gerileme olarak kaydetti: personel girişinde ikinci bir etken yok. Karşılığı yalnız hız sınırlayıcı ve hesap kilidi (n başarısız denemede locked_until), ve ikisi de MFA'nın yerini tutmuyor. Bu hesabın parolası, panelin tamamına — para hareketleri dâhil — açılan tek kapıdır. ADR'nin yazılı yeniden açılma koşulu: panele sahibin dışında ikinci bir kişi girdiği gün.",
} as const;

/** koala-admin#9'un istediği ama `/admin/staff`'ın veremediği şeyler. */
export const STAFF_BACKEND_GAPS = [
  {
    id: "no-profile-edit",
    title: "Ad ve e-posta sonradan değiştirilemiyor",
    detail:
      "PATCH /admin/staff/{staffId} yalnız `active` alanını kabul ediyor (UpdateStaffMemberDto'nun tek alanı o). Yanlış yazılmış bir e-posta ya da değişen bir ad için uç yok; hesabı devre dışı bırakıp yenisini açmak gerekir.",
  },
  {
    id: "no-account-delete",
    title: "Personel kaydı silinemiyor",
    detail:
      "Silme ucu yok; kalıcı hâl 'devre dışı'. Denetim kaydının aktörü çözebilmesi için makul, ama listede biriken pasif kayıtlar kalıcıdır.",
  },
  {
    id: "password-travels-out-of-band",
    title: "Atanan parolayı kişiye panel iletmiyor",
    detail:
      "E-posta akışı koala-backend#98'de açıkça kapsam dışı bırakıldı. Parolayı yazan kişi onu güvenli bir kanalla iletmek zorunda; panel ne gönderir ne saklar ne de bir daha gösterir.",
  },
  {
    id: "no-unlock",
    title: "Hesap kilidini elle açma ucu yok",
    detail:
      "lockedUntil listede görünüyor ama onu sıfırlayan ayrı bir uç yok. Kilidi düşüren tek yol parola sıfırlamak (resetPassword failedLoginAttempts ve lockedUntil'i temizler) ya da sürenin dolmasını beklemek.",
  },
  {
    id: "roles-are-direct-only",
    title: "Listedeki roller yalnız doğrudan üyelikler",
    detail:
      "StaffMemberDto.roles staff_member_roles satırlarını döndürüyor, kapanışı değil. Bir personelin gerçekte neye ulaştığını görmek için rol ekranındaki etkili izin önizlemesine bakmak gerekir; /admin/me'nin roles alanı ise kapanışı verir, aynı ad iki farklı şey.",
  },
] as const;
