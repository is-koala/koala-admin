"use server";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { asRoleCode } from "@/lib/role-identity";
import { runAuthorizationChange } from "@/server/authz/administration";

/**
 * Personel yönetiminin beş yazımı — ADR-0014 ile dış yönetim konsolundan
 * devrolan iş.
 *
 * Beşi de `runAuthorizationChange`'den geçiyor ve burada başka mantık yok.
 * `/staff` sayfasının kapısı `staff.read`, oysa bu eylemlerin hepsi
 * `staff.manage` istiyor: yani sayfayı görebilen biri bu uçları çağırabilir
 * hâle gelmez. Ayrımı uygulayan yer kapı, sayfa değil — bir Server Action kendi
 * URL'i olan bir POST ucudur ve `<RequirePermission>` onun için hiç çalışmaz.
 */

export async function createStaff(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const displayName = text(formData, "displayName");

  return runAuthorizationChange({
    kind: "STAFF_CREATE",
    email: text(formData, "email"),
    // Backend boş bir `displayName`'i null'a çeviriyor; panel gönderilmeyeni
    // hiç göndermiyor ki iki tarafta iki farklı "boş" tanımı olmasın.
    displayName: displayName.length === 0 ? null : displayName,
    password: raw(formData, "password"),
  });
}

export async function setStaffActive(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "STAFF_SET_ACTIVE",
    staffId: text(formData, "staffId"),
    staffLabel: text(formData, "staffLabel"),
    // Tek doğru değer `"true"`; başka her şey "devre dışı bırak" demek. Bir
    // form alanının bozulması, kimseyi sessizce yeniden etkinleştirmesin.
    active: text(formData, "active") === "true",
  });
}

export async function grantRoleToStaff(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "STAFF_ROLE_GRANT",
    staffId: text(formData, "staffId"),
    staffLabel: text(formData, "staffLabel"),
    roleCode: asRoleCode(text(formData, "roleCode")),
  });
}

export async function revokeRoleFromStaff(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "STAFF_ROLE_REVOKE",
    staffId: text(formData, "staffId"),
    staffLabel: text(formData, "staffLabel"),
    roleCode: asRoleCode(text(formData, "roleCode")),
  });
}

export async function resetStaffPasswordAction(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return runAuthorizationChange({
    kind: "STAFF_PASSWORD_RESET",
    staffId: text(formData, "staffId"),
    staffLabel: text(formData, "staffLabel"),
    password: raw(formData, "password"),
  });
}

/** Kırpılmış metin. Yayımlanmıyor: `"use server"` yalnız async export'a izin verir. */
function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Kırpılmamış metin — yalnız parolalar için.
 *
 * Bir parolanın başındaki ya da sonundaki boşluk parolanın parçasıdır; onu
 * kırpmak, kişinin yazdığından farklı bir parola kaydetmek ve sonra girişte
 * "yanlış parola" demek olurdu. Backend de kırpmıyor (`passwordEncoder.encode`
 * ham dizeyi alıyor).
 */
function raw(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}
