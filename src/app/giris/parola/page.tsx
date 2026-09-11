import type { Metadata } from "next";

import { AuthShell } from "@/components/panel/auth-shell";
import { ErrorState, FormField, TextInput } from "@/components/ui";
import { changeOwnPassword } from "@/server/auth/actions";
import { isPasswordChangeFailureCode, type PasswordChangeFailureCode } from "@/server/auth/errors";

export const metadata: Metadata = { title: "Parola değiştirme" };

/**
 * İlk girişte parola değiştirme ekranı.
 *
 * Bu sayfanın var olma sebebi bir tavuk-yumurta: backend, hesapta "ilk girişte
 * değiştir" bayrağı varken `/admin/**`'ın tamamını 403'le reddediyor —
 * `/admin/me` dâhil (`StaffPermissionAuthorizationManager.decideForStaff`).
 * Yani bootstrap ile doğan ilk `OWNER` giriş yapabilir ama panelde hiçbir şey
 * göremez, ve panel ona "personel kaydınız yok" diye yanlış bir sebep söyler.
 * Bu ekran o kilidin tek anahtarı: `POST /admin/auth/password` izin denetimine
 * değil doğrudan `STAFF_AUTHORITY`'ye bağlı olduğu için bayrak açıkken de
 * çalışır.
 *
 * Yeni parolanın kurallarını backend koyar (`@ValidPassword`, marketplace ile
 * ortak politika). Panel onları burada tekrarlamıyor: iki yerde yazılı bir
 * kural, sessizce ayrışan iki kuraldır — reddedilirse backend'in mesajı
 * gösterilir.
 */
const FAILURES: Record<PasswordChangeFailureCode, { title: string; description: string }> = {
  CURRENT_PASSWORD_WRONG: {
    title: "Mevcut parola hatalı",
    description: "Şu an kullandığınız parolayı yazın; yeni parolayı değil.",
  },
  PASSWORD_UNCHANGED: {
    title: "Yeni parola eskisiyle aynı",
    description: "Bayrağın inmesi için parolanın gerçekten değişmesi gerekiyor.",
  },
  PASSWORD_REJECTED: {
    title: "Yeni parola kabul edilmedi",
    description:
      "Parola, Koala'nın parola politikasını geçmedi. Daha uzun ve harf/rakam çeşitliliği olan bir parola deneyin.",
  },
  MISMATCH: {
    title: "İki yeni parola alanı aynı değil",
    description: "Yeni parolayı iki kutuya da aynı yazın.",
  },
  MISSING_FIELDS: {
    title: "Bütün alanlar gerekli",
    description: "Mevcut parolanızı ve yeni parolanızı doldurun.",
  },
  BACKEND_UNREACHABLE: {
    title: "Koala'ya ulaşılamıyor",
    description: "Backend yanıt vermiyor. Bir süre sonra tekrar deneyin.",
  },
  UNKNOWN: {
    title: "Parola değiştirilemedi",
    description: "Beklenmedik bir hata oluştu. Tekrar deneyin; sürerse sunucu günlüklerine bakın.",
  },
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const failure = isPasswordChangeFailureCode(params.hata) ? FAILURES[params.hata] : null;

  return (
    <AuthShell>
      <main className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Parolanızı değiştirin</h1>
          <p className="text-sm text-ink-muted">
            Hesabınız &quot;ilk girişte parola değiştir&quot; işaretiyle açıldı. Bu adım
            tamamlanmadan panelin hiçbir ekranı çalışmaz; kararı backend verir, bu sayfa yalnız
            gerekeni sorar.
          </p>
        </header>

        {failure ? <ErrorState title={failure.title} description={failure.description} /> : null}

        <form action={changeOwnPassword} className="flex flex-col gap-4" noValidate>
          <FormField id="currentPassword" label="Mevcut parola" required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          <FormField id="newPassword" label="Yeni parola" required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          <FormField id="newPasswordRepeat" label="Yeni parola (tekrar)" required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="newPasswordRepeat"
                type="password"
                autoComplete="new-password"
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          <button
            type="submit"
            className="mt-2 w-full rounded-sm bg-brand px-4 py-2.5 text-sm font-medium text-surface hover:bg-brand-strong"
          >
            Parolayı değiştir
          </button>
        </form>

        <p className="text-xs text-ink-subtle">
          Parola değiştiğinde açık bütün oturumlarınız kapatılır ve yeniden giriş yapmanız istenir —
          backend token sürümünü artırdığı için elinizdeki token o anda geçersizleşir.
        </p>
      </main>
    </AuthShell>
  );
}
