import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminMeSuccessBody,
  resourceNotFoundBody,
  searchQueryTooLongBody,
} from "../../../test/fixtures/envelopes";
import { adminAssignmentFixture } from "../../../test/fixtures/admin-assignment";
import { categoryCreatedEntry } from "../../../test/fixtures/audit-log";
import { stubStaffMember } from "../../../test/support/stub-staff-member";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";
import { detailValuesOf, watchAudit } from "../../../test/support/watch-audit";

/**
 * koala-admin#6's acceptance criteria, rendered.
 *
 * Same shape as `gate.test.tsx`, and for the same reason: the claim "staff
 * without the permission never see these screens" is a claim about *requests*,
 * not about markup. `disputes.calls === 0` is the assertion; the absent table
 * is a consequence.
 *
 * The money assertions here are about what a person is shown before they can
 * commit — the server's figure, the named party, and the refusal to arm either
 * button when the figure cannot be read. What happens on submit is pinned in
 * `src/server/escrow/operations.test.ts`, against request counts.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  /**
   * Bu dosyadaki her 403 gerçekten "personel kaydı çözülemedi" demek, ve
   * `staff-context.ts` bunu backend'e sorarak doğruluyor. Sabit `false`,
   * o sorunun burada verilen cevabı.
   */
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { default: DisputesPage } = await import("@/app/(panel)/disputes/page");
const { default: DisputeDetailPage } = await import("@/app/(panel)/disputes/[id]/page");
const { clearRecentOperations } = await import("@/server/escrow/recent-operations");

const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";
const DISPUTE = "d1000000-0000-4c00-8000-000000000001";

const ADMIN_ME = apiUrl("/admin/me");
const DISPUTES = apiUrl("/admin/disputes");
const SUMMARY = apiUrl(`/admin/job-assignments/${ASSIGNMENT}`);
const EVIDENCE = apiUrl(`/admin/disputes/${DISPUTE}/evidence`);
const EVIDENCE_ID = "e1000000-0000-4c00-8000-000000000001";
const STAFF_ID = "b7f4a2c1-0000-4c00-8000-000000000009";

const OWNER_REVIEW_PERMISSIONS = [
  "dispute.resolve",
  "payment.read",
  "payout.release",
  "payment.refund",
];
const DISPUTE_HANDLER_PERMISSIONS = ["dispute.resolve"];
const CATALOG_EDITOR = ["category.manage"];

const DISPUTE_ROW = {
  id: DISPUTE,
  jobAssignmentId: ASSIGNMENT,
  openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  status: "OPEN",
  reason: "İşveren işi eksik yaptığımı söylüyor, oysa vardiyayı tamamladım.",
  resolution: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: "2026-09-05T08:00:00.000000000Z",
};

const SUMMARY_BODY = adminAssignmentFixture({ id: ASSIGNMENT });

