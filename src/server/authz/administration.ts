import "server-only";

import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
  type AuthorizationChangeStatus,
} from "@/lib/authorization-change";
import type { RoleCode, RoleId } from "@/lib/role-identity";
import { STAFF_SELF_RESET_RECOVERY } from "@/lib/staff-password-reset";
import {
  grantMarketplaceUserRole,
  isMarketplaceRole,
  revokeMarketplaceUserRole,
} from "@/server/api/marketplace-user-roles";
import {
  STAFF_PASSWORD_MAX_BYTES,
  STAFF_PASSWORD_MIN_LENGTH,
  createStaffMember,
  grantStaffRole,
  resetStaffPassword,
  revokeStaffRole,
  setStaffMemberActive,
} from "@/server/api/staff-members";
import {
  excludeStaffRole,
  grantRolePermission,
  includeStaffRole,
  revokeRolePermission,
} from "@/server/api/staff-roles";
import { isKoalaApiError } from "@/server/api/errors";
import { getKoalaAccessToken } from "@/server/auth/session";

import { permissionLabel, type Permission } from "./permissions";
import { getStaffContext } from "./staff-context";

/**
 * Yetkilendirmeyi değiştiren her yazım, tek kapıdan.
 *
 * On bir işlem var ve bir kapı. `runEscrowOperation`'ın para tarafında yaptığını
 * bu, yetki tarafında yapıyor ve sebebi aynı: izin yeniden çözümü, girdi
 * doğrulaması ve backend reddinin Türkçeye çevrilmesi **bir kere** yazılsın ki
 * on ikinci işlemi ekleyen kişi bunlardan birini atlayamasın.
 *
 * `server-actions.test.ts`'in `ACTION_GATES` listesindeki üçüncü giriş budur.
 * O liste bilerek kısa: yeni bir kapı eklemek, gerekçesiyle birlikte
 * incelenecek bir diff olsun diye.
 *
 * ## Neden `<RequirePermission>` yetmiyor
 *
 * Bir Server Action, kendi URL'i olan bir POST ucudur. `/roles` sayfasının
 * kapısı bu eylem için hiç çalışmaz; formu çizen sayfanın gate'i, gizli bir
 * `<div>`'in veriyi koruduğu kadar korur. Bu yüzden izin burada, `/admin/me`
 * üzerinden, her gönderimde yeniden çözülüyor.
 *
 * ## Ve neden bu da otorite değil
 *
 * Kararı `@RequiresPermission` ve `StaffAuthorizationManager` veriyor; ikisi de
 * aktörün izinlerini **veritabanından** yeniden çözüyor. Buradaki kapı iki iş
 * yapıyor: reddedileceği belli olan bir isteği hiç göndermemek, ve gelen reddi
 * bir hata kodu yerine bir cümleye çevirmek.
 *
 * ## Görev ayrılığında backend nihai otorite
 *
 * Arayüz, rol grafiğini bildiği anda reddedileceği belli kapsama ve üyelik
 * seçeneklerini kapatır. Bu kapı aynı hesabı tekrarlamaz: doğrudan çağrılabilir
 * bir Server Action bayat ya da değiştirilmiş veri taşıyabilir. Yazım backend'e
 * gider; `StaffSeparationOfDuties` yeniden çözülen kapanış üzerinde ihlali 409
 * ile reddeder ve aşağıdaki açıklama operatöre hiçbir şeyin değişmediğini söyler.
 */

/**
 * Rol kimliği ile rol kodu tip düzeyinde ayrı (`src/lib/role-identity.ts`).
 *
 * Aşağıdaki `STAFF_ROLE_NOT_FOUND` açıklaması karışıklığı zaten anlatıyordu;
 * dördü de `string` olduğu sürece anlatmak dışında bir şey yapamıyordu.
 */
