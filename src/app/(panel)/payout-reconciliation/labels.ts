import type { BadgeTone } from "@/components/ui";
import type { PayoutStatus } from "@/server/api/payout-reconciliation";

/**
 * Hakediş durumu rozet renkleri — liste ve nesne sayfası aynı rengi kullansın
 * diye tek yerde. Metinler `PAYOUT_STATUS_LABELS`ta (API modülü). Ağ yok,
 * `server-only` yok: yalnız sözlük.
 */
export const PAYOUT_STATUS_TONES: Record<PayoutStatus, BadgeTone> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};
