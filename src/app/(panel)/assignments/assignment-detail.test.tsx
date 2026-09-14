import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  DISPUTE_ID,
  JOB_ID,
  PAYMENT_ID,
  PAYOUT_ID,
  REPORT_ID,
  adminAssignmentDetailFixture,
  adminPaymentFixture,
  envelope,
} from "../../../../test/fixtures/admin-detail";
import { categoryCreatedEntry } from "../../../../test/fixtures/audit-log";
import { adminMeSuccessBody, resourceNotFoundBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";
import { detailValuesOf, watchAudit } from "../../../../test/support/watch-audit";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { default: AssignmentDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const DETAIL = apiUrl(`/admin/job-assignments/${ASSIGNMENT_ID}`);
const PAYMENTS = apiUrl(`/admin/job-assignments/${ASSIGNMENT_ID}/payments`);

const ANALYST = ["payment.read"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  backendSaysPasswordMustChange.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  backendSaysPasswordMustChange.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_ANALYST"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watch(
  detail: unknown = adminAssignmentDetailFixture(),
  payments: unknown[] = [adminPaymentFixture()],
) {
  const seen = { detail: 0, payments: 0, authorization: null as string | null };
  server.use(
    http.get(DETAIL, ({ request }) => {
      seen.detail += 1;
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, detail));
    }),
    http.get(PAYMENTS, () => {
      seen.payments += 1;
      return HttpResponse.json(
        envelope(`/admin/job-assignments/${ASSIGNMENT_ID}/payments`, payments),
      );
    }),
  );
  return seen;
}

const render = async (id: string = ASSIGNMENT_ID) =>
  (
    await renderServerComponent(<AssignmentDetailPage params={Promise.resolve({ id })} />)
  ).replaceAll("<!-- -->", "");

describe("who can open an assignment", () => {
  it("refuses a dispute.resolve holder and never asks the backend", async () => {
    stubMe(["dispute.resolve"], ["DISPUTE_HANDLER"]);
    const seen = watch();

    const html = await render();

    expect(seen.detail).toBe(0);
    expect(seen.payments).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Ödemeleri görüntüle");
    expect(html).not.toContain("Ayşe Yılmaz");
  });

  it("renders summary, pricing, timeline, payment attempts, payout and linked records", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const html = await render();

    expect(seen.detail).toBe(1);
    expect(seen.payments).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("Koala Kafe");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("Emanette");

    expect(html).toContain("Zaman çizelgesi");
    expect(html).toContain("Atama zamanı");
    expect(html).toContain("Uyuşmazlık açıldı");

    expect(html).toContain("Ödeme denemeleri");
    expect(html).toContain("iyz-pay-000071");
    expect(html).toContain(`href="/payments/${PAYMENT_ID}"`);

    expect(html).toContain(PAYOUT_ID);
    expect(html).toContain(DISPUTE_ID);
    expect(html).toContain(REPORT_ID);
  });

  it("does not render an email even if the payload carries one", async () => {
    stubMe(ANALYST);
    const detail = adminAssignmentDetailFixture();
    watch({
      ...detail,
      worker: { ...(detail.worker as object), email: "private-worker@koala.test" },
    });

    const html = await render();

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).not.toContain("private-worker@koala.test");
  });
});

/** koala-admin#99: tarafların profil fotoğrafı ve denetim izi bağlantısı. */
describe("party pictures and the audit pointer", () => {
  it("draws the worker's and employer's profile pictures when the DTO carries them", async () => {
    stubMe(ANALYST);
    const detail = adminAssignmentDetailFixture();
    watch({
      ...detail,
      worker: { ...detail.worker, profilePictureUrl: "https://storage.koala.test/users/w1.jpg" },
      employer: {
        ...detail.employer,
        profilePictureUrl: "https://storage.koala.test/users/e1.jpg",
      },
    });

    const html = await render();

    expect(html).toMatch(
      /<img src="https:\/\/storage\.koala\.test\/users\/w1\.jpg" alt="Ayşe Yılmaz profil fotoğrafı"/,
    );
    expect(html).toMatch(
      /<img src="https:\/\/storage\.koala\.test\/users\/e1\.jpg" alt="Mehmet Demir profil fotoğrafı"/,
    );
  });

  it("draws no picture element when the parties have none", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).not.toContain("profil fotoğrafı");
    expect(html).toContain("Ayşe Yılmaz");
  });

  it("points at the audit log filtered to this assignment, only for an audit.read holder", async () => {
    stubMe(ANALYST);
    watch();
    const alone = await render();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...ANALYST, "audit.read"]);
    watch();
    watchAudit();
    const html = await render();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${ASSIGNMENT_ID}"`);
  });

  it("refuses a non-http profile picture address without drawing an img", async () => {
    stubMe(ANALYST);
    const detail = adminAssignmentDetailFixture();
    watch({
      ...detail,
      worker: { ...detail.worker, profilePictureUrl: "javascript:alert(1)" },
      employer: { ...detail.employer, profilePictureUrl: "data:image/png;base64,AAAA" },
    });

    const html = await render();

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("data:image/png");
  });
});