export type AuthorizationChange =
  | {
      readonly kind: "ROLE_PERMISSION_GRANT";
      readonly roleId: RoleId;
      readonly roleCode: RoleCode;
      readonly permission: string;
    }
  | {
      readonly kind: "ROLE_PERMISSION_REVOKE";
      readonly roleId: RoleId;
      readonly roleCode: RoleCode;
      readonly permission: string;
    }
  | {
      readonly kind: "ROLE_INCLUDE_ADD";
      readonly roleId: RoleId;
      readonly roleCode: RoleCode;
      readonly includedRoleId: RoleId;
      readonly includedRoleCode: RoleCode;
    }
  | {
      readonly kind: "ROLE_INCLUDE_REMOVE";
      readonly roleId: RoleId;
      readonly roleCode: RoleCode;
      readonly includedRoleId: RoleId;
      readonly includedRoleCode: RoleCode;
    }
  | {
      readonly kind: "STAFF_CREATE";
      readonly email: string;
      readonly displayName: string | null;
      readonly password: string;
    }
  | {
      readonly kind: "STAFF_SET_ACTIVE";
      readonly staffId: string;
      readonly staffLabel: string;
      readonly active: boolean;
    }
  | {
      readonly kind: "STAFF_ROLE_GRANT";
      readonly staffId: string;
      readonly staffLabel: string;
      readonly roleCode: RoleCode;
    }
  | {
      readonly kind: "STAFF_ROLE_REVOKE";
      readonly staffId: string;
      readonly staffLabel: string;
      readonly roleCode: RoleCode;
    }
  | {
      readonly kind: "STAFF_PASSWORD_RESET";
      readonly staffId: string;
      readonly staffLabel: string;
      readonly password: string;
    }
  | {
      readonly kind: "USER_ROLE_GRANT";
      readonly userId: string;
      readonly userLabel: string;
      readonly role: string;
    }
  | {
      readonly kind: "USER_ROLE_REVOKE";
      readonly userId: string;
      readonly userLabel: string;
      readonly role: string;
    };

export type AuthorizationChangeKind = AuthorizationChange["kind"];

/**
 * Hangi işlem hangi izni istiyor — `@RequiresPermission`'dan kopyalanmış.
 *
 * Rol grafiğinin dört yazımı `role.manage`, personelin beşi `staff.manage`,
 * pazaryeri kullanıcı rolleri `user.role.manage`. Okumalar burada yok:
 * `GET /admin/users/{id}/roles` `user.read` istiyor ve o bir sayfa kapısı.
 */
const PERMISSION_FOR: Record<AuthorizationChangeKind, Permission> = {
  ROLE_PERMISSION_GRANT: "role.manage",
  ROLE_PERMISSION_REVOKE: "role.manage",
  ROLE_INCLUDE_ADD: "role.manage",
  ROLE_INCLUDE_REMOVE: "role.manage",
  STAFF_CREATE: "staff.manage",
  STAFF_SET_ACTIVE: "staff.manage",
  STAFF_ROLE_GRANT: "staff.manage",
  STAFF_ROLE_REVOKE: "staff.manage",
  STAFF_PASSWORD_RESET: "staff.manage",
  USER_ROLE_GRANT: "user.role.manage",
  USER_ROLE_REVOKE: "user.role.manage",
};

/**
 * Backend'in denetim kaydına yazdığı `action` adı, işlem başına.
 *
 * `@RequiresPermission(action = "...")` değerlerinin birebir kopyası. Başarı
 * mesajında adıyla anılıyor ki operatör `/audit-log`'da o satırı arayabilsin —
 * "kayda geçti" cümlesi böylece doğrulanabilir bir iddiaya dönüşüyor.
 * `STAFF_CREATE` dışındakiler `before`/`after` anlık görüntüsü de taşıyor.
 */
export const AUDIT_ACTION_FOR: Record<AuthorizationChangeKind, string> = {
  ROLE_PERMISSION_GRANT: "staff.role.permission.grant",
  ROLE_PERMISSION_REVOKE: "staff.role.permission.revoke",
  ROLE_INCLUDE_ADD: "staff.role.include.add",
  ROLE_INCLUDE_REMOVE: "staff.role.include.remove",
  STAFF_CREATE: "staff.member.create",
  STAFF_SET_ACTIVE: "staff.member.update",
  STAFF_ROLE_GRANT: "staff.member.role.grant",
  STAFF_ROLE_REVOKE: "staff.member.role.revoke",
  STAFF_PASSWORD_RESET: "staff.member.password.reset",
  USER_ROLE_GRANT: "user.role.grant",
  USER_ROLE_REVOKE: "user.role.revoke",
};

