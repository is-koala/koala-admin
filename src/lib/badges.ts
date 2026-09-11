/**
 * Rozet kataloğu — aile, seviye, kural. Backend enum'larının panel yarısı.
 *
 * İsimler `BadgeFamily` / `BadgeTier` / `BadgeRuleType` ile birebir. Yeni bir
 * kural tipi deploy ister; mevcut bir tipi kullanan rozet `POST /admin/badges`
 * ile eklenir. Eşiksiz kural backend'de 400: panel de göndermeden keser.
 */

export const BADGE_FAMILIES = ["GEZGIN", "RATING", "IDENTITY", "PUNCTUALITY", "OTHER"] as const;
export const BADGE_TIERS = ["BRONZE", "SILVER", "GOLD", "NONE"] as const;
export const BADGE_RULE_TYPES = [
  "COMPLETED_ASSIGNMENTS",
  "AVERAGE_RATING_WITH_MINIMUM_REVIEWS",
  "IDENTITY_VERIFIED",
] as const;

export type BadgeFamily = (typeof BADGE_FAMILIES)[number];
export type BadgeTier = (typeof BADGE_TIERS)[number];
export type BadgeRuleType = (typeof BADGE_RULE_TYPES)[number];

export const BADGE_FAMILY_LABELS: Record<BadgeFamily, string> = {
  GEZGIN: "Gezgin",
  RATING: "Puan",
  IDENTITY: "Kimlik",
  PUNCTUALITY: "Dakiklik",
  OTHER: "Diğer",
};

export const BADGE_TIER_LABELS: Record<BadgeTier, string> = {
  BRONZE: "Bronz",
  SILVER: "Gümüş",
  GOLD: "Altın",
  NONE: "Seviyesiz",
};

export const BADGE_RULE_LABELS: Record<BadgeRuleType, string> = {
  COMPLETED_ASSIGNMENTS: "Tamamlanan iş sayısı",
  AVERAGE_RATING_WITH_MINIMUM_REVIEWS: "Ortalama puan ve yorum eşiği",
  IDENTITY_VERIFIED: "Kimlik doğrulanmış",
};

export const BADGE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface BadgeWrite {
  readonly code: string;
  readonly family: BadgeFamily;
  readonly tier: BadgeTier;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly ruleType: BadgeRuleType;
  readonly minCount: number | null;
  readonly minAverageRating: number | null;
  readonly minReviewCount: number | null;
  readonly active: boolean;
}

export interface BadgeFieldError {
  readonly field: string;
  readonly message: string;
}

function isFamily(value: string): value is BadgeFamily {
  return (BADGE_FAMILIES as readonly string[]).includes(value);
}

function isTier(value: string): value is BadgeTier {
  return (BADGE_TIERS as readonly string[]).includes(value);
}

function isRuleType(value: string): value is BadgeRuleType {
  return (BADGE_RULE_TYPES as readonly string[]).includes(value);
}

function integerField(raw: string, field: string, label: string): number | BadgeFieldError {
  if (!/^-?\d+$/.test(raw)) {
    return { field, message: `${label} tam sayı olmalıdır.` };
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    return { field, message: `${label} tam sayı olmalıdır.` };
  }
  return parsed;
}

/**
 * Form metnini backend'in `SaveBadgeDto` gövdesine çevirir. Kullanılmayan
 * eşikleri `null` yollar: kural tipi değişince eski eşiğin kalması,
 * IDENTITY_VERIFIED rozetine minCount yazardı.
 */
