/**
 * Bir yetkilendirme yazımının formuna geri dönen şey.
 *
 * `decision-state.ts` ile aynı sebeple import'suz: bu modülü hem
 * `authorization-form.tsx` (`"use client"`) hem de onu cevaplayan
 * `src/server/authz/administration.ts` okuyor. Oradan bir değer — sözgelimi
 * boş başlangıç durumu — doğrudan alınsaydı, `administration.ts`'in
 * `import "server-only"` satırı yüzünden derleme kırılırdı; ve o satır
 * kalkarsa Koala API istemcisi tarayıcı paketine girerdi. Sınırı geçen şey
 * beş alan.
 */

export type AuthorizationChangeStatus =
  /** Backend yaptı. */
  | "SUCCEEDED"
  /** Backend reddetti — 403, 409, 404, 400. Kendi mesajıyla görünür. */
  | "REFUSED"
  /** Panel sormadan reddetti: izin yok, ya da form eksik. İstek gitmedi. */
  | "BLOCKED";

export interface AuthorizationChangeOutcome {
  readonly status: AuthorizationChangeStatus;
  /** Türkçe. Backend konuştuysa onun cümlesiyle başlar. */
  readonly message: string;
  /** `ErrorResult.errorCode`, ya da panelin kendi reddinin adı. */
  readonly errorCode: string | null;
  /** Backend'in istek numarası — günlükteki satıra tek tutamak. */
  readonly requestId: string | null;
  /**
   * Mesajın ait olduğu form alanı, varsa. `null` mesajın formun tamamına ait
   * olduğunu söyler — bir backend reddi kimsenin yazım hatası değildir.
   */
  readonly field: string | null;
}

/** `useActionState`'in beklediği biçim: önceki durum girer, sonraki çıkar. */
export type AuthorizationChangeAction = (
  state: AuthorizationChangeOutcome,
  formData: FormData,
) => Promise<AuthorizationChangeOutcome>;

/**
 * Henüz hiçbir şey gönderilmemiş hâl.
 *
 * `status` `"BLOCKED"` ve `message` boş: form "hiçbir şey yapılmadı" ile
 * "panel reddetti" arasındaki farkı mesajın boşluğundan okuyor, çünkü dördüncü
 * bir durum eklemek her okuma yerinde bir dal daha demekti.
 */
export const IDLE_AUTHORIZATION_OUTCOME: AuthorizationChangeOutcome = {
  status: "BLOCKED",
  message: "",
  errorCode: null,
  requestId: null,
  field: null,
};
