"use server";

import { revalidatePath } from "next/cache";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { validateSettingWrite } from "@/lib/runtime-settings";
import { isKoalaApiError } from "@/server/api/errors";
import { updateRuntimeSetting } from "@/server/api/settings";
import { getKoalaAccessToken } from "@/server/auth/session";
import { guardDecision } from "@/server/queue/decisions";

/**
 * Server Actions are independent POST endpoints. The page gate does not protect
 * them, so every exported mutation resolves `settings.manage` again before it
 * reads or sends a value.
 */
export async function submitSettingUpdate(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("settings.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const key = text(formData, "key");
  if (key === null) {
    return blocked("Ayar anahtarı metin olarak gönderilmelidir.", "key");
  }

  const value = text(formData, "value");
  if (value === null) {
    return blocked("Ayar değeri metin olarak gönderilmelidir.", "value");
  }

  const trimmed = value.trim();
  const invalid = validateSettingWrite(key, trimmed);
  if (invalid !== null) {
    return blocked(invalid.message, invalid.field);
  }

  let updated;
  try {
    updated = await updateRuntimeSetting(await getKoalaAccessToken(), key, trimmed);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${updated.key} = ${updated.value} olarak güncellendi. Değişiklik denetim kaydına "setting.update" adıyla yazıldı.${revalidationNotice()}`,
  );
}

function blockedFromDecision(decision: {
  readonly message: string;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly field: string | null;
}): AuthorizationChangeOutcome {
  return {
    status: "BLOCKED",
    message: decision.message,
    errorCode: decision.errorCode,
    requestId: decision.requestId,
    field: decision.field,
  };
}

function blocked(message: string, field: string | null = null): AuthorizationChangeOutcome {
  return {
    status: "BLOCKED",
    message,
    errorCode: "PANEL_VALIDATION_FAILED",
    requestId: null,
    field,
  };
}

function succeeded(message: string): AuthorizationChangeOutcome {
  return {
    status: "SUCCEEDED",
    message,
    errorCode: null,
    requestId: null,
    field: null,
  };
}

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function revalidationNotice(): string {
  try {
    revalidatePath("/settings");
    return "";
  } catch {
    return " Değişiklik tamamlandı, ancak liste yeniden doğrulanamadı; güncel liste için sayfayı yenileyin.";
  }
}

function refused(error: unknown): AuthorizationChangeOutcome {
  if (isKoalaApiError(error)) {
    const detail = error.isValidationFailure ? error.details[0] : undefined;
    const field = detail?.field === "value" || detail?.field === "key" ? detail.field : "value";
    const message = detail === undefined ? error.message : `${error.message} ${detail.message}`;

    return {
      status: "REFUSED",
      message,
      errorCode: error.errorCode,
      requestId: error.requestId,
      field,
    };
  }

  return {
    status: "REFUSED",
    message: error instanceof Error ? error.message : "Ayar güncellenemedi.",
    errorCode: null,
    requestId: null,
    field: null,
  };
}
