import type { Metadata } from "next";

import { signInWithKeycloak } from "@/server/auth/actions";

export const metadata: Metadata = { title: "Giriş" };

/**
 * One button.
 *
 * There is no password field, no "kayıt ol" link and no "parolamı unuttum" on
 * this page, and that is a decision rather than an omission. ADR-0010 puts
 * staff identity in Keycloak: passwords, MFA, lockout and account creation all
 * happen in its console. A password field here would either be a second place
 * to type a credential or a phishing target, and the realm has registration
 * switched off, so a sign-up link would lead to a refusal.
 *
 * A plain `<form>` posting to a Server Action, so the page ships no client
 * JavaScript at all.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Koala Yönetim Paneli</h1>
        <p className="text-sm text-ink-muted">
          Panele yalnız Koala personeli, kurumsal Keycloak hesabıyla girer.
        </p>
      </header>

      <form action={signInWithKeycloak.bind(null, callbackUrl)}>
        <button
          type="submit"
          className="w-full rounded-md bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Keycloak ile giriş yap
        </button>
      </form>

      <p className="text-xs text-ink-subtle">
        Parola, iki adımlı doğrulama ve hesap işlemleri Keycloak yönetim konsolunda yapılır; bu
        panelde karşılığı yoktur.
      </p>
    </main>
  );
}
