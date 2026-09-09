"use server";

import { revalidatePath } from "next/cache";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { isKoalaApiError } from "@/server/api/errors";
import {
  createJobCategory,
  deleteJobCategory,
  updateJobCategory,
  type JobCategoryInput,
} from "@/server/api/job-categories";
import { getKoalaAccessToken } from "@/server/auth/session";
import { guardDecision } from "@/server/queue/decisions";

/**
 * Server Actions are independent POST endpoints. The page gate does not protect
 * them, so every exported mutation resolves `category.manage` again before it
 * reads or sends category data.
 */
export async function submitCategoryCreate(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("category.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const parsed = categoryInput(formData);
  if ("invalid" in parsed) return parsed.invalid;

  const input = parsed.input;
  const invalid = validateInput(input);
  if (invalid !== null) return invalid;

  let created;
  try {
    created = await createJobCategory(await getKoalaAccessToken(), input);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${created.name} oluşturuldu. Değişiklik denetim kaydına "job.category.create" adıyla yazıldı.${revalidationNotice()}`,
  );
}

export async function submitCategoryUpdate(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("category.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const categoryId = text(formData, "categoryId");
  if (!isUuid(categoryId)) {
    return blocked("Kategori kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const parsed = categoryInput(formData);
  if ("invalid" in parsed) return parsed.invalid;

  const input = parsed.input;
  const invalid = validateInput(input);
  if (invalid !== null) return invalid;

  let updated;
  try {
    updated = await updateJobCategory(await getKoalaAccessToken(), categoryId, input);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${updated.name} güncellendi. Değişiklik denetim kaydına "job.category.update" adıyla yazıldı.${revalidationNotice()}`,
  );
}

export async function submitCategoryDelete(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("category.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const categoryId = text(formData, "categoryId");
  if (!isUuid(categoryId)) {
    return blocked("Kategori kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (text(formData, "deleteConfirmation") !== `DELETE:${categoryId}`) {
    return blocked(
      "Silme geri alınamaz. Devam etmek için açık silme onayını işaretleyin.",
      "deleteConfirmation",
    );
  }

  try {
    await deleteJobCategory(await getKoalaAccessToken(), categoryId);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `Kategori silindi. Değişiklik denetim kaydına "job.category.delete" adıyla yazıldı.${revalidationNotice()}`,
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

function categoryInput(
  formData: FormData,
): { input: JobCategoryInput } | { invalid: AuthorizationChangeOutcome } {
  const code = text(formData, "code");
  if (code === null) {
    return { invalid: blocked("Kod metin olarak gönderilmelidir.", "code") };
  }

  const name = text(formData, "name");
  if (name === null) {
    return { invalid: blocked("Ad metin olarak gönderilmelidir.", "name") };
  }

  const insuranceEntries = formData.getAll("requiresInsurance");
  if (
    insuranceEntries.length === 0 ||
    insuranceEntries.some(
      (value) => typeof value !== "string" || (value !== "true" && value !== "false"),
    )
  ) {
    return {
      invalid: blocked("Sigorta gereksinimi geçerli bir seçim değil.", "requiresInsurance"),
    };
  }

  const insuranceValues = insuranceEntries as string[];

  return {
    input: {
      code,
      name,
      requiresInsurance: insuranceValues.includes("true"),
    },
  };
}

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function isUuid(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function revalidationNotice(): string {
  try {
    revalidatePath("/job-categories");
    return "";
  } catch {
    return " Değişiklik tamamlandı, ancak liste yeniden doğrulanamadı; güncel liste için sayfayı yenileyin.";
  }
}

function validateInput(input: { code: string; name: string }): AuthorizationChangeOutcome | null {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.code)) {
    return blocked(
      "Kod büyük harfle başlamalı; yalnız A-Z, 0-9 ve alt çizgi içeren 2-64 karakter olmalı.",
      "code",
    );
  }

  if (input.name.trim().length === 0 || input.name.length > 255) {
    return blocked("Ad boş olamaz ve en fazla 255 karakter olabilir.", "name");
  }

  return null;
}

function refused(error: unknown): AuthorizationChangeOutcome {
  if (isKoalaApiError(error)) {
    const detail = error.isValidationFailure ? error.details[0] : undefined;
    const field =
      error.errorCode === "JOB_CATEGORY_CODE_ALREADY_EXISTS" ? "code" : (detail?.field ?? null);

    let message = detail === undefined ? error.message : `${error.message} ${detail.message}`;
    if (error.errorCode === "JOB_CATEGORY_NOT_FOUND_BY_ID") {
      message = `${message} Kayıt değişmiş olabilir; sayfayı yenileyin.`;
    } else if (error.errorCode === "JOB_CATEGORY_IN_USE") {
      message = `${message} Bu kategoriye bağlı ilan, alarm veya şablon varken silinemez.`;
    }

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
    message: error instanceof Error ? error.message : "Kategori değişikliği gönderilemedi.",
    errorCode: null,
    requestId: null,
    field: null,
  };
}