describe("links follow the reader's permissions", () => {
  it("shows linked ids as text when the reader cannot open them", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).not.toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);
    expect(html).not.toContain(`href="/disputes/${DISPUTE_ID}"`);
    expect(html).not.toContain(`href="/reports/${REPORT_ID}"`);
    expect(html).not.toContain(`href="/jobs/${JOB_ID}"`);
    expect(html).toContain("payout.reconcile");
  });

  it("links payout, dispute, report and job when the permissions are held", async () => {
    stubMe(["payment.read", "payout.reconcile", "dispute.resolve", "content.moderate", "job.read"]);
    watch();

    const html = await render();

    expect(html).toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);
    expect(html).toContain(`href="/disputes/${DISPUTE_ID}"`);
    expect(html).toContain(`href="/reports/${REPORT_ID}"`);
    expect(html).toContain(`href="/jobs/${JOB_ID}"`);
  });
});

describe("escrow actions", () => {
  it("hides release and refund from payment.read alone", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).toContain("release-permission-missing");
    expect(html).toContain("refund-permission-missing");
    expect(html).not.toContain("Çıkışı gözden geçir");
    expect(html).not.toContain("İadeyi gözden geçir");
  });

  it("draws both forms for payout.release and payment.refund holders", async () => {
    stubMe(["payment.read", "payout.release", "payment.refund"]);
    watch();

    const html = await render();

    expect(html).toContain("Çıkışı gözden geçir");
    expect(html).toContain("İadeyi gözden geçir");
    expect(html).not.toContain("release-permission-missing");
  });

  it("warns when a dispute is still open", async () => {
    stubMe(["payment.read", "payout.release"]);
    watch(
      adminAssignmentDetailFixture({
        disputes: [{ id: DISPUTE_ID, status: "OPEN", createdAt: "2026-09-02T09:00:00Z" }],
      }),
    );

    const html = await render();

    expect(html).toContain("open-dispute-notice");
  });
});

