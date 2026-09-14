import type { BadgeTone } from "@/components/ui";
import type { AssignmentStatus, PaymentStatus } from "@/server/api/escrow";

/**
 * Atama ve emanet durumlarının Türkçesi — liste ve nesne sayfası aynı sözcüğü
 * kullansın diye tek yerde. Ağ yok, `server-only` yok: yalnız sözlük.
 */

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  PENDING_CONFIRMATION: "Onay bekliyor",
  CONFIRMED: "Onaylı",
  IN_PROGRESS: "Devam ediyor",
  COMPLETED: "Tamamlandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING_COLLECTION: "Tahsil bekliyor",
  HELD_IN_ESCROW: "Emanette",
  RELEASED_TO_WORKER: "İşçiye çıktı",
  FAILED: "Başarısız",
  REFUNDED: "İade",
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, BadgeTone> = {
  HELD_IN_ESCROW: "warning",
  RELEASED_TO_WORKER: "success",
  REFUNDED: "neutral",
  PENDING_COLLECTION: "neutral",
  FAILED: "danger",
};
