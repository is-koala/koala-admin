"use server";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
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
    roleId: text(formData, "roleId"),
    roleCode: text(formData, "roleCode"),
    permission: text(formData, "permission"),
  });
}

export async function revokePermissionFromRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "ROLE_PERMISSION_REVOKE",
    roleId: text(formData, "roleId"),
    roleCode: text(formData, "roleCode"),
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
   * Seçenek değeri bu yüzden `uuid:KOD`; ayırıcı iki nokta, çünkü ne UUID ne de
   * rol kodu onu içerebiliyor (`[0-9a-f-]` ve `[A-Z_]`).
   */
  const [includedRoleId = "", includedRoleCode = ""] = text(formData, "includedRole").split(":");

  return runAuthorizationChange({
    kind: "ROLE_INCLUDE_ADD",
    roleId: text(formData, "roleId"),
    roleCode: text(formData, "roleCode"),
    includedRoleId,
    includedRoleCode,
  });
}

export async function removeRoleInclude(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "ROLE_INCLUDE_REMOVE",
    roleId: text(formData, "roleId"),
    roleCode: text(formData, "roleCode"),
    includedRoleId: text(formData, "includedRoleId"),
    includedRoleCode: text(formData, "includedRoleCode"),
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
