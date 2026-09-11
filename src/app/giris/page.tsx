import type { Metadata } from "next";

import { AuthShell } from "@/components/panel/auth-shell";
import { ErrorState, FormField, TextInput } from "@/components/ui";
import { signInWithPassword } from "@/server/auth/actions";
import { isSignInFailureCode, type SignInFailureCode } from "@/server/auth/errors";

export const metadata: Metadata = { title: "Giriş" };

/**
 * E-posta ve parola.
 *
 * ADR-0014 personel kimliğini Koala'da tutuyor: parola `staff_members`
 * tablosunda, token'ı Koala üretiyor, ortada bir kimlik sağlayıcı yok. Bu
 * yüzden burada bir "kayıt ol" bağlantısı da yok — personel hesabını
 * `staff.manage` izni olan biri açar (is-koala/koala-admin#9) ve ilk `OWNER`
 * backend'in bootstrap değişkenleriyle doğar.
 *
 * **İki adımlı doğrulama yok**, ve bu ADR-0014'te açıkça kaydedilmiş bilinçli
 * bir gerilemedir: karşılığı hız sınırlayıcı ve hesap kilidi, ikisi de MFA'nın
 * yerini tutmuyor. Yeniden açılma koşulu da yazılı: panele sahibin dışında
 * ikinci bir kişi girdiği gün.
 *
 * Düz bir `<form>` bir Server Action'a POST ediyor, yani sayfa **hiç istemci
 * JavaScript'i göndermiyor**. Parola yazılan bir sayfada bu kolay
 * vazgeçilecek bir özellik değil; hata mesajlarının `useActionState` yerine
 * sorgu dizesinden gelmesinin sebebi de bu.
 */
const FAILURES: Record<SignInFailureCode, { title: string; description: string }> = {
  INVALID_CREDENTIALS: {
    title: "E-posta ya da parola hatalı",
    description:
      "Hangisinin yanlış olduğu bilerek söylenmiyor: aksi hâlde bu form, bir e-postanın panelde hesabı olup olmadığını sorabileceğiniz bir araca dönerdi. Art arda hatalı denemeden sonra hesap bir süre kilitlenir.",
  },
  TOO_MANY_ATTEMPTS: {
    title: "Çok fazla deneme yapıldı",
    description:
      "Giriş denemeleri hız sınırına takıldı. Bir süre bekleyip tekrar deneyin; hesabınızda bir sorun olduğu anlamına gelmez.",
  },
  BACKEND_UNREACHABLE: {
    title: "Koala'ya ulaşılamıyor",
    description:
      "Panel kimliği Koala backend'inden alır. Backend yanıt vermediği sürece kimse giremez — yetkinizle ya da parolanızla ilgili bir sorun değil.",
  },
  MISSING_FIELDS: {
    title: "E-posta ve parola gerekli",
    description: "İki alanı da doldurup tekrar deneyin.",
  },
  UNKNOWN: {
    title: "Giriş tamamlanamadı",
    description: "Beklenmedik bir hata oluştu. Tekrar deneyin; sürerse sunucu günlüklerine bakın.",
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;
  const failure = isSignInFailureCode(params.hata) ? FAILURES[params.hata] : null;
  const passwordChanged = params.bilgi === "PASSWORD_CHANGED";

  return (
    <AuthShell>
      <main className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Koala Yönetim Paneli</h1>
          <p className="text-sm text-ink-muted">
            Panele yalnız Koala personeli, kendi e-postası ve parolasıyla girer.
          </p>
        </header>

        {passwordChanged ? (
          <p
            role="status"
            className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-sm text-ink"
          >
            Parolanız değiştirildi. Açık bütün oturumlar kapatıldı; yeni parolanızla girin.
          </p>
        ) : null}

        {failure ? <ErrorState title={failure.title} description={failure.description} /> : null}

        <form
          action={signInWithPassword.bind(null, callbackUrl)}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField id="email" label="E-posta" required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          <FormField id="password" label="Parola" required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>

          <button
            type="submit"
            className="mt-2 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-brand hover:bg-brand-strong"
          >
            Giriş yap
          </button>
        </form>

        <p className="text-xs text-ink-subtle">
          Parolanızı unuttuysanız personel yönetimi izni olan bir çalışandan sıfırlamasını isteyin:
          e-postayla sıfırlama akışı bilerek yazılmadı. Yönetici yeni bir parola atar, siz ilk
          girişte değiştirirsiniz.
        </p>
      </main>
    </AuthShell>
  );
}
