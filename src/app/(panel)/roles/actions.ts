"use server";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { asRoleCode, asRoleId, parseRoleOptionValue } from "@/lib/role-identity";
import { runAuthorizationChange } from "@/server/authz/administration";
import { revalidateAfterWrite } from "@/server/queue/revalidate-after-write";

/**
 * Rol→izin DAG'ının dört yazımı.
 *
 * Dördü de aynı kapıdan geçiyor. Başarıdan sonra `/roles` ve ana ekran
 * yenilenir — nesne rotası yok; liste aksi halde eski izin/kapsama çizer.
 */

export async function grantPermissionToRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return afterWrite(
    await runAuthorizationChange({
      kind: "ROLE_PERMISSION_GRANT",
      roleId: asRoleId(text(formData, "roleId")),
      roleCode: asRoleCode(text(formData, "roleCode")),
      permission: text(formData, "permission"),
    }),
  );
}

export async function revokePermissionFromRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return afterWrite(
    await runAuthorizationChange({
      kind: "ROLE_PERMISSION_REVOKE",
      roleId: asRoleId(text(formData, "roleId")),
      roleCode: asRoleCode(text(formData, "roleCode")),
      permission: text(formData, "permission"),
    }),
  );
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

  return afterWrite(
    await runAuthorizationChange({
      kind: "ROLE_INCLUDE_ADD",
      roleId: asRoleId(text(formData, "roleId")),
      roleCode: asRoleCode(text(formData, "roleCode")),
      includedRoleId: included?.id ?? asRoleId(""),
      includedRoleCode: included?.code ?? asRoleCode(""),
    }),
  );
}

export async function removeRoleInclude(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  return afterWrite(
    await runAuthorizationChange({
      kind: "ROLE_INCLUDE_REMOVE",
      roleId: asRoleId(text(formData, "roleId")),
      roleCode: asRoleCode(text(formData, "roleCode")),
      includedRoleId: asRoleId(text(formData, "includedRoleId")),
      includedRoleCode: asRoleCode(text(formData, "includedRoleCode")),
    }),
  );
}

function afterWrite(outcome: AuthorizationChangeOutcome): AuthorizationChangeOutcome {
  if (outcome.status === "SUCCEEDED") {
    revalidateAfterWrite("/roles", "/");
  }
  return outcome;
}

/**
 * `FormData`'dan bir metin. Yayımlanmıyor: `"use server"` bir modülün yalnız
 * async fonksiyon yayımlamasına izin verir ve bunu yayımlamak, dosyanın bütün
 * export'larının "eksik" diye bildirildiği şaşırtıcı bir derleme hatası olurdu.
 */
function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