function stubMe(permissions: readonly string[], roles: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

/** Counts every call to the queue endpoint, whatever the gate decided. */
function watchDisputes(respond: () => Response = queuePage) {
  let calls = 0;
  let url: URL | null = null;
  server.use(
    http.get(DISPUTES, ({ request }) => {
      calls += 1;
      url = new URL(request.url);
      return respond();
    }),
  );
  return {
    get calls() {
      return calls;
    },
    get url() {
      return url;
    },
  };
}

function watchSummary(respond: () => Response = summaryOk) {
  let calls = 0;
  server.use(
    http.get(SUMMARY, () => {
      calls += 1;
      return respond();
    }),
  );
  return {
    get calls() {
      return calls;
    },
  };
}

const queuePage = () =>
  HttpResponse.json({
    success: true,
    message: "Uyuşmazlıklar listelendi.",
    httpStatus: "200 OK",
    path: "/admin/disputes",
    requestId: "rid-queue",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: {
      content: [DISPUTE_ROW],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
      first: true,
      last: true,
    },
  });

const emptyQueue = () =>
  HttpResponse.json({
    success: true,
    message: "Uyuşmazlıklar listelendi.",
    httpStatus: "200 OK",
    path: "/admin/disputes",
    requestId: "rid-queue",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: {
      content: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
    },
  });

const summaryOk = () =>
  HttpResponse.json({
    success: true,
    message: "Atama getirildi.",
    httpStatus: "200 OK",
    path: `/admin/job-assignments/${ASSIGNMENT}`,
    requestId: "rid-summary",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: SUMMARY_BODY,
  });

const evidenceOk = () =>
  HttpResponse.json({
    success: true,
    message: "Kanıtlar listelendi.",
    httpStatus: "200 OK",
    path: `/admin/disputes/${DISPUTE}/evidence`,
    requestId: "rid-evidence",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: [
      {
        id: EVIDENCE_ID,
        disputeId: DISPUTE,
        uploadedBy: {
          id: "w-1",
          firstName: "Ayşe",
          lastName: "Yılmaz",
          username: "ayse",
          profilePictureUrl: null,
        },
        uploaderSide: "WORKER",
        fileName: "vardiya kanıtı.png",
        contentType: "image/png",
        fileSize: 1536,
        checksumSha256: "a".repeat(64),
        createdAt: "2026-09-05T08:15:00.000000000Z",
      },
    ],
  });

const emptyEvidence = () =>
  HttpResponse.json({
    success: true,
    message: "Kanıtlar listelendi.",
    httpStatus: "200 OK",
    path: `/admin/disputes/${DISPUTE}/evidence`,
    requestId: "rid-evidence-empty",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: [],
  });

const evidenceFailed = () =>
  HttpResponse.json(
    {
      success: false,
      message: "Kanıt deposuna ulaşılamadı.",
      httpStatus: "503 SERVICE_UNAVAILABLE",
      errorCode: "EVIDENCE_STORAGE_UNAVAILABLE",
      errorCategory: "UPSTREAM_FAILED",
      requestId: "rid-evidence-failed",
      path: `/admin/disputes/${DISPUTE}/evidence`,
      timeStamp: "2026-09-06T09:00:00.000000000Z",
    },
    { status: 503 },
  );

function watchEvidence(respond: () => Response = evidenceOk) {
  let calls = 0;
  server.use(
    http.get(EVIDENCE, () => {
      calls += 1;
      return respond();
    }),
  );
  return {
    get calls() {
      return calls;
    },
  };
}

const disputeOk = () =>
  HttpResponse.json({
    success: true,
    message: "Uyuşmazlık getirildi.",
    httpStatus: "200 OK",
    path: `/admin/disputes/${DISPUTE}`,
    requestId: "rid-dispute",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: DISPUTE_ROW,
  });

function watchDispute(respond: () => Response = disputeOk) {
  let calls = 0;
  server.use(
    http.get(`${DISPUTES}/${DISPUTE}`, () => {
      calls += 1;
      return respond();
    }),
  );
  return {
    get calls() {
      return calls;
    },
  };
}

const renderDetail = () =>
  renderServerComponent(<DisputeDetailPage params={Promise.resolve({ id: DISPUTE })} />);

const summaryForbidden = () =>
  HttpResponse.json(
    {
      success: false,
      message: "Bu işlem için yetkiniz yok.",
      httpStatus: "403 FORBIDDEN",
      errorCode: "ACCESS_DENIED",
      errorCategory: "ACCESS_DENIED",
      requestId: "rid-403-summary",
      path: `/admin/job-assignments/${ASSIGNMENT}`,
      timeStamp: "2026-09-06T09:00:00.000000000Z",
    },
    { status: 403 },
  );

const params = (values: Record<string, string> = {}) => Promise.resolve(values);

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  clearRecentOperations();
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

describe("a CATALOG_EDITOR typing /disputes by hand", () => {
  it("gets a 403 state, and neither the queue nor any escrow figure is requested", async () => {
    stubMe(CATALOG_EDITOR, ["CATALOG_EDITOR"]);
    const disputes = watchDisputes();
    const summary = watchSummary();
    const evidence = watchEvidence();

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    // The claim, stated as numbers.
    expect(disputes.calls).toBe(0);
    expect(summary.calls).toBe(0);
    expect(evidence.calls).toBe(0);

    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Anlaşmazlıkları çöz");
    // They are told which page refused them; the queue itself is not there.
    expect(html).toContain("Uyuşmazlıklar ve emanet");
    expect(html).not.toContain("Etkin uyuşmazlıklar");
    expect(html).not.toContain("Onayla ve gönder");
  });
});

describe("an OWNER on the queue", () => {
  it("sees the dispute with its status, opening party, assignment, amount and date", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes();
    watchSummary();
    const evidence = watchEvidence();

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(disputes.calls).toBe(1);
    expect(disputes.url?.searchParams.has("status")).toBe(false);
    expect(evidence.calls).toBe(0);
    expect(html).toContain("Etkin uyuşmazlıklar");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain(ASSIGNMENT);
    // The amount comes from the escrow read, formatted through lib/format.
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("05.09.2026");
  });

  it("sends status to the backend, including the closed archive", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Açık");
    expect(html).toContain("İncelemede");
    expect(html).toContain("Çözüldü");
    expect(html).toContain("Bekleyenler");
    expect(html).toContain("durum verilmezse bekleyen");
    expect(html).not.toContain("ucun bir durum parametresi yoktur");
    expect(html).not.toContain("DTO'da tutar alanı yoktur");
  });

  it("asks the backend for UNDER_REVIEW instead of filtering the loaded page", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes(emptyQueue);
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ durum: "UNDER_REVIEW" })} />,
    );

    expect(disputes.url?.searchParams.get("status")).toBe("UNDER_REVIEW");
    expect(html).toContain("İncelemede durumunda uyuşmazlık yok.");
  });

  /** koala-admin#110: tarih aralığı `createdAt` üzerinde backend'e gider; CSV bağlantısı görünümü taşır. */
  it("turns baslangic/bitis into Istanbul day boundaries and carries them into the status tabs and export link", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes(emptyQueue);
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage
        searchParams={params({ durum: "RESOLVED", baslangic: "2026-09-01", bitis: "2026-09-14" })}
      />,
    );

    expect(disputes.url?.searchParams.get("status")).toBe("RESOLVED");
    expect(disputes.url?.searchParams.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(disputes.url?.searchParams.get("to")).toBe("2026-09-14T20:59:59.999Z");
    expect(html).toContain('data-testid="uyusmazlik-tarih-summary"');
    expect(html).toContain("Bu tarih aralığında uyuşmazlık yok.");
    expect(html).toContain(
      'href="/disputes?durum=OPEN&amp;baslangic=2026-09-01&amp;bitis=2026-09-14"',
    );
    expect(html).toContain('data-testid="disputes-export"');
    expect(html).toContain(
      'href="/api/export/disputes?durum=RESOLVED&amp;baslangic=2026-09-01&amp;bitis=2026-09-14"',
    );
  });

  /** koala-admin#111: ev karosu "eskiden yeniye" bağlantısı verir; sekme, arama ve CSV bu sırayı taşır. */
  it("forwards ?sirala=createdAt,asc to the backend and carries it into the tabs and export link", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes(emptyQueue);
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ sirala: "createdAt,asc" })} />,
    );

    expect(disputes.url?.searchParams.get("sort")).toBe("createdAt,asc");
    expect(html).toContain('href="/disputes?durum=OPEN&amp;sirala=createdAt%2Casc"');
    expect(html).toContain('href="/api/export/disputes?sirala=createdAt%2Casc"');

    // Varsayılan sıra adreslere yazılmaz; sıralanamayan alan varsayılana düşer.
    const plain = watchDisputes(emptyQueue);
    const fallback = await renderServerComponent(
      <DisputesPage searchParams={params({ sirala: "status,asc" })} />,
    );
    expect(plain.url?.searchParams.get("sort")).toBe("createdAt,desc");
    expect(fallback).not.toContain("sirala=");
  });

  it("drops a day that is not a calendar day before it reaches the backend", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes(emptyQueue);
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ baslangic: "2026-13-01" })} />,
    );

    expect(disputes.url?.searchParams.has("from")).toBe(false);
    expect(html).not.toContain('data-testid="uyusmazlik-tarih-summary"');
  });

  it("pages through GET /admin/disputes instead of truncating the first slice", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    let requestedPage: string | null = null;
    server.use(
      http.get(DISPUTES, ({ request }) => {
        requestedPage = new URL(request.url).searchParams.get("page");
        return HttpResponse.json({
          success: true,
          message: "Uyuşmazlıklar listelendi.",
          httpStatus: "200 OK",
          path: "/admin/disputes",
          requestId: "rid-queue",
          timeStamp: "2026-09-06T09:00:00.000000000Z",
          data: {
            content: [DISPUTE_ROW],
            page: 1,
            size: 25,
            totalElements: 26,
            totalPages: 2,
            first: false,
            last: true,
          },
        });
      }),
    );
    watchSummary();

    const html = (
      await renderServerComponent(<DisputesPage searchParams={params({ sayfa: "1" })} />)
    ).replaceAll("<!-- -->", "");

    expect(requestedPage).toBe("1");
    expect(html).toContain("Sayfa 2 / 2");
    expect(html).toContain("26");
    expect(html).toContain("uyuşmazlık");
    expect(html).not.toContain("sonraki dilimde");
    expect(html).not.toContain("İlk 25 kayıt");
  });

  it("says the queue is empty rather than that it failed", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes(emptyQueue);

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Bekleyen uyuşmazlık yok.");
  });
});

