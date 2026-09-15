/**
 * Personel notları ve işaretlerinin kapalı kümeleri (koala-backend#302).
 *
 * İsimler backend `StaffResourceType` / `StaffFlagKind` ile birebir. Yeni bir
 * tür gelmeden panel onu yazamaz — Spring bilinmeyen enum'u 400 yapar. Okuma
 * tarafı `z.string()` ile gevşek: eski sunucu ya da henüz bilinmeyen bir tür
 * satırı düşürmesin diye etiket ham koda düşer.
 */

export const STAFF_RESOURCE_TYPES = [
  "USER",
  "COMPANY",
  "JOB_ASSIGNMENT",
  "DISPUTE",
  "REPORT",
  "JOB",
] as const;

export type StaffResourceType = (typeof STAFF_RESOURCE_TYPES)[number];

export const STAFF_FLAG_KINDS = ["RISK", "VIP", "WATCH", "OTHER"] as const;

export type StaffFlagKind = (typeof STAFF_FLAG_KINDS)[number];

/** `StaffNote.BODY_MAX_LENGTH` — aşanı backend 400'ler, panel önce durur. */
export const NOTE_BODY_MAX_LENGTH = 2000;

/** `StaffFlag.LABEL_MAX_LENGTH`. */
export const FLAG_LABEL_MAX_LENGTH = 120;

/** `StaffFlagLookup.MAX_RESOURCES` — fazlası 400; liste sayfaları parçalar. */
export const FLAG_BATCH_MAX = 200;

const FLAG_LABELS: Record<string, string> = {
  RISK: "Riskli",
  VIP: "VIP",
  WATCH: "İzlemede",
  OTHER: "Diğer",
};

export type StaffFlagTone = "neutral" | "brand" | "success" | "warning" | "danger";

const FLAG_TONES: Record<string, StaffFlagTone> = {
  RISK: "danger",
  VIP: "brand",
  WATCH: "warning",
  OTHER: "neutral",
};

/**
 * Bilinmeyen tür ham kod olarak kalır: boş hücre "işaret yok" diye okunur,
 * `IMPERSONATION` gören operatör hâlâ harekete geçebilir.
 */
export function staffFlagKindLabel(kind: string): string {
  return FLAG_LABELS[kind] ?? kind;
}

export function staffFlagKindTone(kind: string): StaffFlagTone {
  return FLAG_TONES[kind] ?? "neutral";
}

export function isStaffResourceType(value: string): value is StaffResourceType {
  return (STAFF_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function isStaffFlagKind(value: string): value is StaffFlagKind {
  return (STAFF_FLAG_KINDS as readonly string[]).includes(value);
}

export interface FlagResourceRef {
  readonly resourceId: string;
  readonly clearedAt: string | null;
}

/**
 * Liste rozeti için kaynağa göre grup. `clearedAt` dolu satır düşer — backend
 * yalnız etkinleri döner ama eski sunucu kapanmış satır da gönderebilir.
 */
export function groupFlagsByResourceId<T extends FlagResourceRef>(
  flags: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const flag of flags) {
    if (flag.clearedAt !== null) continue;
    const existing = grouped.get(flag.resourceId);
    if (existing === undefined) {
      grouped.set(flag.resourceId, [flag]);
    } else {
      existing.push(flag);
    }
  }

  return grouped;
}

export function objectPathFor(resourceType: StaffResourceType, resourceId: string): string {
  switch (resourceType) {
    case "USER":
      return `/users/${resourceId}`;
    case "COMPANY":
      return `/companies/${resourceId}`;
    case "JOB":
      return `/jobs/${resourceId}`;
    case "JOB_ASSIGNMENT":
      return `/assignments/${resourceId}`;
    case "DISPUTE":
      return `/disputes/${resourceId}`;
    case "REPORT":
      return `/reports/${resourceId}`;
  }
}

export function listPathFor(resourceType: StaffResourceType): string {
  switch (resourceType) {
    case "USER":
      return "/users";
    case "COMPANY":
      return "/companies";
    case "JOB":
      return "/jobs";
    case "JOB_ASSIGNMENT":
      return "/assignments";
    case "DISPUTE":
      return "/disputes";
    case "REPORT":
      return "/reports";
  }
}
