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
 */
import { NextResponse } from "next/server";

import type { GlobalSearchResponse } from "@/lib/global-search";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { getStaffContext } from "@/server/authz/staff-context";
import { globalSearch } from "@/server/search/global-search";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** Adres çubuğuna yapıştırılmış bir roman backend'e gitmesin; kırpma ilerde. */
const MAX_RAW_QUERY_LENGTH = 512;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("q") ?? "";
  const query = raw.slice(0, MAX_RAW_QUERY_LENGTH);

  const context = await getStaffContext();
  if (context.failure !== null) {
    const status = context.failure.kind === "SESSION" ? 401 : 403;
    return NextResponse.json({ kind: "no-permission" } satisfies GlobalSearchResponse, {
      status,
      headers: HEADERS,
    });
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const result = await globalSearch({ accessToken, has: context.has, query });
    const status = result.kind === "rate-limited" ? 429 : 200;
    return NextResponse.json(result, { status, headers: HEADERS });
  } catch (error) {
    if (isStaffAuthError(error)) {
      return NextResponse.json({ kind: "no-permission" } satisfies GlobalSearchResponse, {
        status: 401,
        headers: HEADERS,
      });
    }
    return NextResponse.json({ kind: "unavailable" } satisfies GlobalSearchResponse, {
      status: 502,
      headers: HEADERS,
    });
  }
}
