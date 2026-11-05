import {
  boardingFlagInfo,
  boardingKindLabel,
  boardingRecorderRoleLabel,
  boardingSourceLabel,
  type BoardingEvidence,
} from "@/lib/boarding";
import { formatInteger } from "@/lib/format";
import { gateLocation } from "@/lib/location-gate";
import { TimelineBuilder, type TimelineActor, type TimelineEvent } from "@/lib/object-timeline";
import { shortId } from "@/lib/short-id";
import {
  applicationStatusLabel,
  cancellationPartyLabel,
  timesheetFlagLabel,
  type AssignmentDetail,
} from "@/server/api/escrow";
import { PAYMENT_ATTEMPT_STATUS_LABELS, type AdminPayment } from "@/server/api/payments";
import {
  TRANSPORT_DIRECTION_LABELS,
  TRANSPORT_DIRECTIONS,
  type AdminTimelineEvent,
  type AssignmentTransport,
} from "@/server/api/transport";
import { safeUserName } from "@/server/api/users";

/**
 * Atamanın DTO olayları: başvuru → kabul → atama → ödeme → mesai
 * (giriş/çıkış) → iptal ya da tamamlanma → değerlendirme → hakediş
 * (koala-admin#100), koala-admin#107 ile `ObjectTimeline`'a taşındı; sıralama
 * ve personel kararları artık orada. Eski sunucu başvuru, mesai, iptal ve
 * değerlendirmeyi göndermez; o satırlar yalnız yoklukla eksilir. Koltuk
 * seçimleri (koala-admin#120) `transport.seats[].createdAt` ile eklenir.
 *
 * Servis biniş olayları (koala-admin#133) `timeline[]`'dan gelir, yalnız
 * `BOARDING` türü. `SEAT` türü bilerek okunmaz: aynı koltuk `transport.seats[]`'te
 * yön bilgisiyle zaten var ve ikisini birlikte çizmek her koltuğu iki kez
 * yazardı. Canlı sunucu `timeline` göndermez; o zaman biniş satırı çıkmaz,
 * koltuklar yine çizilir.
 *
 * `canReadLocation` (`user.read_pii`) false iken koordinat bu işlevden dışarı
 * çıkmaz: bileşen hiç görmediğini sızdıramaz. Varsayılan kapalı; açmak çağıranın
 * bilinçli işi. Backend bu uçta konumu izne göre maskelemiyor (yalnız
 * `payment.read` ister), bu yüzden süzme panelin kendi sunucu yarısıdır.
 */
