import type { Dispute } from "@/server/api/disputes";
import { isKoalaApiError } from "@/server/api/errors";
import { getEscrowSummary } from "@/server/api/escrow";

import type { SummaryEntry } from "./dispute-detail";

/**
 * Sayfadaki her uyuşmazlık için bir emanet okuması, paralel.
 *
 * Bu bir N+1 ve gözden kaçmış değil, bilinçli. `DisputeDto` hiç para taşımaz;
 * seçenekler kuyrukta tutar göstermemek ya da tutarı panelde hesaplamaktı
 * (panel bunu yasaklar). Yayılımı çağıran sınırlar: kuyruk sayfası
 * `DISPUTE_PAGING` ile, kullanıcı sayfası on satırla.
 *
 * `allSettled`, asla `all`: backend'in konuşmadığı tek bir atama bütün
 * kuyruğu karartmamalı.
 */
export async function loadSummaries(
  accessToken: string,
  disputes: readonly Dispute[],
): Promise<Map<string, SummaryEntry>> {
  const results = await Promise.allSettled(
    disputes.map((dispute) => getEscrowSummary(accessToken, dispute.jobAssignmentId)),
  );

  const byAssignment = new Map<string, SummaryEntry>();

  results.forEach((result, index) => {
    const dispute = disputes[index];
    if (dispute === undefined) return;

    if (result.status === "fulfilled") {
      byAssignment.set(dispute.jobAssignmentId, { ok: true, summary: result.value });
      return;
    }

    const error: unknown = result.reason;
    byAssignment.set(dispute.jobAssignmentId, {
      ok: false,
      failure: {
        message: isKoalaApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Bilinmeyen bir hata oluştu.",
        errorCode: isKoalaApiError(error) ? error.errorCode : "UNEXPECTED",
        requestId: isKoalaApiError(error) ? error.requestId : null,
      },
    });
  });

  return byAssignment;
}
