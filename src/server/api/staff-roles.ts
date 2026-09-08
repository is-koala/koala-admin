import "server-only";

import { z } from "zod";

import { PERMISSION_SENSITIVITIES } from "@/server/authz/permissions";

import { koalaApi, koalaRequestNoData } from "./koala";

/**
 * `/admin/roles` ve `/admin/permissions` — rol→izin DAG'ının HTTP yüzeyi.
 *
 * `StaffRolesController` ve `StaffPermissionsController`'ın tamamı, birebir:
 *
 * ```java
 * GET    /admin/roles                                      → List<StaffRoleDto>
 * GET    /admin/roles/{roleId}                             → StaffRoleDetailDto
 * POST   /admin/roles/{roleId}/permissions                 GrantStaffPermissionDto{permission}
 * DELETE /admin/roles/{roleId}/permissions/{permission}
 * POST   /admin/roles/{roleId}/includes                    IncludeStaffRoleDto{includedRoleId}
 * DELETE /admin/roles/{roleId}/includes/{includedRoleId}
 * GET    /admin/permissions                                → List<StaffPermissionDto>
 * ```
 *
 * Yedisi de `@RequiresPermission(ROLE_MANAGE)`. Dördü yazıyor ve dördü de
 * `SuccessResult` dönüyor — yani **gövdesiz**, `data` alanı hiç yok. Bu yüzden
 * yazımlar `koalaRequestNoData` kullanıyor; bir şema uydurup `data` beklemek,
 * her başarılı yazımı sözleşme ihlali gibi göstermekle biterdi.
 *
 * ## Burada olmayan üç uç, çünkü backend'de de yok
 *
 * **Rol yaratma, yeniden adlandırma ve silme yok.** Rol kümesi Liquibase
 * seed'iyle sabit (`06-20-staff-authorization.xml`). Panel bunun için düğme
 * uydurmuyor; {@link ROLE_GRAPH_BACKEND_GAPS} eksiği yazıyor ve ekranda
 * görünüyor.
 *
 * ## Kurallar backend'de, panelde değil
 *
 * Dört yazımın hepsinde aktörün izinleri **veritabanından yeniden çözülüyor**
 * (`resolve(actor.roles())`), token'dan değil. Panelin kendi kapısı bir
 * nezaket: reddi bir cümleye çeviriyor ve reddedileceği belli olan bir isteği
 * hiç göndermiyor. Kararı veren `@RequiresPermission` ve
 * `StaffAuthorizationManager`.
 */

export const ROLES_PATH = "/admin/roles";
export const PERMISSIONS_PATH = "/admin/permissions";

/** `StaffRoleRefDto` — bir rolü adlandırmaya yetecek kadarı. */
const roleRefSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export type StaffRoleRef = z.infer<typeof roleRefSchema>;

/**
 * `StaffRoleDto`.
 *
 * `permissions` **yalnız doğrudan** verilmiş izinler, `includes` **yalnız
 * doğrudan** kenarlar. Kalıtımla gelenler bu listede yok — rol detayındaki
 * `effective*` alanları onun için var. İkisini karıştırmak, bir rolden izin
 * kaldırdığını sanıp kalıtımla geri geldiğini görmemek demek.
 *
 * İzin adları `z.string()`, daraltılmış `Permission` birleşimi değil:
 * `audit.ts`'teki gerekçenin aynısı. Backend yirminci bir izni tanımladığı gün
 * bu sayfa satırı yine çizmeli, bilmediği bir ad yüzünden tamamen boşalmamalı.
 */
export const staffRoleSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  includes: z.array(roleRefSchema),
});