describe("the selected dispute", () => {
  it("shows both parties, the payment status, the price breakdown and the evidence", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    const evidence = watchEvidence();

    const html = await renderDetail();

    expect(html).toContain("Uyuşmazlık detayı");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("HELD_IN_ESCROW");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("₺137,83");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("%10");
    expect(evidence.calls).toBe(1);
    expect(html).toContain("vardiyayı tamamladım");
    expect(html).toContain("vardiya kanıtı.png");
    expect(html).toContain("image/png");
    expect(html).toContain("1,5 KB");
    expect(html).toContain("İşçi · Ayşe Yılmaz");
    expect(html).toContain("05.09.2026 11:15");
    expect(html).toContain(`/api/disputes/${DISPUTE}/evidence/${EVIDENCE_ID}/download`);
    expect(html).toContain(`/assignments/${ASSIGNMENT}`);
    expect(html).not.toContain("koala-backend.test");
    expect(html).not.toContain("İmzalı indirme kaynakları tanımlı değil");
  });

  /** koala-admin#99: nesne sayfası denetim kaydına bu uyuşmazlık kimliğiyle bağlanır. */
  it("points at the audit log filtered to this dispute, only for an audit.read holder", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence();
    const alone = await renderDetail();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...OWNER_REVIEW_PERMISSIONS, "audit.read"], ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence();
    watchAudit();
    const html = await renderDetail();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${DISPUTE}"`);
  });

  /**
   * koala-admin#107: açılış, kanıt ve kayıtlı karar DTO'dan; personel
   * kararı denetim izinden; tek çizelge, zamana göre. Çözen personel DTO'da
   * yalnız kimlik: kısa kimlik, `/staff` bağlantısı `staff.read` ile.
   */
  it("merges the dispute's own events with the staff decision in one timeline", async () => {
    stubMe([...OWNER_REVIEW_PERMISSIONS, "audit.read", "staff.read"], ["OWNER"]);
    watchDispute(() =>
      HttpResponse.json({
        success: true,
        message: "Uyuşmazlık getirildi.",
        httpStatus: "200 OK",
        path: `/admin/disputes/${DISPUTE}`,
        requestId: "rid-dispute",
        timeStamp: "2026-09-06T09:00:00.000000000Z",
        data: {
          ...DISPUTE_ROW,
          status: "RESOLVED",
          resolution: "RELEASE_TO_WORKER",
          resolutionNote: "Vardiya kanıtlandı.",
          resolvedByStaffId: STAFF_ID,
          resolvedAt: "2026-09-06T08:00:00.000000000Z",
        },
      }),
    );
    watchSummary();
    watchEvidence();
    const RESOLVE_ROW = {
      ...categoryCreatedEntry,
      id: "aa000000-0000-4c00-8000-0000000000d1",
      occurredAt: "2026-09-06T08:00:00.000Z",
      actorStaffId: STAFF_ID,
      actorDisplayName: "Uyuşmazlık Hakemi",
      permission: "dispute.resolve",
      action: "disputes.resolve",
      resourceType: "disputes",
      resourceId: DISPUTE,
      sensitivity: "FINANCIAL" as const,
    };
    const audit = watchAudit({ rows: [RESOLVE_ROW], totalElements: 1 });
    // koala-admin#112: staff.read varken çözümleyici bir kez sorar; fixture bu kimliği
    // tanımaz (404), kısa kimlik çapaya bağlı kalır.
    const staff = stubStaffMember();

    const html = await renderDetail();

    expect(audit.urls).toHaveLength(1);
    expect(audit.urls[0]?.searchParams.get("resourceId")).toBe(DISPUTE);
    expect(staff.ids).toEqual([STAFF_ID]);

    const timeline = html.slice(html.indexOf('data-testid="object-timeline"'));
    const positions = [
      "Uyuşmazlık açıldı",
      "Kanıt yüklendi",
      "Karar verildi",
      "disputes.resolve",
    ].map((label) => timeline.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(timeline).toContain("vardiya kanıtı.png");
    expect(timeline).toContain("Vardiya kanıtlandı.");
    expect(timeline).toContain("Uyuşmazlık Hakemi");
    expect(timeline).toContain("Denetim izinden 1 kayıt.");
    // Denetim satırı, çizelgedeki karar satırı ve "Çözen personel" alanı.
    expect(html.match(new RegExp(`href="/staff#personel-${STAFF_ID}"`, "g"))).toHaveLength(3);
    for (const value of detailValuesOf(RESOLVE_ROW)) expect(html).not.toContain(value);
    expect(html.match(/href="\/audit-log\?resourceId=/g)).toHaveLength(1);
  });

  it("draws only the dispute's own events without audit.read and sends no audit request", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence();
    const audit = watchAudit({ rows: [categoryCreatedEntry] });

    const html = await renderDetail();

    expect(audit.urls).toHaveLength(0);
    expect(html).toContain("Uyuşmazlık açıldı");
    expect(html).toContain("Kanıt yüklendi");
    expect(html).not.toContain("job.category.create");
    expect(html).toContain('data-testid="object-timeline-audit-disabled"');
  });

  it("keeps decision controls usable when no evidence was attached", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence(emptyEvidence);

    const html = await renderDetail();

    expect(html).toContain("Bu uyuşmazlığa kanıt dosyası eklenmemiş.");
    expect(html).toContain("Kanıt olmadan da karar vermeye devam edebilirsiniz.");
    expect(html).toContain("Kararı gözden geçir");
  });

  it("keeps the recorded resolution as a status after the dispute closes", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute(() =>
      HttpResponse.json({
        success: true,
        message: "Uyuşmazlık getirildi.",
        httpStatus: "200 OK",
        path: `/admin/disputes/${DISPUTE}`,
        requestId: "rid-dispute",
        timeStamp: "2026-09-06T09:00:00.000000000Z",
        data: {
          ...DISPUTE_ROW,
          status: "RESOLVED",
          resolution: "RELEASE_TO_WORKER",
          resolutionNote: "Kanıtlar işçinin teslimatını doğruluyor.",
          resolvedAt: "2026-09-06T10:00:00.000000000Z",
        },
      }),
    );
    watchSummary();
    watchEvidence();

    const html = await renderDetail();

    expect(html).toContain("Karar kaydedildi");
    expect(html).toContain("İşçiye çıkar");
    expect(html).toContain("Bu uyuşmazlık kapanmış");
    expect(html).not.toContain("Kararı gözden geçir");
  });

  it("contains an evidence failure inside its panel and keeps the rest of the dispute usable", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence(evidenceFailed);

    const html = await renderDetail();

    expect(html).toContain("₺1.378,33");
    expect(html).toContain("Kararı gözden geçir");
    expect(html).toContain("Kanıt dosyaları yüklenemedi.");
    expect(html).toContain("EVIDENCE_STORAGE_UNAVAILABLE");
    expect(html).toContain("rid-evidence-failed");
    expect(html).not.toContain("Uyuşmazlık kuyruğu yüklenemedi.");
  });

  it("arms the resolution form and both escrow operations", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence();

    const html = await renderDetail();

    expect(html).toContain("Kararı gözden geçir");
    expect(html).toContain("Çıkışı gözden geçir");
    expect(html).toContain("İadeyi gözden geçir");
    expect(html).toContain("kısmi iade yoktur");
    expect(html).toContain(
      "RELEASE_TO_WORKER için dispute.resolve ve payment.read ve payout.release",
    );
    expect(html).toContain(
      "REFUND_EMPLOYER için dispute.resolve ve payment.read ve payment.refund",
    );
    expect(html).toContain('data-testid="resolve-permission-notice"');
  });

  it("does not request payment summaries for the current DISPUTE_HANDLER role", async () => {
    stubMe(DISPUTE_HANDLER_PERMISSIONS, ["DISPUTE_HANDLER"]);
    watchDispute();
    const summary = watchSummary();
    watchEvidence();

    const html = await renderDetail();

    expect(summary.calls).toBe(0);
    expect(html).toContain("Kararı gözden geçir");
    expect(html).not.toContain("Çıkışı gözden geçir");
    expect(html).not.toContain("İadeyi gözden geçir");
    expect(html).toContain("izniniz yok; bu işlem gösterilmiyor");
    expect(html).toContain("payment.read");
    expect(html).toContain('value="RELEASE_TO_WORKER" disabled=""');
    expect(html).toContain('value="REFUND_EMPLOYER" disabled=""');
    expect(html).toContain('value="DISMISSED"');
    expect(html).not.toContain('value="DISMISSED" disabled=""');
  });

  it("disables financial resolution choices when their current permissions are missing", async () => {
    stubMe(["dispute.resolve", "payment.read"], ["DISPUTE_HANDLER"]);
    watchDispute();
    const summary = watchSummary();
    watchEvidence();

    const html = await renderDetail();

    expect(summary.calls).toBe(1);
    expect(html).toContain('value="RELEASE_TO_WORKER" disabled=""');
    expect(html).toContain('value="REFUND_EMPLOYER" disabled=""');
    expect(html).toContain('data-testid="release-permission-missing"');
    expect(html).toContain('data-testid="refund-permission-missing"');
    expect(html).toContain("DISMISSED için dispute.resolve");
  });
});

