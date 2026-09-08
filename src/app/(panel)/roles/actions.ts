"use server";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { asRoleCode, asRoleId, parseRoleOptionValue } from "@/lib/role-identity";
import { runAuthorizationChange } from "@/server/authz/administration";

/**
 * Rol→izin DAG'ının dört yazımı.
 *
 * Dördü de tek satırda aynı kapıdan geçiyor ve bu dosyada başka hiçbir mantık
 * yok — bilerek. Bir Server Action kendi URL'i olan bir POST ucudur ve
 * `/roles` sayfasındaki `<RequirePermission permission="role.manage">` onun
 * için hiç çalışmaz; izni yeniden çözen, girdiyi doğrulayan ve backend'in
 * reddini Türkçeye çeviren yer `runAuthorizationChange`.
 *
 * `"use server"` bir modülün yalnız async fonksiyon yayımlamasına izin veriyor,
 * bu yüzden ne bir sabit ne bir tip burada duruyor.
 */

export async function grantPermissionToRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "ROLE_PERMISSION_GRANT",
    roleId: asRoleId(text(formData, "roleId")),
    roleCode: asRoleCode(text(formData, "roleCode")),
    permission: text(formData, "permission"),
  });
}

export async function revokePermissionFromRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "ROLE_PERMISSION_REVOKE",
    roleId: asRoleId(text(formData, "roleId")),
    roleCode: asRoleCode(text(formData, "roleCode")),
    permission: text(formData, "permission"),
  });
}

export async function addRoleInclude(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  /**
   * Tek bir `<select>` iki bilgi taşıyor: backend kenarı **UUID** ile yazıyor,
   * operatör ise rolü **koduyla** tanıyor ve mesajlarda kod geçmesi gerekiyor.
   * Çiftin biçimi, yazanı ve okuyanı `src/lib/role-identity.ts`'te yan yana.
   *
   * Bozuk bir çift iki boş dizeye düşüyor ve kapı onu gönderilmeden reddediyor.
   * Eskiden yalnız ilk yarı okunuyordu: iki noktası olmayan bir değer
   * (`"COPUK"`) istek olarak gidiyor, backend gizemli bir 404 döndürüyor ya da
   * — kabul etseydi — başarı cümlesi rolün adı olması gereken yerde boşlukla
   * çiziliyordu.
   */
  const included = parseRoleOptionValue(text(formData, "includedRole"));

  return runAuthorizationChange({
    kind: "ROLE_INCLUDE_ADD",
    roleId: asRoleId(text(formData, "roleId")),
    roleCode: asRoleCode(text(formData, "roleCode")),
    includedRoleId: included?.id ?? asRoleId(""),
    includedRoleCode: included?.code ?? asRoleCode(""),
  });
}

export async function removeRoleInclude(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "ROLE_INCLUDE_REMOVE",
    roleId: asRoleId(text(formData, "roleId")),
    roleCode: asRoleCode(text(formData, "roleCode")),
    includedRoleId: asRoleId(text(formData, "includedRoleId")),
    includedRoleCode: asRoleCode(text(formData, "includedRoleCode")),
  });
}

/**
 * `FormData`'dan bir metin. Yayımlanmıyor: `"use server"` bir modülün yalnız
 * async fonksiyon yayımlamasına izin verir ve bunu yayımlamak, dosyanın bütün
 * export'larının "eksik" diye bildirildiği şaşırtıcı bir derleme hatası olurdu.
 */
function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
