import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { EscrowOperationForm } from "@/components/escrow/escrow-operation-form";
import { CompanyLink } from "@/components/panel/company-link";
import { ObjectTimeline } from "@/components/panel/object-timeline";
import { ProfilePicture } from "@/components/panel/profile-picture";
import {
  Badge,
  EmptyState,
  ErrorState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import {
  EMPTY_VALUE,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type { GatedLocation } from "@/lib/location-gate";
import {
  disputeHref,
  jobHref,
  paymentHref,
  payoutHref,
  reportHref,
  userHrefOrNull,
} from "@/lib/panel-href";
import {
  applicationStatusLabel,
  assignmentEmployerTypeLabel,
  cancellationPartyLabel,
  timesheetFlagLabel,
  type AdminApplication,
  type AdminCancellation,
  type AdminReview,
  type AssignmentDetail as AssignmentRecord,
  type LinkedRecord,
} from "@/server/api/escrow";
import {
  PAYMENT_ATTEMPT_STATUS_LABELS,
  paymentCurrency,
  type AdminPayment,
  type PaymentAttemptStatus,
} from "@/server/api/payments";
import { safeUserName, type SafeUser } from "@/server/api/users";
import type { Permission } from "@/server/authz/permissions";
import { submitEscrowOperation } from "@/server/escrow/actions";
import { escrowMovement, refundAvailability, releaseAvailability } from "@/server/escrow/figures";

import { ASSIGNMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "./labels";
import { assignmentTimelineEvents } from "./timeline";
import { gateWorkSessions, type GatedWorkSession } from "./work-sessions";

/**
 * Atama nesne sayfasının gövdesi (koala-admin#95).
 *
 * Sunucu bileşeni. Sayfa iki okumayı yapar — `AdminAssignmentDetailDto`
 * ve atamanın ödeme denemeleri — ve sonucu buraya verir. Denemeler ayrı
 * yüklendiği için ayrı düşebilir: tablo yerine hata kutusu çizilir, sayfanın
 * kalanı durur. Tek ağ isteği zaman çizelgesinindir: `ObjectTimeline`
 * (koala-admin#107) `audit.read` varken bu atamanın denetim satırlarını
 * kendi ister; DTO olayları `./timeline`'da türetilir.
 *
 * Bağlantılar izne bakar. `LinkedRecordDto` yalnız kimlik taşır; kimliği
 * göstermek serbest, ama `dispute.resolve` olmayan birine uyuşmazlık sayfasına
 * bağlantı vermek onu 403 ekranına göndermek olur. O yüzden kimlik metin,
 * bağlantı yalnız izin varken.
 */

export const PAYMENT_ATTEMPT_TONES: Record<
  PaymentAttemptStatus,
  "neutral" | "warning" | "success" | "danger"
> = {
  INITIATED: "neutral",
  VERIFY_PENDING: "warning",
  IN_REVIEW: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
};

export interface LoadFailure {
  readonly message: string;
  readonly errorCode: string;
  readonly requestId: string | null;
}

export type PaymentsResult =
  { ok: true; payments: readonly AdminPayment[] } | { ok: false; failure: LoadFailure };

interface DetailProps {
  assignment: AssignmentRecord;
  payments: PaymentsResult;
  permissions: readonly Permission[];
}

export function AssignmentDetail({ assignment, payments, permissions }: DetailProps) {
  const held = new Set(permissions);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2" aria-labelledby="assignment-summary-heading">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="assignment-summary-heading" className="text-sm font-semibold">
            Özet
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Atama"
              value={<span className="font-mono text-xs break-all">{assignment.id}</span>}
            />
            <Row
              label="İlan"
              value={
                held.has("job.read") ? (
                  <Link href={jobHref(assignment.jobId)} className="text-brand hover:underline">
                    {assignment.jobTitle ?? assignment.jobId}
                  </Link>
                ) : (
                  (assignment.jobTitle ?? assignment.jobId)
                )
              }
            />
            <Row label="İşçi" value={<Party user={assignment.worker} />} />
            <Row
              label="İşveren"
              value={
                assignment.companyName === null ? (
                  <Party user={assignment.employer} />
                ) : (
                  <span>
                    <Party user={assignment.employer} /> ·{" "}
                    <CompanyLink
                      companyId={assignment.companyId}
                      companyName={assignment.companyName}
                      canOpen={held.has("company.approve")}
                    />
                  </span>
                )
              }
            />
            <Row label="Atama durumu" value={ASSIGNMENT_STATUS_LABELS[assignment.status]} />
            <Row
              label="Ödeme durumu"
              value={
                <Badge tone={PAYMENT_STATUS_TONES[assignment.paymentStatus]}>
                  {PAYMENT_STATUS_LABELS[assignment.paymentStatus]}
                </Badge>
              }
            />
            <Row label="Çalışma süresi" value={`${formatInteger(assignment.workHours)} sa`} />
            <Row
              label="İşveren türü"
              value={
                assignment.employerType === null
                  ? EMPTY_VALUE
                  : assignmentEmployerTypeLabel(assignment.employerType)
              }
            />
            <Row
              label="Beklenen tamamlanma"
              value={formatDateTime(assignment.expectedCompletionDateTime)}
            />
            <Row label="Oluşturulma" value={formatDateTime(assignment.createdAt)} />
            <Row label="Güncelleme" value={formatDateTime(assignment.updatedAt)} />
            {assignment.notes === null ? null : (
              <Row
                label="Not"
                value={<span className="whitespace-pre-wrap">{assignment.notes}</span>}
              />
            )}
          </dl>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-semibold">Fiyat dökümü</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="İşçiye ödenecek"
              value={formatCurrency(assignment.pricing.workerPayout, assignment.pricing.currency)}
            />
            <Row
              label="Komisyon"
              value={`${formatCurrency(
                assignment.pricing.serviceFeeAmount,
                assignment.pricing.currency,
              )} (${formatPercent(Number(assignment.pricing.serviceFeeRate))})`}
            />
            <Row
              label="İşverenden tahsil edilen"
              value={formatCurrency(assignment.pricing.employerTotal, assignment.pricing.currency)}
            />
            <Row label="Fiyat sürümü" value={assignment.pricing.pricingVersion} />
          </dl>
        </div>
      </section>

      <ObjectTimeline
        resourceId={assignment.id}
        subject="Bu atama"
        events={assignmentTimelineEvents(assignment, payments.ok ? payments.payments : [])}
      >
        Kaydın kendi anları DTO&apos;dan; serbest bırakma ve iade gibi personel kararları denetim
        izinden, bu atama kimliğiyle.
      </ObjectTimeline>

      {assignment.application === null && assignment.cancellation === null ? null : (
        <section className="grid gap-4 md:grid-cols-2">
          {assignment.application === null ? null : (
            <ApplicationCard application={assignment.application} />
          )}
          {assignment.cancellation === null ? null : (
            <CancellationCard
              cancellation={assignment.cancellation}
              currency={assignment.pricing.currency}
            />
          )}
        </section>
      )}

      {assignment.workSessions === null ? null : (
        <WorkSessions
          sessions={gateWorkSessions(assignment.workSessions, held.has("user.read_pii"))}
        />
      )}

      <PaymentsTable payments={payments} />

      <section className="grid gap-4 md:grid-cols-2">
        <PayoutCard payout={assignment.payout} canOpen={held.has("payout.reconcile")} />
        <LinkedRecords
          disputes={assignment.disputes}
          reports={assignment.reports}
          canOpenDisputes={held.has("dispute.resolve")}
          canOpenReports={held.has("content.moderate")}
        />
      </section>

      {assignment.reviews === null ? null : (
        <Reviews reviews={assignment.reviews} assignment={assignment} />
      )}

      <EscrowActions assignment={assignment} permissions={held} />
    </div>
  );
}

function Party({ user }: { user: SafeUser }) {
  const href = userHrefOrNull(user.id);
  const name = safeUserName(user);
  return (
    <span className="inline-flex items-center gap-2">
      {user.profilePictureUrl === null ? null : (
        <ProfilePicture url={user.profilePictureUrl} name={name} size="sm" />
      )}
      {href === null ? (
        <span>{name}</span>
      ) : (
        <Link href={href} className="text-brand hover:underline">
          {name}
        </Link>
      )}
    </span>
  );
}

function PaymentsTable({ payments }: { payments: PaymentsResult }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="assignment-payments-heading">
      <div className="flex flex-col gap-1">
        <h2 id="assignment-payments-heading" className="text-lg font-semibold">
          Ödeme denemeleri
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          <code className="font-mono">GET /admin/job-assignments/{"{id}"}/payments</code>. Kart
          verisi ve ödeme token&apos;ı yoktur; sağlayıcı referansları iyzico kayıtlarıyla
          eşleştirmek içindir.
        </p>
      </div>

      {!payments.ok ? (
        <ErrorState
          title="Ödeme denemeleri yüklenemedi."
          description={payments.failure.message}
          errorCode={payments.failure.errorCode}
          requestId={payments.failure.requestId}
        />
      ) : payments.payments.length === 0 ? (
        <EmptyState
          title="Bu atama için ödeme denemesi yok."
          description="Tahsilat henüz başlatılmamış olabilir; emanet durumu yukarıdaki özettedir."
        />
      ) : (
        <Table caption="Ödeme denemeleri">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Zaman</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Tahsil edilen</TableHeaderCell>
              <TableHeaderCell>İşçi payı</TableHeaderCell>
              <TableHeaderCell>Komisyon</TableHeaderCell>
              <TableHeaderCell>Sağlayıcı referansı</TableHeaderCell>
              <TableHeaderCell>Tamamlanma</TableHeaderCell>
              <TableHeaderCell>Detay</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.payments.map((payment) => {
              const currency = paymentCurrency(payment);
              return (
                <TableRow key={payment.id}>
                  <TableCell>{formatDateTime(payment.createdAt)}</TableCell>
                  <TableCell>
                    <Badge tone={PAYMENT_ATTEMPT_TONES[payment.status]}>
                      {PAYMENT_ATTEMPT_STATUS_LABELS[payment.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(payment.totalCharged, currency)}</TableCell>
                  <TableCell>{formatCurrency(payment.workerPayout, currency)}</TableCell>
                  <TableCell>
                    {formatCurrency(payment.commissionAmount, currency)}
                    {payment.commissionRate === null
                      ? null
                      : ` (${formatPercent(Number(payment.commissionRate))})`}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs break-all">
                      {payment.providerPaymentId ??
                        payment.providerTransactionId ??
                        payment.conversationId ??
                        EMPTY_VALUE}
                    </span>
                  </TableCell>
                  <TableCell>{formatDateTime(payment.completedAt)}</TableCell>
                  <TableCell>
                    <Link
                      href={paymentHref(payment.id, payment.jobAssignmentId)}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      Aç
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ApplicationCard({ application }: { application: AdminApplication }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="assignment-application-heading"
      data-testid="assignment-application"
    >
      <h2 id="assignment-application-heading" className="text-sm font-semibold">
        Başvuru
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        <Row
          label="Başvuru"
          value={<span className="font-mono text-xs break-all">{application.id}</span>}
        />
        <Row
          label="Durum"
          value={
            application.status === null ? EMPTY_VALUE : applicationStatusLabel(application.status)
          }
        />
        <Row label="Başvuru zamanı" value={formatDateTime(application.applicationDateTime)} />
        <Row label="Yanıt zamanı" value={formatDateTime(application.answeredDateTime)} />
        {application.rejectionReason === null ? null : (
          <Row
            label="Ret gerekçesi"
            value={<span className="whitespace-pre-wrap">{application.rejectionReason}</span>}
          />
        )}
      </dl>
    </section>
  );
}

/**
 * İptal kartı. `refundId` iade kaydının kimliğidir, ödeme denemesinin değil;
 * iade satırı ödeme sayfasındaki tabloda durur, bu yüzden bağlantı yok,
 * kimlik mono. Ücret ve iade tutarları backend metni, para birimi atamanın
 * fiyat dökümünden.
 */
function CancellationCard({
  cancellation,
  currency,
}: {
  cancellation: AdminCancellation;
  currency: string;
}) {
  const who = cancellation.cancelledBy;
  const whoHref = userHrefOrNull(who?.id);
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-surface p-4"
      aria-labelledby="assignment-cancellation-heading"
      data-testid="assignment-cancellation"
    >
      <h2 id="assignment-cancellation-heading" className="text-sm font-semibold">
        İptal
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        <Row
          label="İptal eden taraf"
          value={
            cancellation.cancelledByParty === null
              ? EMPTY_VALUE
              : cancellationPartyLabel(cancellation.cancelledByParty)
          }
        />
        <Row
          label="İptal eden"
          value={
            who === null ? (
              EMPTY_VALUE
            ) : whoHref === null ? (
              safeUserName(who)
            ) : (
              <Link href={whoHref} className="text-brand hover:underline">
                {safeUserName(who)}
              </Link>
            )
          }
        />
        <Row label="İptal zamanı" value={formatDateTime(cancellation.cancelledAt)} />
        <Row
          label="Bildirim süresi"
          value={
            cancellation.noticeMinutes === null
              ? EMPTY_VALUE
              : `${formatInteger(cancellation.noticeMinutes)} dk`
          }
        />
        <Row
          label="Ceza"
          value={
            cancellation.feeAmount === null && cancellation.feeRate === null
              ? EMPTY_VALUE
              : `${cancellation.feeAmount === null ? EMPTY_VALUE : formatCurrency(cancellation.feeAmount, currency)}${
                  cancellation.feeRate === null
                    ? ""
                    : ` (${formatPercent(Number(cancellation.feeRate))})`
                }`
          }
        />
        <Row
          label="İade tutarı"
          value={
            cancellation.refundAmount === null
              ? EMPTY_VALUE
              : formatCurrency(cancellation.refundAmount, currency)
          }
        />
        <Row
          label="İade kaydı"
          value={
            cancellation.refundId === null ? (
              EMPTY_VALUE
            ) : (
              <span className="font-mono text-xs break-all">{cancellation.refundId}</span>
            )
          }
        />
        {cancellation.reason === null ? null : (
          <Row
            label="Gerekçe"
            value={<span className="whitespace-pre-wrap">{cancellation.reason}</span>}
          />
        )}
      </dl>
    </section>
  );
}

/**
 * Mesai oturumları. Plausibility bayrakları backend'in kararıdır
 * (`TimesheetPlausibilityFlag`); panel bayrak üretmez, yalnız yazar.
 * Konum yalnız sayı olarak, harita yok; ve yalnız `user.read_pii` varken
 * (koala-admin#135): oturumlar buraya `gateWorkSessions`'tan geçmiş gelir,
 * izinsiz okuyucuda koordinat veride hiç yoktur.
 */
function WorkSessions({ sessions }: { sessions: readonly GatedWorkSession[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="assignment-sessions-heading">
      <div className="flex flex-col gap-1">
        <h2 id="assignment-sessions-heading" className="text-lg font-semibold">
          Mesai
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Giriş ve çıkış anları ile backend&apos;in plausibility bayrakları. Bayrak, kaydın yanlış
          olduğunu değil, incelenmeye değer olduğunu söyler.
        </p>
      </div>
      {sessions.length === 0 ? (
        <EmptyState
          title="Bu atama için mesai kaydı yok."
          description="İşçi henüz giriş yapmamış olabilir; çizelge yalnız kaydedilen anları gösterir."
        />
      ) : (
        <Table caption="Mesai oturumları">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Giriş</TableHeaderCell>
              <TableHeaderCell>Giriş bayrakları</TableHeaderCell>
              <TableHeaderCell>Çıkış</TableHeaderCell>
              <TableHeaderCell>Çıkış bayrakları</TableHeaderCell>
              <TableHeaderCell>Süre</TableHeaderCell>
              <TableHeaderCell>Konum</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>{formatDateTime(session.checkInAt)}</TableCell>
                <TableCell>
                  <Flags flags={session.checkInPlausibilityFlags} />
                </TableCell>
                <TableCell>{formatDateTime(session.checkOutAt)}</TableCell>
                <TableCell>
                  <Flags flags={session.checkOutPlausibilityFlags} />
                </TableCell>
                <TableCell>
                  {session.minutes === null ? EMPTY_VALUE : `${formatInteger(session.minutes)} dk`}
                </TableCell>
                <TableCell>
                  <SessionLocation
                    checkIn={session.checkInLocation}
                    checkOut={session.checkOutLocation}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Flags({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return <span className="text-ink-muted">{EMPTY_VALUE}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} tone="warning">
          {timesheetFlagLabel(flag)}
        </Badge>
      ))}
    </span>
  );
}

/**
 * Giriş → çıkış konumu. Uçlardan biri `withheld` ise tek not yazılır: konumun
 * var olduğu söylenir, hangi ucun olduğu ya da değeri söylenmez. İkisi de
 * `none` ise "—"; "konum var" iddiası ancak gerçekten konum varken çıkar —
 * backend'in maskelediği `null` (koala-backend#352) `gateLocation`'da bayrağıyla
 * `withheld` olur, buraya "konum yok" diye gelmez.
 */
function SessionLocation({
  checkIn,
  checkOut,
}: {
  checkIn: GatedLocation;
  checkOut: GatedLocation;
}) {
  if (checkIn.kind === "withheld" || checkOut.kind === "withheld") {
    return (
      <span className="text-xs text-ink-muted" data-testid="work-session-location-withheld">
        Konum var; görmek için <code className="font-mono">user.read_pii</code> gerekir.
      </span>
    );
  }
  if (checkIn.kind === "none" && checkOut.kind === "none") {
    return (
      <span className="text-ink-muted" data-testid="work-session-location-none">
        {EMPTY_VALUE}
      </span>
    );
  }
  return (
    <span className="font-mono text-xs" data-testid="work-session-location">
      {coordinates(checkIn)}
      {" → "}
      {coordinates(checkOut)}
    </span>
  );
}

function coordinates(location: GatedLocation): string {
  return location.kind === "shown" ? `${location.latitude}, ${location.longitude}` : EMPTY_VALUE;
}

/**
 * Değerlendirmeler. DTO yalnız yazar ve konu kimliklerini taşır; ad, atamanın
 * iki tarafından eşlenir. Anonim yorumun yazarı da personel görünümünde
 * açıktır — anonimlik pazaryerine karşıdır, denetime karşı değil.
 */
function Reviews({
  reviews,
  assignment,
}: {
  reviews: readonly AdminReview[];
  assignment: AssignmentRecord;
}) {
  const party = (id: string | null): ReactNode => {
    if (id === null) return EMPTY_VALUE;
    const user =
      id === assignment.worker.id
        ? assignment.worker
        : id === assignment.employer.id
          ? assignment.employer
          : null;
    const href = userHrefOrNull(id);
    const label = user === null ? id : safeUserName(user);
    if (href === null)
      return <span className={user === null ? "font-mono text-xs" : ""}>{label}</span>;
    return (
      <Link
        href={href}
        className={`text-brand hover:underline ${user === null ? "font-mono text-xs" : ""}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="assignment-reviews-heading"
      data-testid="assignment-reviews"
    >
      <h2 id="assignment-reviews-heading" className="text-sm font-semibold">
        Değerlendirmeler
      </h2>
      {reviews.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu atama için değerlendirme yazılmamış.</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {party(review.authorId)}
                <span className="text-ink-muted">→</span>
                {party(review.subjectId)}
                <span className="font-medium">
                  {review.rating === null ? EMPTY_VALUE : `${formatInteger(review.rating)}/5`}
                </span>
                {review.anonymous ? <Badge>Anonim</Badge> : null}
                <span className="text-xs text-ink-muted">{formatDateTime(review.createdAt)}</span>
              </div>
              {review.comment === null ? null : (
                <p className="whitespace-pre-wrap text-ink">{review.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PayoutCard({ payout, canOpen }: { payout: LinkedRecord | null; canOpen: boolean }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="assignment-payout-heading"
    >
      <h2 id="assignment-payout-heading" className="text-sm font-semibold">
        Hakediş
      </h2>
      {payout === null ? (
        <p className="text-sm text-ink-muted">
          Bu atama için hakediş oluşmamış. Hakediş, emanetteki para işçiye çıkarılınca oluşur.
        </p>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          <Row
            label="Hakediş"
            value={
              canOpen ? (
                <Link
                  href={payoutHref(payout.id)}
                  className="font-mono text-xs text-brand hover:underline"
                >
                  {payout.id}
                </Link>
              ) : (
                <span className="font-mono text-xs">{payout.id}</span>
              )
            }
          />
          <Row label="Durum" value={payout.status ?? EMPTY_VALUE} />
          <Row label="Oluşturulma" value={formatDateTime(payout.createdAt)} />
        </dl>
      )}
      {payout !== null && !canOpen ? (
        <p className="text-xs text-ink-muted">
          Hakediş detayı <code className="font-mono">payout.reconcile</code> ister; bağlantı bu
          yüzden verilmedi.
        </p>
      ) : null}
    </section>
  );
}

function LinkedRecords({
  disputes,
  reports,
  canOpenDisputes,
  canOpenReports,
}: {
  disputes: readonly LinkedRecord[];
  reports: readonly LinkedRecord[];
  canOpenDisputes: boolean;
  canOpenReports: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="assignment-linked-heading"
    >
      <h2 id="assignment-linked-heading" className="text-sm font-semibold">
        Bağlı kayıtlar
      </h2>
      <RecordList
        title="Uyuşmazlıklar"
        records={disputes}
        empty="Bu atamaya bağlı uyuşmazlık yok."
        hrefFor={canOpenDisputes ? disputeHref : null}
        permission="dispute.resolve"
      />
      <RecordList
        title="Şikayetler"
        records={reports}
        empty="Bu atamaya bağlı şikayet yok."
        hrefFor={canOpenReports ? reportHref : null}
        permission="content.moderate"
      />
    </section>
  );
}

function RecordList({
  title,
  records,
  empty,
  hrefFor,
  permission,
}: {
  title: string;
  records: readonly LinkedRecord[];
  empty: string;
  hrefFor: ((id: string) => Route) | null;
  permission: Permission;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-ink-muted">{title}</h3>
      {records.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {records.map((record) => (
            <li key={record.id} className="flex flex-wrap items-baseline gap-x-2">
              {hrefFor === null ? (
                <span className="font-mono text-xs">{record.id}</span>
              ) : (
                <Link
                  href={hrefFor(record.id)}
                  className="font-mono text-xs text-brand hover:underline"
                >
                  {record.id}
                </Link>
              )}
              <span className="text-ink-muted">
                {record.status ?? EMPTY_VALUE} · {formatDateTime(record.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {records.length > 0 && hrefFor === null ? (
        <p className="text-xs text-ink-muted">
          Detay <code className="font-mono">{permission}</code> ister; bağlantı verilmedi.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Uyuşmazlık sayfasındaki iki para düğmesinin aynısı, uyuşmazlık kimliği
 * olmadan. Kapı `runEscrowOperation`: izin, tutar ve tekrar orada yeniden
 * çözülür; burada yalnız izni olmayanın düğmeyi görmemesi sağlanır.
 */
function EscrowActions({
  assignment,
  permissions,
}: {
  assignment: AssignmentRecord;
  permissions: ReadonlySet<Permission>;
}) {
  const canRelease = permissions.has("payout.release");
  const canRefund = permissions.has("payment.refund");
  const releaseMovement = escrowMovement(assignment, "WORKER");
  const refundMovement = escrowMovement(assignment, "EMPLOYER");
  const release = releaseAvailability(assignment);
  const refund = refundAvailability(assignment);
  const openDispute = assignment.disputes.some(
    (dispute) => dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW",
  );

  return (
    <section
      className="flex flex-col gap-6 rounded-lg border border-border-strong bg-surface p-4"
      aria-labelledby="assignment-escrow-heading"
    >
      <div className="flex flex-col gap-1">
        <h2 id="assignment-escrow-heading" className="text-sm font-semibold">
          Emanet işlemleri
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Tutar backend&apos;in fiyat dökümünden okunur; panel rakam yazmaz. Açık uyuşmazlık varken
          backend serbest bırakmayı reddeder — önce uyuşmazlık sayfasında karar verin.
        </p>
        {openDispute ? (
          <p
            className="max-w-prose rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink"
            data-testid="open-dispute-notice"
          >
            Bu atamada açık bir uyuşmazlık var; serbest bırakma isteği backend&apos;de 409 ile
            döner.
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Emanetten işçiye çıkar</h3>
          <p className="text-xs text-ink-muted">
            <code className="font-mono">POST /admin/job-assignments/{"{id}"}/release</code>
          </p>
          {canRelease ? (
            <EscrowOperationForm
              action={submitEscrowOperation}
              kind="RELEASE"
              assignmentId={assignment.id}
              disputeId={null}
              triggerLabel="Çıkışı gözden geçir"
              title="İşçiye çıkışı onayla"
              summary="Emanetteki tutar işçiye çıkacak."
              movement={releaseMovement}
              disabledReason={
                releaseMovement === null
                  ? "Bu atama için emanet tutarı okunamadı."
                  : release.allowed
                    ? null
                    : release.reason
              }
              notice="Gerekçe release isteğine aynen gönderilir ve kalıcı denetim kaydında saklanır."
            />
          ) : (
            <p className="text-xs text-ink-muted" data-testid="release-permission-missing">
              <code className="font-mono">payout.release</code> izniniz yok; bu işlem gösterilmiyor.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">İşverene iade et</h3>
          <p className="text-xs text-ink-muted">
            <code className="font-mono">POST /admin/job-assignments/{"{id}"}/refund</code>. Panel
            istekte tutar göndermez; backend tahsil ettiği tutarın tamamını iade eder.
          </p>
          {canRefund ? (
            <EscrowOperationForm
              action={submitEscrowOperation}
              kind="REFUND"
              assignmentId={assignment.id}
              disputeId={null}
              triggerLabel="İadeyi gözden geçir"
              title="İşverene iadeyi onayla"
              summary="Tahsil edilen tutarın tamamı işverene iade edilecek."
              movement={refundMovement}
              tone="danger"
              disabledReason={
                refundMovement === null
                  ? "Bu atama için emanet tutarı okunamadı."
                  : refund.allowed
                    ? null
                    : refund.reason
              }
            />
          ) : (
            <p className="text-xs text-ink-muted" data-testid="refund-permission-missing">
              <code className="font-mono">payment.refund</code> izniniz yok; bu işlem gösterilmiyor.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
