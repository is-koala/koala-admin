/**
 * TCKK fotoğrafı same-origin BFF. Tarayıcı depo adresini görmesin diye 302'yi
 * sunucu takip eder; kuyruk listesine bakılmaz çünkü backend belgeyi zaten
 * incelemeye bağlar.
 */
import { env } from "@/env";
import { identityDocumentDownloadPath } from "@/server/api/identity-reviews";
import { isKoalaApiError } from "@/server/api/errors";
import { buildKoalaUrl, KOALA_ACCEPT_LANGUAGE } from "@/server/api/koala";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";

interface RouteContext {
  params: Promise<{ reviewId: string; documentId: string }>;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { reviewId, documentId } = await params;
  if (!isUuid(reviewId) || !isUuid(documentId)) {
    return concealedNotFound();
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const upstream = await fetch(
      buildKoalaUrl(identityDocumentDownloadPath(reviewId, documentId)),
      {
        method: "GET",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Accept-Language": KOALA_ACCEPT_LANGUAGE,
          Authorization: `Bearer ${accessToken}`,
        }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(env.KOALA_API_TIMEOUT_MS)]),
      },
    );

    if (upstream.status === 302) {
      const signedUrl = allowedSignedDownload(upstream.headers.get("location"));
      if (signedUrl === null) {
        return upstreamFailure();
      }

      const stored = await fetch(signedUrl, {
        method: "GET",
        headers: new Headers(),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(env.KOALA_API_TIMEOUT_MS)]),
      });
      if (stored.status !== 200) {
        return upstreamFailure();
      }
      return photoResponse(stored);
    }

    if ([401, 403, 404].includes(upstream.status)) {
      return concealedNotFound();
    }
    if (upstream.status !== 200) {
      return upstreamFailure();
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
    return upstreamFailure();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function allowedSignedDownload(location: string | null): string | null {
  if (location === null || !URL.canParse(location)) return null;

  const url = new URL(location);
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (!env.EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS.includes(url.origin)) return null;
  return url.toString();
}

function photoResponse(upstream: Response): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Disposition", 'inline; filename="tckk"');
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}

function concealedNotFound(): Response {
  return new Response("Kimlik fotoğrafı bulunamadı.", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function upstreamFailure(): Response {
  return new Response("Kimlik fotoğrafı indirilemedi.", {
    status: 502,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}
