import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
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

const TRUST_LEAD = ["dispute.resolve", "payout.release", "payment.refund"];
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

const SUMMARY_BODY = {
  id: ASSIGNMENT,
  status: "COMPLETED",
  paymentStatus: "HELD_IN_ESCROW",
  currency: "TRY",
  workerPayout: "1240.50",
  commissionAmount: "137.83",
  commissionRate: "0.1000",
  totalCharged: "1378.33",
  workHours: 8,
  jobTitle: "Garsonluk",
  worker: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", username: "mehmet" },
  companyName: "Koala Kafe",
  settledPayment: {
    id: "p-1",
    currency: "TRY",
    totalCharged: "1378.33",
    workerPayout: "1240.50",
    commissionAmount: "137.83",
    commissionRate: "0.1000",
    completedAt: "2026-09-01T10:00:00.000000000Z",
  },
};

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
  server.use(
    http.get(DISPUTES, () => {
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

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    // The claim, stated as numbers.
    expect(disputes.calls).toBe(0);
    expect(summary.calls).toBe(0);

    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Anlaşmazlıkları çöz");
    // They are told which page refused them; the queue itself is not there.
    expect(html).toContain("Uyuşmazlıklar ve emanet");
    expect(html).not.toContain("Etkin uyuşmazlıklar");
    expect(html).not.toContain("Onayla ve gönder");
  });
});

describe("a TRUST_LEAD on the queue", () => {
  it("sees the dispute with its status, opening party, assignment, amount and date", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    const disputes = watchDisputes();
    watchSummary();

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(disputes.calls).toBe(1);
    expect(html).toContain("Etkin uyuşmazlıklar");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain(ASSIGNMENT);
    // The amount comes from the escrow read, formatted through lib/format.
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("05.09.2026");
  });

  it("offers only the statuses the endpoint can return, and says why", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Açık");
    expect(html).toContain("İncelemede");
    // No "Çözüldü" filter: GET /admin/disputes never returns a resolved one.
    expect(html).not.toContain(">Çözüldü<");
    expect(html).toContain("yalnız <em>etkin</em>");
  });

  it("filters the loaded page by status", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ durum: "UNDER_REVIEW" })} />,
    );

    expect(html).toContain("Bu süzgeçle eşleşen uyuşmazlık yok.");
  });

  it("says the queue is empty rather than that it failed", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes(emptyQueue);

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Açık uyuşmazlık yok.");
  });
});

describe("the selected dispute", () => {
  it("shows both parties, the payment status, the price breakdown and the evidence", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes();
    watchSummary();

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
    // The opening reason is the evidence the backend actually holds.
    expect(html).toContain("vardiyayı tamamladım");
    expect(html).toContain("mesaj dizisi ya da dosya eki yoktur");
  });

  it("arms the resolution form and both escrow operations", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(html).toContain("Kararı gözden geçir");
    expect(html).toContain("Çıkışı gözden geçir");
    expect(html).toContain("İadeyi gözden geçir");
    // The resolve endpoint is guarded by dispute.resolve alone, and the screen
    // says so rather than leaving the escalation implicit.
    expect(html).toContain("yalnız dispute.resolve izniyle korunuyor");
    expect(html).toContain('data-testid="resolve-escalation-notice"');
  });

  it("hides an operation whose permission is missing", async () => {
    stubMe(["dispute.resolve"], ["DISPUTE_HANDLER"]);
    watchDisputes();
    watchSummary();

    const html = await renderServerComponent(
      <DisputesPage searchParams={params({ uyusmazlik: DISPUTE })} />,
    );

    expect(html).toContain("Kararı gözden geçir");
    expect(html).not.toContain("Çıkışı gözden geçir");
    expect(html).not.toContain("İadeyi gözden geçir");
    expect(html).toContain("izniniz yok; bu işlem gösterilmiyor");
  });
});

describe("when the panel cannot read the amount", () => {
  it("shows the dispute, withholds the money, and says which read failed", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes();
    const summary = watchSummary(summaryForbidden);

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
    // And the two money triggers are rendered disabled, with the reason.
    expect(html).toContain("Emanet özeti okunamadı");
    expect(html).toContain('data-testid="escrow-disabled-reason"');
  });
});

describe("the backend is the authority", () => {
  it("renders its refusal of the queue instead of crashing", async () => {
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
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
    stubMe(TRUST_LEAD, ["TRUST_LEAD"]);
    watchDisputes(() => HttpResponse.json({ success: false, message: "boom" }, { status: 500 }));

    const html = await renderServerComponent(<DisputesPage searchParams={params()} />);

    expect(html).toContain("Son işlemler");
    expect(html).toContain("koala-backend#15");
  });
});
