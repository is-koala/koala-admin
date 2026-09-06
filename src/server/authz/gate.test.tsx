import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeNoStaffRecordBody, adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

import { PERMISSIONS } from "./permissions";

/**
 * koala-admin#5's acceptance criteria, rendered.
 *
 * The assertion that matters most in this file is not about markup: it is
 * `audit.calls === 0`. "The content is never rendered and the data is never
 * fetched" is a claim about requests, and a test that only checked for absent
 * HTML would pass just as happily against a page that fetched the audit log and
 * then hid it.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: AuditLogPage } = await import("@/app/(panel)/audit-log/page");

const ADMIN_ME = apiUrl("/admin/me");
const AUDIT_LOG = apiUrl("/admin/audit-log");

/** Everything an OWNER holds once the backend has resolved the role graph. */
const OWNER_PERMISSIONS = [...PERMISSIONS];
/** What a CATALOG_EDITOR holds: one permission, and it is not `audit.read`. */
const CATALOG_EDITOR_PERMISSIONS = ["category.manage"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

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

/** Counts every call to the audit endpoint, whatever the gate decided. */
function watchAuditLog(respond: () => Response) {
  let calls = 0;
  server.use(
    http.get(AUDIT_LOG, () => {
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

const emptyAuditPage = () =>
  HttpResponse.json({
    success: true,
    message: "Liste getirildi.",
    httpStatus: "200 OK",
    path: "/admin/audit-log",
    requestId: "rid-audit",
    timeStamp: "2026-09-06T09:20:00.000000000Z",
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

describe("a CATALOG_EDITOR typing /audit-log by hand", () => {
  it("gets a 403 state and the audit log is never requested", async () => {
    stubMe(CATALOG_EDITOR_PERMISSIONS, ["CATALOG_EDITOR"]);
    const audit = watchAuditLog(emptyAuditPage);

    const html = await renderServerComponent(<AuditLogPage />);

    // The claim, stated as a number.
    expect(audit.calls).toBe(0);

    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Denetim kaydını görüntüle");
    // The page's own furniture is there — they are told which page refused
    // them — but the table the permission guards is not.
    expect(html).toContain("Denetim kaydı");
    expect(html).not.toContain("Personel işlemleri");
    expect(html).not.toContain("<table");
  });

  it("is told what to do about it, and that the panel is not where roles change", async () => {
    stubMe(CATALOG_EDITOR_PERMISSIONS, ["CATALOG_EDITOR"]);
    watchAuditLog(emptyAuditPage);

    const html = await renderServerComponent(<AuditLogPage />);

    expect(html).toContain("Keycloak");
    expect(html).toContain("CATALOG_EDITOR");
  });
});

describe("an OWNER on the same page", () => {
  it("is let through, and the request the CATALOG_EDITOR never made is made", async () => {
    stubMe(OWNER_PERMISSIONS, ["OWNER"]);
    const audit = watchAuditLog(emptyAuditPage);

    const html = await renderServerComponent(<AuditLogPage />);

    expect(audit.calls).toBe(1);
    expect(html).not.toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Denetim kaydı boş.");
  });

  it("sends the access token with it", async () => {
    stubMe(OWNER_PERMISSIONS, ["OWNER"]);
    let authorization: string | null = null;
    server.use(
      http.get(AUDIT_LOG, ({ request }) => {
        authorization = request.headers.get("authorization");
        return emptyAuditPage();
      }),
    );

    await renderServerComponent(<AuditLogPage />);

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
  });
});

describe("the backend is the authority and the panel behaves as though it is", () => {
  it("renders the backend's 403 instead of crashing, even though the gate opened", async () => {
    // The UI hiding is cosmetic. Here the panel let the page through and the
    // backend still refused — which is also what an unmapped /admin path
    // answers today, since koala-backend#14 refuses by default rather than
    // returning 404.
    stubMe(OWNER_PERMISSIONS, ["OWNER"]);
    const audit = watchAuditLog(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: "/admin/audit-log",
          timeStamp: "2026-09-06T09:21:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const html = await renderServerComponent(<AuditLogPage />);

    expect(audit.calls).toBe(1);
    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("rid-403");
  });
});

describe("when the panel cannot find out what you may do", () => {
  it("says so rather than telling an OWNER they lack permission", async () => {
    // A 500 from /admin/me must not be reported as a permission problem: the
    // person's roles are intact and the words would send them to the wrong
    // place entirely.
    server.use(
      http.get(ADMIN_ME, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/me",
            timeStamp: "2026-09-06T09:22:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );
    const audit = watchAuditLog(emptyAuditPage);

    const html = await renderServerComponent(<AuditLogPage />);

    expect(audit.calls).toBe(0);
    expect(html).toContain("İzinleriniz çözülemedi");
    expect(html).not.toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("rid-500");
  });

  it("explains a Keycloak identity with no staff record, and grants nothing", async () => {
    server.use(
      http.get(ADMIN_ME, () => HttpResponse.json(adminMeNoStaffRecordBody, { status: 403 })),
    );
    const audit = watchAuditLog(emptyAuditPage);

    const html = await renderServerComponent(<AuditLogPage />);

    expect(audit.calls).toBe(0);
    // Apostrophes arrive HTML-escaped, so the assertion sits either side of one.
    expect(html).toContain("personel kaydınız yok");
    expect(html).toContain("NO_STAFF_RECORD");
    // Not "you lack this permission" — the difference is the whole point.
    expect(html).not.toContain("403 — Bu sayfa için yetkiniz yok");
  });

  it("hands a broken session to the page that already explains it", async () => {
    const { StaffAuthError } = await import("@/server/auth/errors");
    getKoalaAccessToken.mockRejectedValue(new StaffAuthError("AUDIENCE_MISCONFIGURED"));
    const audit = watchAuditLog(emptyAuditPage);

    // `redirect()` throws `NEXT_REDIRECT`; the destination rides on `digest`.
    const thrown = await renderServerComponent(<AuditLogPage />).then(
      () => null,
      (error: unknown) => error,
    );

    expect((thrown as { digest?: string }).digest).toContain(
      "/giris/hata?kod=AUDIENCE_MISCONFIGURED",
    );
    expect(audit.calls).toBe(0);
  });
});
