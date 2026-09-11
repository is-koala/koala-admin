import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/panel/auth-shell";
import { ErrorState } from "@/components/ui";
import { isAuthFailureCode, type AuthFailureCode } from "@/server/auth/errors";

export const metadata: Metadata = { title: "Giriş yapılamadı" };

interface Explanation {
  readonly title: string;
  readonly description: string;
  /** What the person reading this can actually do next. */
  readonly nextStep: string;
  readonly retry: boolean;
}

/**
 * Bu sayfanın bütün anlamı, bu maddelerin **aynı mesaj olmaması**.
 *
 * Hepsine "giriş yapılamadı" diyen bir panel, backend düştüğünde insanı
 * parolasını sorgulamaya, parola değiştirmesi gerektiğinde ise rol aramaya
 * gönderir. Aşağıdaki her madde gerçekten bozuk olan şeyi ve onu kimin
 * düzeltebileceğini adıyla söyler.
 */
const EXPLANATIONS: Record<AuthFailureCode, Explanation> = {
  BACKEND_UNREACHABLE: {
    title: "Koala'ya ulaşılamıyor",
    description:
      "Panel kimliği de yetkiyi de Koala backend'inden alır; başka bir giriş yolu yoktur. Backend yanıt vermediği sürece panele kimse giremez. Yetkinizle ya da hesabınızla ilgili bir sorun değil.",
    nextStep: "Koala backend'inin ayakta olduğunu doğrulayın, sonra tekrar deneyin.",
    retry: true,
  },
  PASSWORD_CHANGE_REQUIRED: {
    title: "Önce parolanızı değiştirmelisiniz",
    description:
      'Hesabınız "ilk girişte parola değiştir" işaretiyle açılmış. Bu işaret inene kadar backend panelin bütün uçlarını reddeder. Bu bir yetki eksikliği DEĞİLDİR: rolleriniz olduğu gibi duruyor.',
    nextStep: "Parola değiştirme ekranına gidip yeni bir parola belirleyin.",
    retry: false,
  },
  SESSION_EXPIRED: {
    title: "Oturumunuz sona erdi",
    description:
      "Oturum yenilenemedi, bu yüzden düşürüldü. Parolanızı değiştirdiyseniz ya da bir yönetici hesabınızı devre dışı bıraktıysa bu beklenen sonuçtur — ikisi de açık bütün token'ları anında geçersiz kılar.",
    nextStep: "Yeniden giriş yapın.",
    retry: true,
  },
  SESSION_REQUIRED: {
    title: "Giriş yapmanız gerekiyor",
    description: "Bu sayfa için açık bir oturum bulunamadı.",
    nextStep: "Yeniden giriş yapın.",
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
 * Oturum olmadan ulaşılabilir olması bilinçli — bu sayfa zaten oturumun neden
 * olmadığını anlatmak için var, ve kapatmak her mesajı bildirmeye çalıştığı
 * hatanın arkasına saklardı.
 *
 * Tek sorgu parametresi: `kod` ({@link AuthFailureCode}). Auth.js'in kendi
 * hata kelime dağarcığı ADR-0014 ile birlikte kalktı.
 */
export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code: AuthFailureCode = isAuthFailureCode(params.kod) ? params.kod : "UNKNOWN";
  const explanation = EXPLANATIONS[code];

  return (
    <AuthShell>
      <main className="flex flex-col gap-6">
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

        {code === "PASSWORD_CHANGE_REQUIRED" ? (
          <Link
            href="/giris/parola"
            className="self-start rounded-sm bg-brand px-4 py-2 text-sm font-medium text-surface hover:bg-brand-strong"
          >
            Parola değiştirme ekranına git
          </Link>
        ) : null}

        {explanation.retry ? (
          <Link
            href="/giris"
            className="self-start rounded-sm bg-brand px-4 py-2 text-sm font-medium text-surface hover:bg-brand-strong"
          >
            Giriş sayfasına dön
          </Link>
        ) : null}
      </main>
    </AuthShell>
  );
}