describe("when the panel cannot read the amount", () => {
  it("shows the dispute, withholds the money, and says which read failed", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    const summary = watchSummary(summaryForbidden);
    watchEvidence();

    const html = await renderDetail();

    expect(summary.calls).toBe(1);
    expect(html).toContain("Emanet tutarları okunamıyor");
    expect(html).toContain("Panel tutar uydurmayacağı");
    expect(html).toContain("Uyuşmazlık detayı");
    expect(html).toContain("Reddet (emanete dokunma)");
    expect(html).toContain("İşçi · Ayşe Yılmaz");
    expect(html).toContain("Emanet özeti okunamadı");
    expect(html).toContain('data-testid="escrow-disabled-reason"');
  });
});

describe("the backend is the authority", () => {
  it("renders its refusal of the queue instead of crashing", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: "/admin/disputes",
          timeStamp: "2026-09-06T09:00:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(disputes.calls).toBe(1);
    expect(html).toContain("Backend uyuşmazlık kuyruğunu vermedi.");
    expect(html).toContain("rid-403");
    expect(html).not.toContain("Onayla ve gönder");
  });

  it("shows the recent-operations panel with its caveat even when the queue fails", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes(() => HttpResponse.json({ success: false, message: "boom" }, { status: 500 }));

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Son işlemler");
    expect(html).toContain("koala-backend#15");
  });
});

