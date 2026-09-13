import { env } from "@/env";
import { disputeEvidencePath, getDisputeEvidence } from "@/server/api/disputes";
import { isKoalaApiError } from "@/server/api/errors";
import { buildKoalaUrl, KOALA_ACCEPT_LANGUAGE } from "@/server/api/koala";
import { DOWNLOAD_ERROR_HEADER, type DownloadErrorReason } from "@/lib/evidence-download";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { allowedSignedDownload } from "@/server/evidence/signed-download";

interface RouteContext {
  params: Promise<{ disputeId: string; evidenceId: string }>;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { disputeId, evidenceId } = await params;
  if (!isUuid(disputeId) || !isUuid(evidenceId)) {
    return concealedNotFound();
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const evidence = await getDisputeEvidence(accessToken, disputeId);
    const file = evidence.find((candidate) => candidate.id === evidenceId);

    if (file === undefined) {
      return concealedNotFound();
    }

    const upstream = await fetch(
      buildKoalaUrl(`${disputeEvidencePath(disputeId)}/${encodeURIComponent(evidenceId)}/download`),
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
      return attachmentResponse(stored, file.fileName);
    }

    if ([401, 403, 404].includes(upstream.status)) {
      return concealedNotFound();
    }
    if (upstream.status !== 200) {
      return upstreamFailure("upstream");
    }

    return attachmentResponse(upstream, file.fileName);
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

function attachmentResponse(upstream: Response, fileName: string): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Disposition", attachmentDisposition(fileName));
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}

function attachmentDisposition(original: string): string {
  const safe = safeFileName(original);
  const ascii =
    safe
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "kanit";
  const encoded = encodeURIComponent(safe).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function safeFileName(original: string): string {
  const sanitized = original
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gi, "")
    .replace(/[\\/]/g, "_")
    .replace(/["']/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim();
  return Array.from(sanitized).slice(0, 180).join("") || "kanit";
}

function concealedNotFound(): Response {
  return new Response("Kanıt bulunamadı.", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Gövde personelin gördüğü cümle; neden başlıkta. Tarayıcı `img onError`
 * içinde başlığı okuyamaz, fotoğraf kutusu `HEAD` ile geri gelip okur.
 */
function upstreamFailure(reason: DownloadErrorReason): Response {
  return new Response("Kanıt dosyası indirilemedi.", {
    status: 502,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      [DOWNLOAD_ERROR_HEADER]: reason,
    },
  });
}
