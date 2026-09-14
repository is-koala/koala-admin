/**
 * Global arama BFF'i — koala-admin#104. Komut paleti tarayıcıdan yalnız
 * buraya gelir; backend'e giden yedi uç, token ve izin süzgeci sunucuda kalır
 * (`src/server/api/koala.ts`'nin `server-only` sınırı).
 *
 * Kapı `session`: tek bir izin isteyemez, çünkü aramanın her hedefi ayrı bir
 * izne bağlı ve hangi hedeflerin sorulacağını `globalSearch` o listeden
 * seçiyor. İzni hiç olmayan personel `no-permission` alır; oturumu olmayan
 * 401. `routes.ts` girdisi ve `routes.test.ts`'in `EXPECTED_UNGATED` listesi
 * bu gerekçeyi yazılı tutar.
 *
 * `/admin/me`'nin cevap verememesi (5xx, zaman aşımı) izin yokluğu değildir:
 * kesintide operatöre "izniniz yok" demek yanlış teşhis olurdu. O yol 502
 * `unavailable`; yalnız gerçek ret (`NO_STAFF_RECORD`) 403 `no-permission`.
 */
import { NextResponse } from "next/server";

import type { GlobalSearchResponse } from "@/lib/global-search";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { getStaffContext, type StaffContextFailureKind } from "@/server/authz/staff-context";
import { globalSearch, isTooShort } from "@/server/search/global-search";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function respond(body: GlobalSearchResponse, status: number): Response {
  return NextResponse.json(body, { status, headers: HEADERS });
}

const FAILURE_RESPONSES: Record<StaffContextFailureKind, [GlobalSearchResponse, number]> = {
  SESSION: [{ kind: "no-permission" }, 401],
  NO_STAFF_RECORD: [{ kind: "no-permission" }, 403],
  BACKEND_UNAVAILABLE: [{ kind: "unavailable" }, 502],
  UNEXPECTED: [{ kind: "unavailable" }, 502],
};

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  // Palet zaten atmaz; adres çubuğundan gelen tek harf `/admin/me`'yi bile harcamasın.
  if (isTooShort(query)) {
    return respond({ kind: "idle" }, 200);
  }

  const context = await getStaffContext();
  if (context.failure !== null) {
    return respond(...FAILURE_RESPONSES[context.failure.kind]);
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const result = await globalSearch({ accessToken, has: context.has, query });
    return respond(result, result.kind === "rate-limited" ? 429 : 200);
  } catch (error) {
    if (isStaffAuthError(error)) {
      return respond(...FAILURE_RESPONSES.SESSION);
    }
    return respond({ kind: "unavailable" }, 502);
  }
}