/** koala-admin#85: olmayan uyuşmazlık ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a dispute that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND and fetches nothing else", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const dispute = watchDispute(() =>
      HttpResponse.json(
        {
          ...resourceNotFoundBody,
          errorCode: "DISPUTE_NOT_FOUND",
          path: `/admin/disputes/${DISPUTE}`,
        },
        { status: 404 },
      ),
    );
    const summary = watchSummary();
    const evidence = watchEvidence();

    const thrown = await renderDetail().then(
      () => null,
      (error: unknown) => error,
    );

    expect(dispute.calls).toBe(1);
    expect(summary.calls).toBe(0);
    expect(evidence.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const dispute = watchDispute();

    const thrown = await renderServerComponent(
      <DisputeDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(dispute.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("the dispute search box — koala-admin#94", () => {
  it("sends ara to the backend as query, next to the status, and names it in the result line", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const disputes = watchDisputes();
    watchSummary();

    const html = (
      await renderServerComponent(
        <DisputesPage searchParams={params({ ara: " ayşe ", durum: "UNDER_REVIEW" })} />,
      )
    ).replaceAll("<!-- -->", "");

    expect(disputes.url?.searchParams.get("query")).toBe("ayşe");
    expect(disputes.url?.searchParams.get("status")).toBe("UNDER_REVIEW");
    expect(html).toContain("“ayşe” için 1 uyuşmazlık bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara and keeps the status; the status tabs carry ara", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ ara: "ayşe", durum: "OPEN" })} />,
    );

    expect(html).toContain('href="/disputes?durum=OPEN&amp;boyut=25"');
    expect(html).toContain("Temizle");
    expect(html).toContain('href="/disputes?durum=RESOLVED&amp;ara=ay%C5%9Fe"');
  });

  it("says there is no result for the query", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes(emptyQueue);

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ ara: "kimse" })} />,
    );

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("Bekleyen uyuşmazlık yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes(() =>
      HttpResponse.json(searchQueryTooLongBody("/admin/disputes"), { status: 400 }),
    );

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ ara: "k".repeat(120) })} />,
    );

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Uyuşmazlık kuyruğu yüklenemedi.");
  });
});

/** koala-admin#100 / koala-backend#283: `?kullanici=` → `userId`; açan tarafın rolü ve çözen personel. */
describe("the user filter, the opener's side and the resolving staff member", () => {
  const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

  it("sends kullanici as userId next to the status and offers to drop the filter", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const queue = watchDisputes();
    watchSummary();

    const html = (
      await renderServerComponent(
        <DisputesPage searchParams={params({ kullanici: USER_ID, durum: "RESOLVED" })} />,
      )
    ).replaceAll("<!-- -->", "");

    expect(queue.url?.searchParams.get("userId")).toBe(USER_ID);
    expect(queue.url?.searchParams.get("status")).toBe("RESOLVED");
    expect(html).toContain('data-testid="dispute-user-filter"');
    expect(html).toContain('href="/disputes?durum=RESOLVED&amp;boyut=25"');
    // Durum sekmeleri süzgeci taşır.
    expect(html).toContain(`kullanici=${USER_ID}`);
  });

  it("drops a user id that is not a UUID before it reaches the backend", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    const queue = watchDisputes();
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ kullanici: "not-a-uuid" })} />,
    );

    expect(queue.url?.searchParams.has("userId")).toBe(false);
    expect(html).not.toContain('data-testid="dispute-user-filter"');
  });

  it("draws the opener's side and, once resolved, the staff member who resolved it", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute(() =>
      HttpResponse.json({
        success: true,
        message: "Uyuşmazlık getirildi.",
        httpStatus: "200 OK",
        path: `/admin/disputes/${DISPUTE}`,
        requestId: "rid-dispute",
        timeStamp: "2026-09-06T09:00:00.000000000Z",
        data: {
          ...DISPUTE_ROW,
          openedBySide: "WORKER",
          status: "RESOLVED",
          resolution: "DISMISSED",
          resolutionNote: "Kanıt yetersiz.",
          resolvedAt: "2026-09-06T10:00:00Z",
          resolvedByStaffId: "5f000000-0000-4000-8000-000000000055",
        },
      }),
    );
    watchSummary();
    watchEvidence();

    const html = (await renderDetail()).replaceAll("<!-- -->", "");

    expect(html).toMatch(/Ayşe Yılmaz<\/a><span[^>]*>İşçi</);
    // staff.read yok: kısa kimlik, tam kimlik title'da, bağlantısız (koala-admin#112).
    expect(html).toMatch(
      /Çözen personel<\/dt><dd[^>]*><span[^>]*title="5f000000-0000-4000-8000-000000000055">5f000000</,
    );
    expect(html).not.toContain("#personel-");
  });

  it("writes neither side nor staff for a #265 server, and the empty value once resolved", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDispute();
    watchSummary();
    watchEvidence();
    const open = (await renderDetail()).replaceAll("<!-- -->", "");
    expect(open).not.toContain("Çözen personel");
    expect(open).not.toMatch(/Ayşe Yılmaz<\/a><span[^>]*>İşçi</);

    watchDispute(() =>
      HttpResponse.json({
        success: true,
        message: "Uyuşmazlık getirildi.",
        httpStatus: "200 OK",
        path: `/admin/disputes/${DISPUTE}`,
        requestId: "rid-dispute",
        timeStamp: "2026-09-06T09:00:00.000000000Z",
        data: {
          ...DISPUTE_ROW,
          status: "RESOLVED",
          resolution: "DISMISSED",
          resolvedAt: "2026-09-06T10:00:00Z",
        },
      }),
    );
    const resolved = (await renderDetail()).replaceAll("<!-- -->", "");
    expect(resolved).toMatch(/Çözen personel<\/dt><dd[^>]*>—</);
  });
});