export function parseBadgeWrite(fields: {
  readonly code: string;
  readonly family: string;
  readonly tier: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: string;
  readonly ruleType: string;
  readonly minCount: string;
  readonly minAverageRating: string;
  readonly minReviewCount: string;
  readonly active: string;
}): BadgeWrite | BadgeFieldError {
  if (!BADGE_CODE_PATTERN.test(fields.code)) {
    return {
      field: "code",
      message:
        "Kod büyük harfle başlamalı; yalnız A-Z, 0-9 ve alt çizgi içeren 2-64 karakter olmalı.",
    };
  }

  if (!isFamily(fields.family)) {
    return { field: "family", message: "Aile geçerli bir seçim değil." };
  }

  if (!isTier(fields.tier)) {
    return { field: "tier", message: "Seviye geçerli bir seçim değil." };
  }

  if (fields.name.trim().length === 0 || fields.name.length > 255) {
    return { field: "name", message: "Ad boş olamaz ve en fazla 255 karakter olabilir." };
  }

  if (fields.description.length > 512) {
    return { field: "description", message: "Açıklama en fazla 512 karakter olabilir." };
  }

  const sortOrder = integerField(fields.sortOrder, "sortOrder", "Sıra");
  if (typeof sortOrder !== "number") return sortOrder;
  if (sortOrder < 0) {
    return { field: "sortOrder", message: "Sıra 0 veya daha büyük olmalıdır." };
  }

  if (!isRuleType(fields.ruleType)) {
    return { field: "ruleType", message: "Kural tipi geçerli bir seçim değil." };
  }

  if (fields.active !== "true" && fields.active !== "false") {
    return { field: "active", message: "Etkinlik geçerli bir seçim değil." };
  }

  const description = fields.description.length === 0 ? null : fields.description;

  if (fields.ruleType === "COMPLETED_ASSIGNMENTS") {
    if (fields.minAverageRating !== "" || fields.minReviewCount !== "") {
      return {
        field: "minCount",
        message: "Tamamlanan iş kuralı yalnız iş sayısı eşiği ister.",
      };
    }
    const minCount = integerField(fields.minCount, "minCount", "İş sayısı eşiği");
    if (typeof minCount !== "number") return minCount;
    if (minCount < 1) {
      return { field: "minCount", message: "İş sayısı eşiği en az 1 olmalıdır." };
    }
    return {
      code: fields.code,
      family: fields.family,
      tier: fields.tier,
      name: fields.name,
      description,
      sortOrder,
      ruleType: fields.ruleType,
      minCount,
      minAverageRating: null,
      minReviewCount: null,
      active: fields.active === "true",
    };
  }

  if (fields.ruleType === "AVERAGE_RATING_WITH_MINIMUM_REVIEWS") {
    if (fields.minCount !== "") {
      return {
        field: "minAverageRating",
        message: "Puan kuralı iş sayısı eşiği taşımaz.",
      };
    }
    if (fields.minAverageRating.trim() === "") {
      return { field: "minAverageRating", message: "Ortalama puan eşiği zorunludur." };
    }
    const rating = Number(fields.minAverageRating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return {
        field: "minAverageRating",
        message: "Ortalama puan eşiği 1.00 ile 5.00 arasında olmalıdır.",
      };
    }
    const minReviewCount = integerField(
      fields.minReviewCount,
      "minReviewCount",
      "Yorum sayısı eşiği",
    );
    if (typeof minReviewCount !== "number") return minReviewCount;
    if (minReviewCount < 1) {
      return { field: "minReviewCount", message: "Yorum sayısı eşiği en az 1 olmalıdır." };
    }
    return {
      code: fields.code,
      family: fields.family,
      tier: fields.tier,
      name: fields.name,
      description,
      sortOrder,
      ruleType: fields.ruleType,
      minCount: null,
      minAverageRating: rating,
      minReviewCount,
      active: fields.active === "true",
    };
  }

  if (fields.minCount !== "" || fields.minAverageRating !== "" || fields.minReviewCount !== "") {
    return {
      field: "ruleType",
      message: "Kimlik doğrulama kuralı eşik taşımaz.",
    };
  }

  return {
    code: fields.code,
    family: fields.family,
    tier: fields.tier,
    name: fields.name,
    description,
    sortOrder,
    ruleType: fields.ruleType,
    minCount: null,
    minAverageRating: null,
    minReviewCount: null,
    active: fields.active === "true",
  };
}