/**
 * Sonuç tipleri `src/lib/authorization-change.ts`'te yaşıyor ve buradan yeniden
 * yayımlanıyor: bu modül `import "server-only"` taşıyor, oysa aynı biçimi
 * `authorization-form.tsx` de okumak zorunda. Sunucu tarafındaki her çağıran
 * onları buradan alabilsin diye yeniden yayım var; sınırı geçen taraf saf
 * modülü okuyor.
 */
export type { AuthorizationChangeAction, AuthorizationChangeOutcome, AuthorizationChangeStatus };
export { IDLE_AUTHORIZATION_OUTCOME };

/**
 * Kapsama seçiminin **formdaki** adı.
 *
 * Backend kenarı `includedRoleId` diye adlandırıyor, formdaki tek kontrolün adı
 * ise `includedRole` — çünkü o kontrol `uuid:KOD` çiftini taşıyor. Mesajın
 * altına asılacağı kontrol bu, o yüzden panelin kendi reddi de backend'in
 * doğrulama hatası da bu ada çevriliyor; `permissionKnown` → `permission`
 * eşlemesiyle aynı sebep.
 */
const INCLUDED_ROLE_FIELD = "includedRole";

function blocked(
  message: string,
  errorCode: string,
  field: string | null = null,
): AuthorizationChangeOutcome {
  return { status: "BLOCKED", message, errorCode, requestId: null, field };
}

function succeeded(message: string): AuthorizationChangeOutcome {
  return { status: "SUCCEEDED", message, errorCode: null, requestId: null, field: null };
}

/* -------------------------------------------------------------------------- */
/* Girdi doğrulama                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Backend'in kabul etmeyeceği bir isteği hiç göndermemek için.
 *
 * Burada olmayan şey de bilinçli: **iş kuralı yok.** Döngü, görev ayrılığı,
 * "sahip olmadığın izni veremezsin" ve kendini kilitleme kurallarının hiçbiri
 * burada denetlenmiyor — hepsi backend'in, ve panelin ikinci bir kopyasını
 * tutması ikisinin ayrışmasıyla biterdi. Buradaki tek soru: formda gerçekten
 * bir şey var mı.
 */
function validate(change: AuthorizationChange): AuthorizationChangeOutcome | null {
  const missing = (label: string, field: string | null = null) =>
    blocked(
      `${label} gelmedi. Sayfayı yenileyip tekrar deneyin.`,
      "PANEL_VALIDATION_FAILED",
      field,
    );

  switch (change.kind) {
    case "ROLE_PERMISSION_GRANT":
    case "ROLE_PERMISSION_REVOKE": {
      if (change.roleId.trim().length === 0) return missing("Rol kimliği");
      if (change.permission.trim().length === 0) return missing("İzin adı", "permission");
      return null;
    }

    case "ROLE_INCLUDE_ADD":
    case "ROLE_INCLUDE_REMOVE": {
      if (change.roleId.trim().length === 0) return missing("Rol kimliği");
      /**
       * Kimlik **ve** kod. Kimlik isteğe, kod cevabın cümlesine gidiyor ve
       * yalnız kimliğe bakmak, bir yazımın "TRUST_LEAD artık  rolünü kapsıyor"
       * diye bildirilmesi demekti — yapılan işin adı ekranda boş bir boşluk.
       */
      if (change.includedRoleId.trim().length === 0) {
        return missing("Kapsanacak rol", INCLUDED_ROLE_FIELD);
      }
      if (change.includedRoleCode.trim().length === 0) {
        return missing("Kapsanacak rolün kodu", INCLUDED_ROLE_FIELD);
      }
      return null;
    }

    case "STAFF_CREATE": {
      if (change.email.trim().length === 0) {
        return blocked("E-posta zorunludur.", "PANEL_VALIDATION_FAILED", "email");
      }
      return passwordProblem(change.password);
    }

    case "STAFF_PASSWORD_RESET": {
      if (change.staffId.trim().length === 0) return missing("Personel kimliği");
      return passwordProblem(change.password);
    }

    case "STAFF_SET_ACTIVE": {
      if (change.staffId.trim().length === 0) return missing("Personel kimliği");
      return null;
    }

    case "STAFF_ROLE_GRANT":
    case "STAFF_ROLE_REVOKE": {
      if (change.staffId.trim().length === 0) return missing("Personel kimliği");
      if (change.roleCode.trim().length === 0) return missing("Rol kodu", "roleCode");
      return null;
    }

    case "USER_ROLE_GRANT":
    case "USER_ROLE_REVOKE": {
      if (change.userId.trim().length === 0) return missing("Kullanıcı kimliği");
      if (!isMarketplaceRole(change.role)) {
        return blocked(
          "Pazaryeri rolü ROLE_USER ya da ROLE_ADMIN olmalı.",
          "PANEL_VALIDATION_FAILED",
          "role",
        );
      }
      return null;
    }
  }
}