export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * `GET /admin/roles/{roleId}` bilerek **çağrılmıyor**, ve gerekçesi yazılı.
 *
 * O uç `StaffRoleDetailDto` döndürüyor: liste alanlarının üstüne `effectiveRoles`
 * (kapanış, rolün kendisi hariç) ve `effectivePermissions` (doğrudan olanlar ∪
 * ulaşılan her rolün doğrudan olanları). İkisi de **türetilebilir**, çünkü liste
 * cevabı her rolün doğrudan izinlerini ve bütün kenarları zaten taşıyor —
 * `StaffRolesController`'ın kendi belgesinin "panel DAG'ın tamamını tek istekte
 * çizebilir" cümlesi tam olarak bunu vaat ediyor.
 *
 * Alternatif on rol için on istekti. Türetme `src/lib/role-graph.ts`'te ve
 * `graph()`'in tanımıyla aynı: kapanış (kendisi dâhil) üzerindeki doğrudan
 * izinlerin birleşimi. `roles.test.tsx` bu eşitliği backend'in kendi
 * `effectivePermissions` cevabına karşı sabitliyor — panel kendi tanımını
 * uydurmuyor, backend'inkini uyguluyor ve bunu bir testle kanıtlıyor.
 *
 * Sözleşme değişirse — sözgelimi backend bir gün "etkili"yi başka türlü
 * tanımlarsa — o test kırmızıya döner ve doğru cevap bu ucu çağırmaya dönmek
 * olur; bu yüzden şema burada değil, çünkü kullanılmayan bir şema, sözleşmenin
 * denetlendiği yanılgısını verir.
 */

/**
 * `StaffPermissionDto`.
 *
 * `sensitivity` kapalı bir küme (`PermissionSensitivity`) ve panelin kendi
 * kataloğuyla aynı; burada `z.enum` kullanmak güvenli, çünkü backend bu enum'a
 * bir değer eklerse rol ekranının onu **yanlış** göstermesindense hiç
 * göstermemesi doğru davranıştır.
 */
export const staffPermissionSchema = z.object({
  code: z.string(),
  mutating: z.boolean(),
  sensitivity: z.enum(PERMISSION_SENSITIVITIES),
});

export type StaffPermissionEntry = z.infer<typeof staffPermissionSchema>;

/**
 * Bütün roller, kenarlarıyla — tek istekte.
 *
 * `StaffRolesController`'ın kendi belgesi bunu böyle vaat ediyor: "panel DAG'ın
 * tamamını tek istekte çizebilir". Kapanış hesabı, döngü uyarısı ve görev
 * ayrılığı teşhisi bu tek cevaptan çıkıyor (`src/lib/role-graph.ts`), yani rol
 * başına bir istek atan bir ekran yok.
 */
export function getStaffRoles(accessToken: string): Promise<StaffRole[]> {
  return koalaApi.get({
    path: ROLES_PATH,
    schema: z.array(staffRoleSchema),
    accessToken,
    // İzin grafiği bu panelin değiştirdiği şeyin ta kendisi; önbelleğe alınmış
    // bir grafik, az önce yapılan yazımı göstermeyen bir ekran demek olurdu.
    cache: "no-store",
  });
}

/**
 * İzin kataloğu, backend'in ağzından.
 *
 * Panelin kendi `PERMISSION_SPECS`'i de aynı listeyi taşıyor ve ikisi ayrı
 * işler yapıyor: katalog **backend'in bugün ne tanıdığını** söyler ve rol
 * ekranındaki seçeneklerin kaynağıdır; panelin kendi listesi ise bir izne
 * Türkçe bir ad verebilmek ve bir kapı kurabilmek içindir. Seçenekleri
 * panelinkinden çizmek, backend'in tanıdığı ama panelin bilmediği bir izni
 * sessizce yönetilemez kılardı.
 */
export function getStaffPermissionCatalog(accessToken: string): Promise<StaffPermissionEntry[]> {
  return koalaApi.get({
    path: PERMISSIONS_PATH,
    schema: z.array(staffPermissionSchema),
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/roles/{roleId}/permissions`. İdempotent: ikinci çağrı no-op. */
export function grantRolePermission(
  accessToken: string,
  roleId: string,
  permission: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${ROLES_PATH}/${encodeURIComponent(roleId)}/permissions`,
    method: "POST",
    body: { permission },
    accessToken,
    cache: "no-store",
  });
}

/**
 * `DELETE /admin/roles/{roleId}/permissions/{permission}`.
 *
 * İzin adı **yolda**, gövdede değil — `@PathVariable String permission`. Nokta
 * içerdiği için `encodeURIComponent` şart değil ama gerekçesiz de bırakılmaz:
 * ad backend'den geliyor, panelin sabit listesinden değil.
 */
