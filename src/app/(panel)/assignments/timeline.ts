import { formatInteger } from "@/lib/format";
import { TimelineBuilder, type TimelineEvent } from "@/lib/object-timeline";
import { shortId } from "@/lib/short-id";
import {
  applicationStatusLabel,
  cancellationPartyLabel,
  timesheetFlagLabel,
  type AssignmentDetail,
} from "@/server/api/escrow";
import { PAYMENT_ATTEMPT_STATUS_LABELS, type AdminPayment } from "@/server/api/payments";
import { safeUserName } from "@/server/api/users";

/**
 * Atamanın DTO olayları: başvuru → kabul → atama → ödeme → mesai
 * (giriş/çıkış) → iptal ya da tamamlanma → değerlendirme → hakediş
 * (koala-admin#100), koala-admin#107 ile `ObjectTimeline`'a taşındı; sıralama
 * ve personel kararları artık orada. Eski sunucu başvuru, mesai, iptal ve
 * değerlendirmeyi göndermez; o satırlar yalnız yoklukla eksilir.
 */
export function assignmentTimelineEvents(
  assignment: AssignmentDetail,
  payments: readonly AdminPayment[],
): readonly TimelineEvent[] {
  const timeline = new TimelineBuilder();

  if (assignment.application !== null) {
    timeline.push(assignment.application.applicationDateTime, "Başvuru yapıldı", {
      actor: { kind: "user", userId: assignment.worker.id, name: safeUserName(assignment.worker) },
    });
    timeline.push(assignment.application.answeredDateTime, "Başvuru yanıtlandı", {
      detail:
        assignment.application.status === null
          ? null
          : applicationStatusLabel(assignment.application.status),
      actor: {
        kind: "user",
        userId: assignment.employer.id,
        name: safeUserName(assignment.employer),
      },
    });
  }
  timeline.push(assignment.createdAt, "Atama oluşturuldu");
  timeline.push(assignment.assignmentDateTime, "Atama zamanı");
  for (const session of assignment.workSessions ?? []) {
    timeline.push(session.checkInAt, "Mesai girişi", {
      detail: flagSummary(session.checkInPlausibilityFlags),
    });
    timeline.push(session.checkOutAt, "Mesai çıkışı", {
      detail: flagSummary(session.checkOutPlausibilityFlags),
    });
  }
  if (assignment.cancellation !== null) {
    const cancelledBy = assignment.cancellation.cancelledBy;
    timeline.push(assignment.cancellation.cancelledAt, "Atama iptal edildi", {
      detail:
        assignment.cancellation.cancelledByParty === null
          ? null
          : cancellationPartyLabel(assignment.cancellation.cancelledByParty),
      actor:
        cancelledBy === null
          ? null
          : { kind: "user", userId: cancelledBy.id, name: safeUserName(cancelledBy) },
    });
  }
  timeline.push(assignment.actualCompletionDateTime, "İş tamamlandı");
  for (const review of assignment.reviews ?? []) {
    timeline.push(review.createdAt, "Değerlendirme yazıldı", {
      detail: review.rating === null ? null : `${formatInteger(review.rating)}/5`,
    });
  }
  for (const payment of payments) {
    timeline.push(payment.createdAt, "Ödeme denemesi başlatıldı", {
      detail: PAYMENT_ATTEMPT_STATUS_LABELS[payment.status],
    });
    timeline.push(payment.completedAt, "Ödeme denemesi tamamlandı", {
      detail: shortId(payment.id),
    });
  }
  if (assignment.payout !== null) {
    timeline.push(assignment.payout.createdAt, "Hakediş oluşturuldu", {
      detail: assignment.payout.status,
    });
  }
  for (const dispute of assignment.disputes) {
    timeline.push(dispute.createdAt, "Uyuşmazlık açıldı", { detail: dispute.status });
  }
  for (const report of assignment.reports) {
    timeline.push(report.createdAt, "Şikayet açıldı", { detail: report.status });
  }

  return timeline.build();
}

function flagSummary(flags: readonly string[]): string | null {
  if (flags.length === 0) return null;
  return flags.map(timesheetFlagLabel).join(", ");
}
