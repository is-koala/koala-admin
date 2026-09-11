import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { adminAssignmentFixture } from "../../../test/fixtures/admin-assignment";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

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
const { clearRecentOperations } = await import("@/server/escrow/recent-operations");

const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";
const DISPUTE = "d1000000-0000-4c00-8000-000000000001";

const ADMIN_ME = apiUrl("/admin/me");
const DISPUTES = apiUrl("/admin/disputes");
const SUMMARY = apiUrl(`/admin/job-assignments/${ASSIGNMENT}`);
const EVIDENCE = apiUrl(`/admin/disputes/${DISPUTE}/evidence`);
const EVIDENCE_ID = "e1000000-0000-4c00-8000-000000000001";

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
    watchDisputes();
    watchSummary();
    const evidence = watchEvidence();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(html).toContain("Uyuşmazlık detayı");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("HELD_IN_ESCROW");
    // Price breakdown, every figure formatted through lib/format.
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
    expect(html).not.toContain("koala-backend.test");
  });

  it("keeps the queue and decision controls usable when no evidence was attached", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes();
    watchSummary();
    watchEvidence(emptyEvidence);

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(html).toContain("Etkin uyuşmazlıklar");
    expect(html).toContain("Bu uyuşmazlığa kanıt dosyası eklenmemiş.");
    expect(html).toContain("Kanıt olmadan da karar vermeye devam edebilirsiniz.");
    expect(html).toContain("Kararı gözden geçir");
  });

  it("contains an evidence failure inside its panel and keeps the rest of the dispute usable", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes();
    watchSummary();
    watchEvidence(evidenceFailed);

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(html).toContain("Etkin uyuşmazlıklar");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("Kararı gözden geçir");
    expect(html).toContain("Kanıt dosyaları yüklenemedi.");
    expect(html).toContain("EVIDENCE_STORAGE_UNAVAILABLE");
    expect(html).toContain("rid-evidence-failed");
    expect(html).not.toContain("Uyuşmazlık kuyruğu yüklenemedi.");
  });

  it("arms the resolution form and both escrow operations", async () => {
    stubMe(OWNER_REVIEW_PERMISSIONS, ["OWNER"]);
    watchDisputes();
    watchSummary();
    watchEvidence();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

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
    watchDisputes();
    const summary = watchSummary();
    watchEvidence();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

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
    watchDisputes();
    const summary = watchSummary();
    watchEvidence();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

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
    watchDisputes();
    const summary = watchSummary(summaryForbidden);
    watchEvidence();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(summary.calls).toBe(1);
    expect(html).toContain("Emanet tutarları okunamıyor");
    expect(html).toContain("Panel tutar uydurmayacağı");
    // The dispute itself is still workable — a DISMISSED decision touches no
    // money and stays available.
    expect(html).toContain("Uyuşmazlık detayı");
    expect(html).toContain("Reddet (emanete dokunma)");
    expect(html).toContain("İşçi · Ayşe Yılmaz");
    // And the two money triggers are rendered disabled, with the reason.
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
