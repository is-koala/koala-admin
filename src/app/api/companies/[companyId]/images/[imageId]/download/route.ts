/**
 * Şirket galeri fotoğrafı same-origin BFF. Tarayıcı depo adresini görmesin
 * diye 302'yi sunucu takip eder; kuyruk listesine bakılmaz çünkü backend görseli
 * zaten şirkete bağlar.
 */
import { env } from "@/env";
import { companyImageDownloadPath } from "@/server/api/companies";
import { isKoalaApiError } from "@/server/api/errors";
import { buildKoalaUrl, KOALA_ACCEPT_LANGUAGE } from "@/server/api/koala";
import { DOWNLOAD_ERROR_HEADER, type DownloadErrorReason } from "@/lib/evidence-download";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { allowedSignedDownload } from "@/server/evidence/signed-download";

interface RouteContext {
  params: Promise<{ companyId: string; imageId: string }>;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { companyId, imageId } = await params;
  if (!isUuid(companyId) || !isUuid(imageId)) {
    return concealedNotFound();
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const upstream = await fetch(buildKoalaUrl(companyImageDownloadPath(companyId, imageId)), {
      method: "GET",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Accept-Language": KOALA_ACCEPT_LANGUAGE,
        Authorization: `Bearer ${accessToken}`,
      }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(env.KOALA_API_TIMEOUT_MS)]),
    });

    if (upstream.status === 302) {
      const signed = allowedSignedDownload(upstream.headers.get("location"));
      if (!signed.ok) {
        return upstreamFailure(signed.reason);
      }

      const stored = await fetch(signed.url, {
        method: "GET",
        headers: new Headers(),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(env.KOALA_API_TIMEOUT_MS)]),
      });
      if (stored.status !== 200) {
        return upstreamFailure("upstream");
      }
      return photoResponse(stored);
    }

    if ([401, 403, 404].includes(upstream.status)) {
      return concealedNotFound();
    }
    if (upstream.status !== 200) {
      return upstreamFailure("upstream");
    }

    return photoResponse(upstream);
  } catch (error) {
    if (
      (isKoalaApiError(error) && [401, 403, 404].includes(error.status)) ||
      (isStaffAuthError(error) &&
        ["SESSION_REQUIRED", "SESSION_EXPIRED", "PASSWORD_CHANGE_REQUIRED"].includes(error.code))
    ) {
      return concealedNotFound();
    }
    return upstreamFailure("upstream");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function photoResponse(upstream: Response): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Disposition", 'inline; filename="gallery"');
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}

function concealedNotFound(): Response {
  return new Response("Galeri fotoğrafı bulunamadı.", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Gövde personelin gördüğü cümle; neden başlıkta. Tarayıcı `img onError`
 * içinde başlığı okuyamaz, fotoğraf kutusu `HEAD` ile geri gelip okur.
 */
function upstreamFailure(reason: DownloadErrorReason): Response {
  return new Response("Galeri fotoğrafı indirilemedi.", {
    status: 502,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      [DOWNLOAD_ERROR_HEADER]: reason,
    },
  });
}