export function assignmentTimelineEvents(
  assignment: AssignmentDetail,
  payments: readonly AdminPayment[],
  options: { readonly canReadLocation?: boolean } = {},
): readonly TimelineEvent[] {
  const canReadLocation = options.canReadLocation ?? false;
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
  for (const seat of assignment.transport?.seats ?? []) {
    timeline.push(seat.createdAt, "Koltuk seçildi", {
      detail: seatDetail(assignment.transport, seat.shuttleId, seat.direction),
    });
  }
  for (const event of assignment.timeline ?? []) {
    if (event.type !== "BOARDING") continue;
    timeline.push(event.at, boardingKindLabel(event.kind), {
      detail: boardingDetail(assignment.transport, event),
      actor: boardingActor(assignment, event),
      boarding: boardingEvidence(assignment.transport, event, canReadLocation),
    });
  }
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

function seatDetail(
  transport: AssignmentTransport | null | undefined,
  shuttleId: string | null,
  direction: AssignmentTransport["seats"][number]["direction"],
): string | null {
  const parts: string[] = [];
  if (direction !== null) parts.push(TRANSPORT_DIRECTION_LABELS[direction]);
  const shuttle =
    shuttleId === null
      ? undefined
      : transport?.shuttles.find((candidate) => candidate.id === shuttleId);
  if (shuttle?.name) parts.push(shuttle.name);
  if (shuttle?.plate) parts.push(shuttle.plate);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Koltuk yönü ve servis, olayın taşıdığı kimliklerden. */
function boardingDetail(
  transport: AssignmentTransport | null | undefined,
  event: AdminTimelineEvent,
): string | null {
  const parts = [
    seatDetail(transport, event.shuttleId, directionOf(transport, event)),
    event.stopLabel,
  ];
  const present = parts.filter((part): part is string => part !== null && part.length > 0);
  return present.length === 0 ? null : present.join(" · ");
}

/**
 * Biniş olayının yönü. Önce olayın kendi `direction`ı (koala-backend#352);
 * yoksa (eski sunucu) ya da tanınmıyorsa koltuk satırı; plan yeniden
 * yazımında yalnız bir durak düşünce koltuk soft-delete olup
 * `transport.seats[]`'ten çıkar ama servis planda kalır ve yönü sabittir, o
 * yüzden servisten okunur. #352 öncesi sunucuda yön ancak servis de plandan
 * çıkmışsa bilinmez (olay satırı yine çizilir).
 */
function directionOf(
  transport: AssignmentTransport | null | undefined,
  event: AdminTimelineEvent,
): AssignmentTransport["seats"][number]["direction"] {
  const own = TRANSPORT_DIRECTIONS.find((candidate) => candidate === event.direction);
  if (own !== undefined) return own;
  const seat =
    event.seatAssignmentId === null
      ? undefined
      : transport?.seats.find((candidate) => candidate.id === event.seatAssignmentId);
  if (seat?.direction !== undefined && seat.direction !== null) return seat.direction;
  const shuttle =
    event.shuttleId === null
      ? undefined
      : transport?.shuttles.find((candidate) => candidate.id === event.shuttleId);
  return shuttle?.direction ?? null;
}

/**
 * Backend `OFF_SCHEDULE` ve `FAR_FROM_STOP`u yalnız gidişteki `BOARDED` için
 * üretir; dönüşte durak bırakma noktasıdır, gelmedi kaydında okutma yoktur.
 * Uzaklık o satırlarda da yazılır ve büyük bir sayı bayraksız kalır; not,
 * bunun şüphe değil kural olduğunu söyler.
 */
function distanceNote(
  direction: AssignmentTransport["seats"][number]["direction"],
  kind: string | null,
): string | null {
  if (kind === "NO_SHOW") return "Gelmedi kaydında uzaklık bayrak üretmez.";
  if (direction === "RETURN") return "Dönüşte durak bırakma noktasıdır; uzaklık bayrak üretmez.";
  return null;
}

/**
 * Kaydeden: atamanın iki tarafından biriyse adıyla, değilse (şirket yetkilisi)
 * rol ve kısa kimlikle. Kimlik yoksa fail bilinmez; rol yine kanıt bloğunda.
 */
function boardingActor(
  assignment: AssignmentDetail,
  event: AdminTimelineEvent,
): TimelineActor | null {
  const id = event.recordedById;
  if (id === null) return null;
  if (id === assignment.worker.id) {
    return { kind: "user", userId: id, name: safeUserName(assignment.worker) };
  }
  if (id === assignment.employer.id) {
    return { kind: "user", userId: id, name: safeUserName(assignment.employer) };
  }
  const role =
    event.recorderRole === null ? "Kaydeden" : boardingRecorderRoleLabel(event.recorderRole);
  return { kind: "user", userId: id, name: `${role} · ${shortId(id)}` };
}

function boardingEvidence(
  transport: AssignmentTransport | null | undefined,
  event: AdminTimelineEvent,
  canReadLocation: boolean,
): BoardingEvidence {
  return {
    sourceLabel: event.source === null ? null : boardingSourceLabel(event.source),
    recorderLabel:
      event.recorderRole === null ? null : boardingRecorderRoleLabel(event.recorderRole),
    stopLabel: event.stopLabel,
    plannedAt: event.stopScheduledAt,
    capturedAt: event.capturedAt,
    receivedAt: event.receivedAt,
    distanceMeters: event.distanceToStopMeters,
    distanceNote: distanceNote(directionOf(transport, event), event.kind),
    flags: event.flags.map(boardingFlagInfo),
    // Koordinat yalnız izinli okuyucuda kopyalanır; kural `gateLocation`da
    // (mesai oturumlarıyla ortak, koala-admin#135). `locationWithheld`
    // koala-backend#352'nin maskelediği `null`u "konum yok"tan ayırır.
    location: gateLocation(
      event.latitude,
      event.longitude,
      canReadLocation,
      event.locationWithheld,
    ),
  };
}
