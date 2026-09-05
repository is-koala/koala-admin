import type { Metadata } from "next";
import Link from "next/link";

import { ErrorState } from "@/components/ui";
import { fromAuthjsErrorCode, isAuthFailureCode, type AuthFailureCode } from "@/server/auth/errors";

export const metadata: Metadata = { title: "Giriş yapılamadı" };

interface Explanation {
  readonly title: string;
  readonly description: string;
  /** What the person reading this can actually do next. */
  readonly nextStep: string;
  readonly retry: boolean;
}

/**
 * The whole point of this page is that these four are not the same message.
 *
 * A panel that says "giriş yapılamadı" for all of them sends an `OWNER` looking
 * for missing permissions when a realm mapper is off, and sends someone to open
 * a support ticket when Keycloak is simply down. Each entry below names the
 * thing that is actually wrong and who can fix it.
 */
const EXPLANATIONS: Record<AuthFailureCode, Explanation> = {
  KEYCLOAK_UNREACHABLE: {
    title: "Keycloak'a ulaşılamıyor",
    description:
      "Panel kimliği Keycloak'tan alır ve başka bir giriş yolu yoktur. Keycloak yanıt vermediği sürece panele kimse giremez — bu, ADR-0010'un bilerek kabul ettiği sonuçtur. Yetkinizle ya da hesabınızla ilgili bir sorun değil.",
    nextStep: "Keycloak servisinin ayakta olduğunu doğrulayın, sonra tekrar deneyin.",
    retry: true,
  },
  AUDIENCE_MISCONFIGURED: {
    title: "Yapılandırma hatası: token yanlış hedefe yazılmış",
    description:
      "Kimliğiniz doğrulandı; sorun sizde değil. Keycloak'ın verdiği access token'ın audience değeri koala-api değil, bu yüzden Koala backend'i token'ı kabul etmeyecek. Bu bir yetki hatası DEĞİLDİR: rolleriniz olduğu gibi duruyor.",
    nextStep:
      "Keycloak'ta koala-admin-web client'ının audience mapper'ını açın (docs/keycloak-setup.md §4), sonra yeniden giriş yapın.",
    retry: false,
  },
  SESSION_EXPIRED: {
    title: "Oturumunuz sona erdi",
    description:
      "Oturum yenilenemedi, bu yüzden düşürüldü. Bayat bir token'la devam edilmesindense oturumun kapatılması tercih edilir.",
    nextStep: "Yeniden giriş yapın.",
    retry: true,
  },
  SESSION_REQUIRED: {
    title: "Giriş yapmanız gerekiyor",
    description: "Bu sayfa için açık bir oturum bulunamadı.",
    nextStep: "Yeniden giriş yapın.",
    retry: true,
  },
  ACCESS_DENIED: {
    title: "Keycloak girişi reddetti",
    description:
      "Keycloak giriş isteğini reddetti. Hesabınız devre dışı bırakılmış ya da art arda hatalı denemeden sonra geçici olarak kilitlenmiş olabilir (realm'de 5 hatalı denemeden sonra 15 dakika beklenir; kalıcı kilit yoktur).",
    nextStep: "15 dakika bekleyip tekrar deneyin ya da Keycloak yöneticisine başvurun.",
    retry: true,
  },
  UNKNOWN: {
    title: "Giriş tamamlanamadı",
    description: "Beklenmedik bir hata oluştu ve giriş akışı tamamlanamadı.",
    nextStep: "Yeniden deneyin; sürerse sunucu günlüklerine bakın.",
    retry: true,
  },
};

/**
 * Reachable without a session on purpose — it exists to explain why there isn't
 * one, and gating it would hide every message behind the failure it reports.
 *
 * Two query parameters, two vocabularies: `kod` is the panel's own
 * ({@link AuthFailureCode}, written by `src/proxy.ts`), `error` is Auth.js's,
 * which sends people here through `pages.error`.
 */
export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = resolveCode(params);
  const explanation = EXPLANATIONS[code];

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <ErrorState
        title={explanation.title}
        description={explanation.description}
        errorCode={code}
        action={
          <p className="text-sm text-ink">
            <span className="font-medium">Ne yapmalı: </span>
            {explanation.nextStep}
          </p>
        }
      />

      {explanation.retry ? (
        <Link
          href="/giris"
          className="self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Giriş sayfasına dön
        </Link>
      ) : null}
    </main>
  );
}

function resolveCode(params: Record<string, string | string[] | undefined>): AuthFailureCode {
  const own = params.kod;
  if (typeof own === "string" && isAuthFailureCode(own)) {
    return own;
  }

  const authjs = params.error;
  return fromAuthjsErrorCode(typeof authjs === "string" ? authjs : undefined);
}
