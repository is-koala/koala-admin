"use client";

import { useActionState, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";
import type { RoleCode, RoleId } from "@/lib/role-identity";

/**
 * Rol grafiğine ya da bir personel kaydına yapılan tek bir yazım, form olarak.
 *
 * Bir ekranda bunlardan onlarca var — her izin satırının yanında bir "kaldır",
 * her kapsamanın yanında bir "çıkar" — ve hepsi aynı üç şeyi yapmak zorunda:
 * ne olacağını **tıklamadan önce** söylemek, cevabı kendi yanında göstermek, ve
 * bekleyen bir isteği ikinci kez göndermemek. Üçü de burada bir kere yazılı.
 *
 * Sunucu tarafından gelen tek şey `@/lib/authorization-change`: import'suz, saf
 * ve bilerek öyle. Aynı biçimi üreten `src/server/authz/administration.ts`
 * `import "server-only"` taşıyor, yani buradan okunsaydı derleme kırılırdı — ve
 * o satır kalkarsa Koala API istemcisi tarayıcı paketine girerdi. `action` bir
 * prop olarak geliyor; bu dosya `src/server/` altından hiçbir şey bilmiyor.
 *
 * ## Ne olduğunu söylemeyen bir düğme koymamak
 *
 * `consequence` isteğe bağlı değil gibi davranılıyor: her çağrı yerinde yazılı,
 * çünkü bu ekrandaki düğmelerin çoğu geri alınabilir görünüp geri alınması
 * kolay olmayan şeyler yapıyor — bir rolden izin kaldırmak, o rolü taşıyan
 * herkesin bir sonraki isteğinde geçerli olur.
 */

export interface AuthorizationFieldOption {
  readonly value: string;
  readonly label: string;
  /**
   * Seçilemez bir seçenek ve **sebebi**. Döngü yaratacak bir kapsama böyle
   * görünüyor: backend onu 409 ile reddedecek, panel de reddedileceği belli
   * olan bir isteği göndermiyor.
   */
  readonly disabledReason?: string;
  /**
   * Seçilebilir ama söylenmesi gereken bir şey. Görev ayrılığını bozacak bir
   * kapsama burada: backend onu **kabul eder**, bu yüzden seçenek kapalı
   * değil — yalnız ne yaptığı yazılı.
   */
  readonly note?: string;
}

export interface AuthorizationField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "email" | "password" | "select";
  readonly hint?: string;
  readonly required?: boolean;
  readonly autoComplete?: string;
  readonly minLength?: number;
  /** `select` için. İlk seçilebilir seçenek varsayılan olur. */
  readonly options?: readonly AuthorizationFieldOption[];
}

/**
 * Formun taşıdığı gizli girdiler — adı adına, tipi tipine.
 *
 * `Record<string, string>` idi ve bu, bu ekranın en pahalı sessiz hatasına
 * kapı açıyordu: `{ roleId: role.code, roleCode: role.id }` yazmak hem
 * `tsc`'den hem testlerin tamamından geçiyor, sonucu ancak backend'de
 * gizemli bir 404 olarak görünüyordu. `RoleId` ile `RoleCode` markalı olduğu
 * için o satır artık derlenmiyor.
 *
 * Alanların hepsi isteğe bağlı: hangi yazımın hangi alanı istediğini
 * `AuthorizationChange` birleşimi zaten söylüyor ve eksiği
 * `runAuthorizationChange` gönderimden önce reddediyor. Buradaki sözleşme
 * "hangi alan zorunlu" değil, **"bu adın değeri hangi tip"**.
 */
export interface AuthorizationHiddenFields {
  readonly roleId?: RoleId;
  readonly roleCode?: RoleCode;
  readonly includedRoleId?: RoleId;
  readonly includedRoleCode?: RoleCode;
  readonly permission?: string;
  readonly staffId?: string;
  readonly staffLabel?: string;
  readonly active?: string;
}

export interface AuthorizationFormProps {
  action: AuthorizationChangeAction;
  /** Değiştirilen kaydın kimliği; gizli girdi olarak çizilir. */
  hiddenFields: AuthorizationHiddenFields;
  submitLabel: string;
  /** Ne olacağı, gelecek zamanla, tek cümle. */
  consequence: ReactNode;
  fields?: readonly AuthorizationField[];
  /** Tablo içindeki tek düğmeler için sıkışık düzen. */
  layout?: "inline" | "block";
  tone?: "default" | "danger";
  /** Kimlikler bir tablo boyunca benzersiz olmak zorunda. */
  idPrefix: string;
  disabled?: boolean;
  disabledReason?: string;
}

