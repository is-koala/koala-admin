"use server";

import { revalidatePath } from "next/cache";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { parseBadgeWrite, type BadgeWrite } from "@/lib/badges";
import { isKoalaApiError } from "@/server/api/errors";
import { createBadge, setBadgeActive, setBadgeIcon, updateBadge } from "@/server/api/badges";
import { getKoalaAccessToken } from "@/server/auth/session";
import { guardDecision } from "@/server/queue/decisions";

/**
 * Server Action'lar bağımsız POST uçları. Sayfa kapısı onları korumaz, bu
 * yüzden her yazım `badge.manage`'i yeniden çözer — izinsiz istek atılmaz.
 */

export async function submitBadgeCreate(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("badge.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const parsed = badgeInput(formData);
  if ("invalid" in parsed) return parsed.invalid;

  let created;
  try {
    created = await createBadge(await getKoalaAccessToken(), parsed.input);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${created.name} oluşturuldu. Değişiklik denetim kaydına "badge.create" adıyla yazıldı.${revalidationNotice()}`,
  );
}

export async function submitBadgeUpdate(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("badge.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const badgeId = text(formData, "badgeId");
  if (!isUuid(badgeId)) {
    return blocked("Rozet kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const parsed = badgeInput(formData);
  if ("invalid" in parsed) return parsed.invalid;

  let updated;
  try {
    updated = await updateBadge(await getKoalaAccessToken(), badgeId, parsed.input);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${updated.name} güncellendi. Değişiklik denetim kaydına "badge.update" adıyla yazıldı.${revalidationNotice()}`,
  );
}

export async function submitBadgeIcon(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("badge.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const badgeId = text(formData, "badgeId");
  if (!isUuid(badgeId)) {
    return blocked("Rozet kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const icon = formData.get("icon");
  if (!(icon instanceof Blob) || icon.size === 0) {
    return blocked("Yüklenecek bir görsel seçin.", "icon");
  }

  let updated;
  try {
    updated = await setBadgeIcon(await getKoalaAccessToken(), badgeId, icon);
  } catch (error) {
    return refused(error);
  }

  return succeeded(
    `${updated.name} görseli güncellendi. Değişiklik denetim kaydına "badge.icon.set" adıyla yazıldı.${revalidationNotice()}`,
  );
}

export async function submitBadgeActivation(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const denied = await guardDecision("badge.manage");
  if (denied !== null) return blockedFromDecision(denied);

  const badgeId = text(formData, "badgeId");
  if (!isUuid(badgeId)) {
    return blocked("Rozet kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const active = text(formData, "active");
  if (active !== "true" && active !== "false") {
    return blocked("Etkinlik geçerli bir seçim değil.", "active");
  }

  let updated;
  try {
    updated = await setBadgeActive(await getKoalaAccessToken(), badgeId, active === "true");
  } catch (error) {
    return refused(error);
  }

  const label = updated.active ? "etkinleştirildi" : "pasifleştirildi";
  return succeeded(
    `${updated.name} ${label}. Değişiklik denetim kaydına "badge.activation.set" adıyla yazıldı.${revalidationNotice()}`,
  );
}

function requiredText(
  formData: FormData,
  name: string,
  message: string,
): string | AuthorizationChangeOutcome {
  const value = text(formData, name);
  return value === null ? blocked(message, name) : value;
}

function badgeInput(
  formData: FormData,
): { input: BadgeWrite } | { invalid: AuthorizationChangeOutcome } {
  const code = requiredText(formData, "code", "Kod metin olarak gönderilmelidir.");
  if (typeof code !== "string") return { invalid: code };
  const family = requiredText(formData, "family", "Aile metin olarak gönderilmelidir.");
  if (typeof family !== "string") return { invalid: family };
  const tier = requiredText(formData, "tier", "Seviye metin olarak gönderilmelidir.");
  if (typeof tier !== "string") return { invalid: tier };
  const name = requiredText(formData, "name", "Ad metin olarak gönderilmelidir.");
  if (typeof name !== "string") return { invalid: name };
  const description = requiredText(
    formData,
    "description",
    "Açıklama metin olarak gönderilmelidir.",
  );
  if (typeof description !== "string") return { invalid: description };
  const sortOrder = requiredText(formData, "sortOrder", "Sıra metin olarak gönderilmelidir.");
  if (typeof sortOrder !== "string") return { invalid: sortOrder };
  const ruleType = requiredText(formData, "ruleType", "Kural tipi metin olarak gönderilmelidir.");
  if (typeof ruleType !== "string") return { invalid: ruleType };
  const minCount = requiredText(
    formData,
    "minCount",
    "İş sayısı eşiği metin olarak gönderilmelidir.",
  );
  if (typeof minCount !== "string") return { invalid: minCount };
  const minAverageRating = requiredText(
    formData,
    "minAverageRating",
    "Puan eşiği metin olarak gönderilmelidir.",
  );
  if (typeof minAverageRating !== "string") return { invalid: minAverageRating };
  const minReviewCount = requiredText(
    formData,
    "minReviewCount",
    "Yorum eşiği metin olarak gönderilmelidir.",
  );
  if (typeof minReviewCount !== "string") return { invalid: minReviewCount };
  const active = requiredText(formData, "active", "Etkinlik metin olarak gönderilmelidir.");
  if (typeof active !== "string") return { invalid: active };

  const parsed = parseBadgeWrite({
    code,
    family,
    tier,
    name,
    description,
    sortOrder,
    ruleType,
    minCount,
    minAverageRating,
    minReviewCount,
    active,
  });

  if ("field" in parsed) return { invalid: blocked(parsed.message, parsed.field) };
  return { input: parsed };
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

function isUuid(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function revalidationNotice(): string {
  try {
    revalidatePath("/badges");
    return "";
  } catch {
    return " Değişiklik tamamlandı, ancak liste yeniden doğrulanamadı; güncel liste için sayfayı yenileyin.";
  }
}

function refused(error: unknown): AuthorizationChangeOutcome {
  if (isKoalaApiError(error)) {
    const detail = error.isValidationFailure ? error.details[0] : undefined;
    const field =
      error.errorCode === "BADGE_CODE_ALREADY_EXISTS" ? "code" : (detail?.field ?? null);

    let message = detail === undefined ? error.message : `${error.message} ${detail.message}`;
    if (error.errorCode === "BADGE_NOT_FOUND") {
      message = `${message} Kayıt değişmiş olabilir; sayfayı yenileyin.`;
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
    message: error instanceof Error ? error.message : "Rozet değişikliği gönderilemedi.",
    errorCode: null,
    requestId: null,
    field: null,
  };
}
