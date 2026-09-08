/**
 * Bir rolün iki adı: **kimliği** ve **kodu**.
 *
 * İkisi de tel üstünde bir dize, ama aynı şey değiller ve karıştırılmaları
 * ekranın en pahalı sessiz hatası:
 *
 *  - `RoleId` bir UUID. Rol grafiği uçları rolü bununla adresliyor
 *    (`POST /admin/roles/{roleId}/includes`).
 *  - `RoleCode` `SUPPORT_AGENT` gibi bir ad. Üyelik uçları rolü bununla
 *    adresliyor (`POST /admin/staff/{staffId}/roles/{roleCode}`) ve operatörün
 *    tanıdığı, mesajlarda geçen şey de bu.
 *
 * `administration.ts`'in `STAFF_ROLE_NOT_FOUND` açıklaması bu karışıklığı
 * kullanıcıya zaten anlatıyordu ("ikisini karıştırmak tam olarak bu cevabı
 * verir"), ama ikisi de `string` olduğu sürece hiçbir şey karıştırmayı
 * *engellemiyordu*: `hiddenFields={{ roleId: role.code, roleCode: role.id }}`
 * hem `tsc`'den hem 46 testin tamamından geçiyordu, ve sonucu ekranda değil
 * backend'de, gizemli bir 404 olarak görünüyordu.
 *
 * Marka (brand) tam olarak bunu kapatıyor ve **çalışma anında hiçbir şeye mal
 * olmuyor**: aşağıdaki iki sembol `declare` edilmiş, yani hiçbir zaman var
 * olmuyorlar; derlenmiş dosyada ikisinden de eser yok. Kalan tek şey, iki
 * dizenin birbirinin yerine geçememesi.
 *
 * Bu modül bilerek import'suz: hem `"use client"` formu hem `import
 * "server-only"` taşıyan API katmanı okuyor.
 */

declare const roleIdBrand: unique symbol;
declare const roleCodeBrand: unique symbol;

/** Rolün UUID'si — rol grafiği uçlarının adresi. */
export type RoleId = string & { readonly [roleIdBrand]: "RoleId" };

/** Rolün kodu (`SUPPORT_AGENT`) — üyelik uçlarının adresi, ve insanın adı. */
export type RoleCode = string & { readonly [roleCodeBrand]: "RoleCode" };

/**
 * Bir dizeyi rol kimliği saymak.
 *
 * Bir iddia, bir doğrulama değil — ve bilerek: kimliği doğrulayan yer backend
 * (`STAFF_ROLE_NOT_FOUND`), panelin UUID biçimi hakkında ikinci bir kanısı
 * olması ikisinin ayrışmasıyla biterdi. Çağrıldığı yerler sayılıdır: bir HTTP
 * cevabının ayrıştırıldığı yer ve bir `FormData` alanının okunduğu yer.
 */
export function asRoleId(value: string): RoleId {
  return value as RoleId;
}

/** {@link asRoleId}'nin kod tarafı; aynı gerekçe. */
export function asRoleCode(value: string): RoleCode {
  return value as RoleCode;
}

/**
 * Kapsama seçeneğinin değeri: `uuid:KOD`.
 *
 * Tek bir `<select>` iki bilgi taşımak zorunda, çünkü backend kenarı **UUID**
 * ile yazıyor ama operatör rolü **koduyla** tanıyor ve başarı cümlesinde kod
 * geçmesi gerekiyor. Ayırıcı iki nokta: ne UUID ne de rol kodu onu içeriyor.
 *
 * Yazan ve okuyan yan yana duruyor ki ayrışamasınlar — biçimi değiştiren
 * kişi ikisini birden görsün.
 */
const ROLE_OPTION_SEPARATOR = ":";

export function roleOptionValue(role: { readonly id: RoleId; readonly code: RoleCode }): string {
  return `${role.id}${ROLE_OPTION_SEPARATOR}${role.code}`;
}

/**
 * `uuid:KOD` çiftini ayırır; çift bozuksa `null`.
 *
 * **İkisi de** doğrulanıyor, yalnız ilki değil. Eskiden yalnız kimlik
 * bakılıyordu ve iki noktası olmayan bir değer (`"COPUK"`) istek olarak
 * gidiyordu: gövde `{"includedRoleId":"COPUK"}`, cevap gizemli bir 404, ve
 * ekrandaki cümle **boş bir rol adıyla** çiziliyordu — "TRUST_LEAD artık
 * rolünü kapsıyor". `null` dönmek bunu bir form hatasına çeviriyor.
 *
 * Ayırıcı **tam olarak bir kez** geçmeli: iki noktanın iki kez geçtiği bir
 * değer, sözleşmesi bozulmuş bir değerdir ve tahmin edilerek kurtarılmaz.
 */
export function parseRoleOptionValue(
  value: string,
): { readonly id: RoleId; readonly code: RoleCode } | null {
  const parts = value.split(ROLE_OPTION_SEPARATOR);
  if (parts.length !== 2) return null;

  const [id = "", code = ""] = parts;
  if (id.length === 0 || code.length === 0) return null;

  return { id: asRoleId(id), code: asRoleCode(code) };
}