const BUTTON_BASE =
  "rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";

const CONTROL =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-subtle aria-[invalid=true]:border-danger";

export function AuthorizationForm({
  action,
  hiddenFields,
  submitLabel,
  consequence,
  fields = [],
  layout = "block",
  tone = "default",
  idPrefix,
  disabled = false,
  disabledReason,
}: AuthorizationFormProps) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );

  const [selection, setSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.type === "select")
        .map((field) => [
          field.name,
          field.options?.find((option) => option.disabledReason === undefined)?.value ?? "",
        ]),
    ),
  );

  if (disabled) {
    return (
      <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
        {disabledReason ?? "Bu değişiklik yapılamaz."}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className={cn(
        "flex gap-2",
        layout === "inline" ? "flex-wrap items-center" : "flex-col items-stretch",
      )}
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const invalid = state.field === field.name;
        const hintId = field.hint === undefined ? undefined : `${id}-hint`;
        const errorId = invalid ? `${id}-error` : undefined;
        const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
        const chosen = field.options?.find((option) => option.value === selection[field.name]);

        return (
          <div key={field.name} className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium text-ink">
              {field.label}
              {field.required === true ? (
                <span className="text-danger" aria-hidden="true">
                  {" *"}
                </span>
              ) : null}
            </label>

            {field.type === "select" ? (
              <select
                id={id}
                name={field.name}
                className={CONTROL}
                required={field.required}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={selection[field.name] ?? ""}
                onChange={(event) =>
                  setSelection((current) => ({ ...current, [field.name]: event.target.value }))
                }
              >
                {(field.options ?? []).map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabledReason !== undefined}
                  >
                    {option.disabledReason === undefined
                      ? option.label
                      : `${option.label} — ${option.disabledReason}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={field.name}
                type={field.type}
                className={CONTROL}
                required={field.required}
                minLength={field.minLength}
                autoComplete={field.autoComplete}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}

            {field.hint === undefined ? null : (
              <p id={hintId} className="text-xs text-ink-subtle">
                {field.hint}
              </p>
            )}

            {chosen?.note === undefined ? null : (
              <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink">
                {chosen.note}
              </p>
            )}
          </div>
        );
      })}

      <p
        className={cn(
          "text-xs",
          layout === "inline" ? "sr-only" : "max-w-prose text-ink-muted",
          tone === "danger" && layout === "block" ? "text-warning" : null,
        )}
        id={`${idPrefix}-consequence`}
      >
        {consequence}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          aria-describedby={`${idPrefix}-consequence`}
          className={cn(
            BUTTON_BASE,
            tone === "danger"
              ? "border border-danger/40 bg-danger-soft text-danger hover:bg-danger/10"
              : "bg-brand text-white hover:bg-brand-strong",
          )}
        >
          {pending ? "Gönderiliyor…" : submitLabel}
        </button>

        {state.status === "SUCCEEDED" ? <Badge tone="success">Yapıldı</Badge> : null}
        {state.status === "REFUSED" ? <Badge tone="danger">Backend reddetti</Badge> : null}
        {state.status === "BLOCKED" ? <Badge tone="warning">Gönderilmedi</Badge> : null}
      </div>

      {state.status === "IDLE" ? null : (
        <div
          role="status"
          className={cn(
            "flex flex-col gap-1 rounded-md border px-3 py-2 text-sm",
            state.status === "SUCCEEDED"
              ? "border-success/30 bg-success-soft text-ink"
              : "border-danger/30 bg-danger-soft text-ink",
          )}
        >
          <p className="max-w-prose">{state.message}</p>
          {state.errorCode === null && state.requestId === null ? null : (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              {state.errorCode === null ? null : (
                <div className="flex gap-1">
                  <dt>Hata kodu:</dt>
                  <dd className="font-mono">{state.errorCode}</dd>
                </div>
              )}
              {state.requestId === null ? null : (
                <div className="flex gap-1">
                  <dt>İstek numarası:</dt>
                  <dd className="font-mono break-all">{state.requestId}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </form>
  );
}