/**
 * `@ValidPassword`'ün iki koşulu, aynı sırayla.
 *
 * Uzunluk **kod noktasıyla**, üst sınır **UTF-8 baytıyla** ölçülüyor — backend
 * `codePointCount` ve `getBytes(UTF_8).length` kullanıyor, ve Türkçe bir
 * parolada bu ikisi aynı sayı değil. `[...password].length` JavaScript'te kod
 * noktası sayar; `password.length` UTF-16 birimi sayardı ve emoji taşıyan bir
 * parolayı yanlış ölçerdi.
 */
function passwordProblem(password: string): AuthorizationChangeOutcome | null {
  const codePoints = [...password].length;

  if (codePoints < STAFF_PASSWORD_MIN_LENGTH) {
    return blocked(
      `Parola en az ${STAFF_PASSWORD_MIN_LENGTH} karakter olmalı. MFA yok; bu parola panelin tek savunması.`,
      "PANEL_VALIDATION_FAILED",
      "password",
    );
  }

  if (new TextEncoder().encode(password).length > STAFF_PASSWORD_MAX_BYTES) {
    return blocked(
      `Parola UTF-8 olarak en fazla ${STAFF_PASSWORD_MAX_BYTES} bayt olabilir; BCrypt bundan uzununu sessizce kırpar.`,
      "PANEL_VALIDATION_FAILED",
      "password",
    );
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Kapı                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Bir yetkilendirme değişikliği yap — ya da neden yapılmadığını söyle.
 *
 * Sıra önemli ve bilerek bu: **önce doğrula, sonra izni çöz, en sonda gönder.**
 * İzin çözümü bir HTTP isteği; eksik bir formu doğrulamak için onu harcamanın
 * anlamı yok, ve izinsiz bir çağrının backend'e hiç ulaşmaması gerekiyor.
 */
export async function runAuthorizationChange(
  change: AuthorizationChange,
): Promise<AuthorizationChangeOutcome> {
  const invalid = validate(change);
  if (invalid !== null) return invalid;

  const context = await getStaffContext();

  if (context.failure !== null) {
    // Fail-closed. `getStaffContext()` her başarısızlıkta boş bir izin listesi
    // üretiyor, yani ulaşılamayan bir backend değişikliği reddediyor.
    return blocked(
      "İzinleriniz çözülemediği için hiçbir değişiklik yapılmadı. Panel emin olmadığı hiçbir yazımı denemez; birkaç dakika sonra tekrar deneyin.",
      context.failure.kind,
    );
  }

  const permission = PERMISSION_FOR[change.kind];
  if (!context.has(permission)) {
    return blocked(
      `Bu işlem "${permissionLabel(permission)}" iznini gerektiriyor ve hesabınızda bu izin yok. İstek backend'e hiç gönderilmedi.`,
      "PANEL_PERMISSION_DENIED",
    );
  }

  /**
   * Token ikinci kez okunuyor ve bu yol genellikle **çalışmaz**: yukarıdaki
   * `getStaffContext()` de aynı çerezi okuyor, yani bozuk bir oturum oraya
   * `failure` olarak düşüp bu satıra hiç gelinmiyor.
   *
   * Yine de bir `try` var, çünkü ikisi aynı an değil: `getStaffContext()`
   * React'in `cache()`'i içinde ve aynı render'da daha önce çözülmüş olabilir;
   * o aradan sonra yenileme başarısız olursa buraya bir istisna gelir. Kapının
   * son adımı bir istisnayla kırılmaktansa bir cümleyle reddetsin.
   * `escrow/operations.ts` aynı yapıyı aynı sebeple taşıyor.
   */
  let accessToken: string;
  try {
    accessToken = await getKoalaAccessToken();
  } catch (error) {
    return blocked(
      `Oturum doğrulanamadı, değişiklik yapılmadı: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION",
    );
  }

  try {
    return succeeded(await send(accessToken, change));
  } catch (error) {
    return refusalFrom(error);
  }
}

/** Tek `switch`, on bir uç. Her dal bir başarı cümlesi döndürür. */
async function send(accessToken: string, change: AuthorizationChange): Promise<string> {
  const recorded = `Değişiklik denetim kaydına "${AUDIT_ACTION_FOR[change.kind]}" adıyla yazıldı.`;

  switch (change.kind) {
    case "ROLE_PERMISSION_GRANT": {
      await grantRolePermission(accessToken, change.roleId, change.permission);
      return `${change.permission} izni ${change.roleCode} rolüne verildi. Bu rolü taşıyan personel için etki bir sonraki istekte geçerli — izinler token'a gömülmüyor, her istekte veritabanından çözülüyor. ${recorded}`;
    }

    case "ROLE_PERMISSION_REVOKE": {
      await revokeRolePermission(accessToken, change.roleId, change.permission);
      return `${change.permission} izni ${change.roleCode} rolünden geri alındı ve etki anında geçerli. Rol bu izne bir kapsama üzerinden hâlâ ulaşıyor olabilir; etkili izin listesine bakın. ${recorded}`;
    }

    case "ROLE_INCLUDE_ADD": {
      await includeStaffRole(accessToken, change.roleId, change.includedRoleId);
      return `${change.roleCode} artık ${change.includedRoleCode} rolünü kapsıyor ve onun bütün etkili izinlerini devralıyor. ${recorded}`;
    }

    case "ROLE_INCLUDE_REMOVE": {
      await excludeStaffRole(accessToken, change.roleId, change.includedRoleId);
      return `${change.roleCode} artık ${change.includedRoleCode} rolünü kapsamıyor. ${recorded}`;
    }

    case "STAFF_CREATE": {
      const created = await createStaffMember(accessToken, {
        email: change.email,
        displayName: change.displayName,
        password: change.password,
      });
      return `${created.email} oluşturuldu ve "ilk girişte parolayı değiştir" bayrağıyla doğdu: o bayrak inene kadar /admin/** uçlarının tamamı 403 döner. Hesabın henüz hiçbir rolü yok, yani giriş yapsa da hiçbir ekrana ulaşamaz. Parolayı kişiye panel dışından iletin — backend e-posta göndermez. ${recorded}`;
    }

    case "STAFF_SET_ACTIVE": {
      await setStaffMemberActive(accessToken, change.staffId, change.active);
      return change.active
        ? `${change.staffLabel} yeniden etkinleştirildi ve giriş yapabilir. ${recorded}`
        : `${change.staffLabel} devre dışı bırakıldı: açık oturumlarının tamamı anında geçersiz oldu (token sürümü artırıldı) ve giriş denemesi de reddedilir. ${recorded}`;
    }

    case "STAFF_ROLE_GRANT": {
      await grantStaffRole(accessToken, change.staffId, change.roleCode);
      return `${change.roleCode} rolü ${change.staffLabel} personeline verildi; etki bir sonraki istekte geçerli. ${recorded}`;
    }

    case "STAFF_ROLE_REVOKE": {
      await revokeStaffRole(accessToken, change.staffId, change.roleCode);
      return `${change.roleCode} rolü ${change.staffLabel} personelinden geri alındı. Üyelik veritabanından okunduğu için iptal anında geçerli — ADR-0014'ün dış kimlik sağlayıcısını bırakırken kazandığı şey buydu. ${recorded}`;
    }

    case "STAFF_PASSWORD_RESET": {
      await resetStaffPassword(accessToken, change.staffId, change.password);
      return `${change.staffLabel} için yeni parola atandı: hesap "ilk girişte değiştir" bayrağını aldı, kilidi (varsa) açıldı ve açık oturumları sonlandırıldı. Parolayı kişiye panel dışından iletin; panel onu bir daha göstermez. ${recorded}`;
    }

    case "USER_ROLE_GRANT": {
      if (!isMarketplaceRole(change.role)) {
        throw new Error("Pazaryeri rolü validate'den geçmemiş.");
      }
      await grantMarketplaceUserRole(accessToken, change.userId, change.role);
      return `${change.role} rolü ${change.userLabel} kullanıcısına verildi. Personel rollerinden ayrı: bu, pazaryeri users tablosundaki bir yetki satırı. ${recorded}`;
    }

    case "USER_ROLE_REVOKE": {
      if (!isMarketplaceRole(change.role)) {
        throw new Error("Pazaryeri rolü validate'den geçmemiş.");
      }
      await revokeMarketplaceUserRole(accessToken, change.userId, change.role);
      return `${change.role} rolü ${change.userLabel} kullanıcısından geri alındı. ROLE_USER, son ROLE_ADMIN ve sistem kullanıcısı 409 ile korunur. ${recorded}`;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Backend reddini bir cümleye çevirmek                                        */
/* -------------------------------------------------------------------------- */

/**
 * Backend'in kendi cümlesi + panelin eklediği bağlam.
 *
 * Sıra bilerek böyle: önce backend'in `message`'ı, sonra panelin açıklaması.
 * Backend Türkçe konuşuyor (`Accept-Language: tr`) ve reddin sahibi o; panelin
 * işi *neden* olduğunu ve ne yapılabileceğini eklemek.
 */
const EXPLANATION_FOR: Record<string, string> = {
  STAFF_ROLE_GRAPH_WOULD_CYCLE:
    "Kapsanmak istenen rol, bu role zaten bir yol üzerinden ulaşıyor; kenar eklenirse grafik kendi kendini içerirdi. DAG'ın DAG kalması uçtan zorlanıyor, hiçbir şey yazılmadı.",
  STAFF_SEPARATION_OF_DUTIES_VIOLATED:
    "OWNER dışındaki personel ve roller güven ile finans dallarını birlikte taşıyamaz. Hiçbir rol ya da personel üyeliği değiştirilmedi.",
  STAFF_PERMISSION_NOT_GRANTABLE:
    "Kural: kendinizde olmayan bir izni bir role veremez, ondan alamaz ve o izni taşıyan bir rolü kapsatamazsınız. Aktörün izinleri her yazımda veritabanından yeniden çözülüyor, bu yüzden ekranda gördüğünüz izin listesi bayatsa cevap yine budur.",
  STAFF_ROLE_MANAGE_SELF_LOCKOUT:
    "Kendi ulaştığınız bir rolden rol yönetimi iznini kaldırıyordunuz; yazım geri alındı. Dikkat: kural kalan sahipleri saymıyor — başka biri role.manage taşıyor olsa da bu red gelir.",
  STAFF_MEMBERSHIP_SELF_LOCKOUT:
    "Kendi son yönetim üyeliğinizi bırakıyordunuz. Yönetim izni sayılan ikili staff.manage + role.manage; yazımdan sonra ikisini birden taşımıyor olsaydınız panele bir daha giremezdiniz.",
  STAFF_LAST_ADMINISTRATOR:
    "Bu yazımdan sonra sistemde staff.manage ya da role.manage taşıyan etkin hiçbir personel kalmıyordu. Üyelik artık Koala'da tutulduğu için bu sayım ilk kez yapılabiliyor (ADR-0014).",
  STAFF_MEMBER_PASSWORD_RESET_SELF: `Görev ayrılığı: bir yönetici kendi hesabına yönetici parolası atayamaz. ${STAFF_SELF_RESET_RECOVERY} Hiçbir şey değişmedi: parola, kilit ve açık oturumlar olduğu gibi.`,
  STAFF_EMAIL_ALREADY_REGISTERED:
    "Bu e-posta ile bir personel kaydı zaten var. Kayıt silinmiyor, devre dışı bırakılıyor — listede pasif olarak duruyor olabilir.",
  STAFF_ROLE_NOT_FOUND:
    "Rol bulunamadı. Üyelik uçları rolü kodla adresliyor (SUPPORT_AGENT gibi), rol grafiği uçları ise UUID ile; ikisini karıştırmak tam olarak bu cevabı verir.",
  STAFF_PERMISSION_UNKNOWN:
    "Backend bu izin adını tanımıyor. Seçenekler /admin/permissions'tan geliyor, yani bu ad ya yolda bozulmuş ya da katalogdan kaldırılmış.",
  STAFF_RECORD_NOT_FOUND: "Personel kaydı bulunamadı; listeyi yenileyin.",
  PAGE_SORT_FIELD_NOT_ALLOWED:
    "Backend yalnız createdAt, email ve displayName alanlarına göre sıralıyor.",
  ADMIN_USER_ROLE_SYSTEM_PROTECTED:
    "Sistem kullanıcısının rolleri değiştirilemez. Bu hesap bildirim ve anonimleştirme satırlarını tutar; rol formu onu bir UUID kutusu sanmamalı.",
  ADMIN_USER_ROLE_LAST_ADMIN_PROTECTED:
    "Sistemdeki son ROLE_ADMIN geri alınamaz. Personel aktör marketplace admini olmadığı için bu kural artık gerçekten ateşler — sıfır adminli sistem uçlardan kurtarılamaz.",
  ADMIN_USER_ROLE_OWN_ADMIN_PROTECTED:
    "Köprü yolundaki bir yönetici kendi ROLE_ADMIN rolünü geri alamaz. Personel aktör users satırı taşımadığı için bu kural ona işlemez; son admin kuralı işler.",
  ADMIN_USER_ROLE_MEMBERSHIP_PROTECTED:
    "ROLE_USER pazaryeri üyeliğinin taşıyıcısıdır; bu uçtan geri alınamaz.",
};

function refusalFrom(error: unknown): AuthorizationChangeOutcome {
  if (!isKoalaApiError(error)) {
    return {
      status: "REFUSED",
      message:
        error instanceof Error
          ? error.message
          : "Değişiklik gönderilemedi ve sebebi okunamadı. Sayfayı yenileyin.",
      errorCode: null,
      requestId: null,
      field: null,
    };
  }

  const explanation = EXPLANATION_FOR[error.errorCode];

  // Doğrulama hatasında alan bazlı mesajlar `details`'te; formda göstermeye
  // değer tek şey onlar, çünkü zarfın kendi mesajı yalnız "doğrulama başarısız"
  // diyor.
  const detail = error.isValidationFailure ? error.details[0] : undefined;

  const message = [
    error.message,
    detail === undefined ? null : `${detail.field}: ${detail.message}`,
    explanation ?? null,
    error.isForbidden && explanation === undefined
      ? "Yetki kararını backend verir; panelin gösterdiği izin listesi yalnızca bir yansımadır."
      : null,
  ]
    .filter((part): part is string => part !== null && part !== undefined && part.length > 0)
    .join(" ");

  return {
    status: "REFUSED",
    message,
    errorCode: error.errorCode,
    requestId: error.requestId,
    field: fieldFor(error),
  };
}

/**
 * Backend reddini, varsa, ait olduğu form alanına bağlar.
 *
 * Yalnız iki durum bir alana ait: doğrulama hataları (`details[].field`) ve
 * yinelenen e-posta. Geri kalan her red — 403, 409 — formun tamamına aittir ve
 * bir alanın altına asılması onu bir yazım hatası gibi gösterirdi.
 */
function fieldFor(error: {
  errorCode: string;
  isValidationFailure: boolean;
  details: readonly { field: string }[];
}): string | null {
  if (error.errorCode === "STAFF_EMAIL_ALREADY_REGISTERED") return "email";

  const field = error.isValidationFailure ? error.details[0]?.field : undefined;
  if (field === undefined) return null;

  // `@AssertTrue public boolean isPermissionKnown()` alan adını getter'dan
  // türetiyor, yani tel üzerinde `permissionKnown` görünüyor; formdaki
  // kontrolün adı `permission`. `includedRoleId` de aynı durumda: formdaki
  // kontrol `uuid:KOD` çiftini taşıdığı için `includedRole` adını taşıyor.
  if (field === "permissionKnown") return "permission";
  if (field === "includedRoleId") return INCLUDED_ROLE_FIELD;
  return field;
}