describe("empty and failed sub-loads", () => {
  it("says there are no attempts and no payout when the lists are empty", async () => {
    stubMe(ANALYST);
    watch(
      adminAssignmentDetailFixture({ payments: [], payout: null, disputes: [], reports: [] }),
      [],
    );

    const html = await render();

    expect(html).toContain("Bu atama için ödeme denemesi yok.");
    expect(html).toContain("Bu atama için hakediş oluşmamış.");
    expect(html).toContain("Bu atamaya bağlı uyuşmazlık yok.");
  });

  it("keeps the page when only the payments call fails", async () => {
    stubMe(ANALYST);
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json(
          envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, adminAssignmentDetailFixture()),
        ),
      ),
      http.get(PAYMENTS, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Ödeme servisi yanıt vermedi.",
            httpStatus: "502 BAD_GATEWAY",
            errorCode: "UPSTREAM_FAILED",
            errorCategory: "UPSTREAM_FAILED",
            requestId: "rid-502",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}/payments`,
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 502 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Ödeme denemeleri yüklenemedi.");
    expect(html).toContain("rid-502");
  });

  it("renders a non-404 failure of the assignment itself in operator language", async () => {
    stubMe(ANALYST);
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("atama detayı");
    expect(html).toContain("rid-403");
  });
});

/** koala-admin#85: olmayan atama ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("an assignment that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(ANALYST);
    let calls = 0;
    server.use(
      http.get(DETAIL, () => {
        calls += 1;
        return HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "JOB_ASSIGNMENT_NOT_FOUND",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
          },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <AssignmentDetailPage params={Promise.resolve({ id: ASSIGNMENT_ID })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const thrown = await renderServerComponent(
      <AssignmentDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.detail).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

/**
 * koala-admin#100 / koala-backend#283: başvuru → mesai → iptal → değerlendirme
 * çizelgesi, `employerType`, notlar. #265 sunucusu bu alanları göndermez;
 * kartlar yalnız yoklukla eksilir, sayfa aynı kalır.
 */
describe("the extended timeline and its cards", () => {
  const APPLICATION_ID = "ap000000-0000-4000-8000-000000000001";
  const CANCELLATION_ID = "ca000000-0000-4000-8000-000000000001";
  const REFUND_ID = "8f000000-0000-4000-8000-000000000081";

  function extended(overrides: Record<string, unknown> = {}) {
    return adminAssignmentDetailFixture({
      employerType: "COMPANY",
      expectedCompletionDateTime: "2026-09-01T17:00:00Z",
      notes: "Servis 08:00'de başlar.",
      createdAt: "2026-08-30T09:00:00Z",
      updatedAt: "2026-09-03T09:00:00Z",
      application: {
        id: APPLICATION_ID,
        status: "ACCEPTED",
        applicationDateTime: "2026-08-29T12:00:00Z",
        answeredDateTime: "2026-08-30T09:00:00Z",
        rejectionReason: null,
      },
      workSessions: [
        {
          id: "ws000000-0000-4000-8000-000000000001",
          jobAssignmentId: ASSIGNMENT_ID,
          checkInAt: "2026-09-01T07:58:00Z",
          checkOutAt: "2026-09-01T16:02:00Z",
          checkInClientEventId: null,
          checkInCapturedAt: "2026-09-01T07:58:00Z",
          checkInReceivedAt: "2026-09-01T07:58:10Z",
          checkInPlausibilityFlags: [],
          checkOutClientEventId: null,
          checkOutCapturedAt: "2026-09-01T16:02:00Z",
          checkOutReceivedAt: "2026-09-01T16:02:05Z",
          checkOutPlausibilityFlags: ["OUTSIDE_JOB_WINDOW", "FUTURE_FLAG"],
          checkInLatitude: 40.98,
          checkInLongitude: 29.03,
          checkOutLatitude: 40.98,
          checkOutLongitude: 29.03,
          minutes: 484,
        },
      ],
      cancellation: {
        id: CANCELLATION_ID,
        cancelledByParty: "EMPLOYER",
        cancelledBy: { id: "e-1", firstName: "Mehmet", lastName: "Demir", username: "mehmet" },
        reason: "Mekân kapandı.",
        noticeMinutes: 90,
        feeRate: "0.2500",
        feeAmount: "344.58",
        refundAmount: "1033.75",
        refundId: REFUND_ID,
        cancelledAt: "2026-09-01T06:30:00Z",
      },
      reviews: [
        {
          id: "rv000000-0000-4000-8000-000000000001",
          authorId: "e-1",
          subjectId: "w-1",
          rating: 5,
          comment: "Dakik ve güler yüzlü.",
          anonymous: true,
          createdAt: "2026-09-02T12:00:00Z",
        },
      ],
      ...overrides,
    });
  }

  it("draws the application, work sessions with flags, cancellation and reviews", async () => {
    stubMe(ANALYST);
    watch(extended());

    const html = await render();

    expect(html).toContain('data-testid="assignment-application"');
    expect(html).toContain(APPLICATION_ID);
    expect(html).toContain("Kabul edildi");
    expect(html).toContain("29.08.2026 15:00");

    expect(html).toContain("Mesai oturumları");
    expect(html).toContain("01.09.2026 10:58");
    expect(html).toContain("İş penceresi dışında");
    // Panelin tanımadığı bayrak kodu olduğu gibi yazılır, satır düşmez.
    expect(html).toContain("FUTURE_FLAG");
    expect(html).toContain("484 dk");
    expect(html).toContain("40.98, 29.03");

    expect(html).toContain('data-testid="assignment-cancellation"');
    expect(html).toContain("Mekân kapandı.");
    expect(html).toContain("90 dk");
    expect(html).toContain("₺344,58");
    expect(html).toContain("%25");
    expect(html).toContain("₺1.033,75");
    expect(html).toContain(REFUND_ID);

    expect(html).toContain('data-testid="assignment-reviews"');
    expect(html).toContain("Dakik ve güler yüzlü.");
    expect(html).toContain("5/5");
    expect(html).toContain("Anonim");

    expect(html).toMatch(/İşveren türü<\/dt><dd[^>]*>Şirket</);
    expect(html).toContain("Servis 08:00&#x27;de başlar.");
    expect(html).toContain("Beklenen tamamlanma");
  });

  it("orders the timeline from application through cancellation and review", async () => {
    stubMe(ANALYST);
    watch(extended());

    const html = await render();

    const order = [
      "Başvuru yapıldı",
      "Başvuru yanıtlandı",
      "Atama oluşturuldu",
      "Atama zamanı",
      "Mesai girişi",
      "Mesai çıkışı",
      "Atama iptal edildi",
      "Değerlendirme yazıldı",
    ];
    const timeline = html.slice(html.indexOf("Zaman çizelgesi"));
    const positions = order.map((label) => timeline.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    // İptal 06:30, mesai girişi 07:58: çizelge etikete değil zamana göre sıralanır.
    expect(timeline.indexOf("Atama iptal edildi")).toBeLessThan(timeline.indexOf("Mesai girişi"));
    expect(timeline.indexOf("Başvuru yapıldı")).toBeLessThan(timeline.indexOf("Atama oluşturuldu"));
  });

  it("says when the server sent empty sessions and reviews, and hides the cards a #265 server never sent", async () => {
    stubMe(ANALYST);
    watch(extended({ workSessions: [], reviews: [], cancellation: null }));
    const empty = await render();
    expect(empty).toContain("Bu atama için mesai kaydı yok.");
    expect(empty).toContain("Bu atama için değerlendirme yazılmamış.");
    expect(empty).not.toContain('data-testid="assignment-cancellation"');

    stubMe(ANALYST);
    watch();
    const legacy = await render();
    expect(legacy).not.toContain('data-testid="assignment-application"');
    expect(legacy).not.toContain('data-testid="assignment-cancellation"');
    expect(legacy).not.toContain('data-testid="assignment-reviews"');
    expect(legacy).not.toContain("Mesai oturumları");
    expect(legacy).toMatch(/İşveren türü<\/dt><dd[^>]*>—</);
    expect(legacy).toContain("Atama zamanı");
    expect(legacy).not.toContain("Başvuru yapıldı");
  });
});

/**
 * koala-admin#107: atamanın çizelgesi artık `ObjectTimeline`. DTO olayları
 * aynı, üstüne `audit.read` varken bu atamanın denetim satırları zamana göre
 * araya girer; izin yoksa istek çıkmaz ve yalnız DTO olayları kalır.
 */
describe("the timeline's audit half", () => {
  const RELEASE_ROW = {
    ...categoryCreatedEntry,
    id: "aa000000-0000-4c00-8000-0000000000e1",
    occurredAt: "2026-09-04T09:30:00.000Z",
    permission: "payout.release",
    action: "job-assignments.release",
    resourceType: "job-assignments",
    resourceId: ASSIGNMENT_ID,
    sensitivity: "FINANCIAL" as const,
  };

  it("interleaves the staff decision with the record's own events by time", async () => {
    stubMe([...ANALYST, "audit.read"]);
    const detail = adminAssignmentDetailFixture({
      createdAt: "2026-09-01T09:00:00Z",
      actualCompletionDateTime: "2026-09-03T17:00:00Z",
    });
    watch(detail, []);
    const audit = watchAudit({
      rows: [
        RELEASE_ROW,
        {
          ...RELEASE_ROW,
          id: "aa000000-0000-4c00-8000-0000000000e2",
          occurredAt: "2026-09-02T08:00:00.000Z",
          action: "job-assignments.read",
          permission: "payment.read",
          allowed: false,
        },
      ],
      totalElements: 27,
    });

    const html = await render();

    expect(audit.urls).toHaveLength(1);
    expect(audit.urls[0]?.searchParams.get("resourceId")).toBe(ASSIGNMENT_ID);
    expect(audit.urls[0]?.searchParams.get("size")).toBe("10");

    const timeline = html.slice(html.indexOf('data-testid="object-timeline"'));
    const order = [
      "Atama oluşturuldu",
      "job-assignments.read",
      "İş tamamlandı",
      "job-assignments.release",
    ];
    const positions = order.map((label) => timeline.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(timeline).toContain("Katalog Editörü");
    expect(timeline).toContain("Reddedildi");
    expect(timeline).toContain('data-source="audit"');
    expect(timeline).toContain('data-source="record"');
    expect(timeline).toContain("Denetim izinden en yeni 2 satır; toplam 27 kayıt.");
    // Çizelge saniye değil dakika yazar (atama sayfasının eski biçimi).
    expect(timeline).toContain("01.09.2026 12:00");
    expect(timeline).not.toContain("01.09.2026 12:00:00");
    // Ayrıntı yarısı (gövde, IP, tarayıcı) çizelgeye inmez.
    for (const value of detailValuesOf(RELEASE_ROW)) expect(html).not.toContain(value);
    // Denetim sayfasına tek bağlantı: `ObjectAuditPointer`'ınki.
    expect(html.match(/href="\/audit-log\?resourceId=/g)).toHaveLength(1);
  });

  it("draws only the record's events and says why, sending no audit request without audit.read", async () => {
    stubMe(ANALYST);
    watch();
    const audit = watchAudit({ rows: [RELEASE_ROW] });

    const html = await render();

    expect(audit.urls).toHaveLength(0);
    expect(html).toContain("Atama zamanı");
    expect(html).not.toContain("job-assignments.release");
    expect(html).toContain('data-testid="object-timeline-audit-disabled"');
    expect(html).not.toContain("/audit-log?");
  });
});