export function revokeRolePermission(
  accessToken: string,
  roleId: string,
  permission: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${ROLES_PATH}/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(permission)}`,
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/roles/{roleId}/includes` — DAG kenarı ekler. */
export function includeStaffRole(
  accessToken: string,
  roleId: string,
  includedRoleId: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${ROLES_PATH}/${encodeURIComponent(roleId)}/includes`,
    method: "POST",
    body: { includedRoleId },
    accessToken,
    cache: "no-store",
  });
}

/** `DELETE /admin/roles/{roleId}/includes/{includedRoleId}`. */
export function excludeStaffRole(
  accessToken: string,
  roleId: string,
  includedRoleId: string,
): Promise<unknown> {
  return koalaRequestNoData({
    path: `${ROLES_PATH}/${encodeURIComponent(roleId)}/includes/${encodeURIComponent(includedRoleId)}`,
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}

/**
 * koala-admin#9'un istediği ama backend'in bugün veremediği şeyler.
 *
 * İlki bir kabul maddesini **karşılanamaz** kılıyor ve bu yüzden ekranın en
 * görünür yerinde duruyor: "görev ayrılığını bozan bir birleştirme reddediliyor"
 * — reddedilmiyor. Panel bunu uydurmuyor, gösteriyor.
 */
export const ROLE_GRAPH_BACKEND_GAPS = [
  {
    id: "no-separation-enforcement",
    title: "Görev ayrılığı kuralı çalışma anında uygulanmıyor",
    detail:
      "ADR-0014 §Rol grafiği 'OWNER dışında hiçbir rol hem trust hem finans dalını kapsayamaz' diyor, ama koala-backend'in src/main'inde bu kuralı uygulayan tek satır yok: StaffAuthorizationManager.includeRole yalnız döngüyü ve 'sahip olmadığın izni veremezsin' kuralını denetliyor. Kural yalnız StaffRoleGraphSeedTest'te yaşıyor ve o test seed XML dosyasını okuyor — ne veritabanını ne de bir isteği. Yani iki dalı birleştiren bir kapsama backend tarafından KABUL EDİLİR. Panel bunu ekranda teşhis olarak gösterir ve istemcide reddetmez; olmayan bir kapıyı varmış gibi çizmek, kuralın var olduğu yanılgısını sürdürürdü.",
  },
  {
    id: "no-role-lifecycle",
    title: "Rol yaratma, adlandırma ve silme ucu yok",
    detail:
      "StaffRolesController yalnız okuma ile kenar ve izin yazımı sunuyor. On rolün tamamı Liquibase seed'inden geliyor (06-20-staff-authorization.xml). Yeni bir rol gerekiyorsa yolu bir changeset; panelden açılamaz.",
  },
  {
    id: "branch-membership-is-hardcoded",
    title: "Dal üyeliği rol adına gömülü",
    detail:
      "Hangi rolün 'trust' hangisinin 'finans' dalında olduğu bir veri değil, StaffRoleGraphSeedTest'teki iki sabit liste. Panel aynı listeleri taşımak zorunda (src/lib/role-graph.ts). Seed'e yeni bir rol eklendiği gün iki yerde birden güncellenmezse teşhis sessizce eksik kalır.",
  },
  {
    id: "revoke-checks-grantability",
    title: "İzin kaldırmak da 'sahip olma' şartına bağlı",
    detail:
      "Kural 'sahip olmadığın izni role koyamazsın' diye yazıldı; kod aynı kontrolü revokePermission ve excludeRole'da da uyguluyor. Sonuç: taşımadığınız bir izni bir rolden kaldıramazsınız da. Beklenmedik ama daha sıkı bir davranış; panel 403'ü olduğu gibi gösterir.",
  },
  {
    id: "self-lockout-is-not-a-count",
    title: "Kendini kilitleme koruması sahip saymıyor",
    detail:
      "staff.role.manage.self.lockout kuralı 'sistemde kaç kişi role.manage taşıyor' sorusunu sormuyor. Sorduğu şey: bu role kendiniz ulaşıyor musunuz, ve yazımdan sonra o rol hâlâ role.manage'e ulaşıyor mu. Başka sahipler varken bile 409 gelir. Aktörü kendi hatasından koruması bakımından daha sıkı, ama adının söylediği şey değil.",
  },
] as const;
