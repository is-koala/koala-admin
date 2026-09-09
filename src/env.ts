import "server-only";

import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * Every value here is read on the Next.js server only. Nothing in this file is
 * prefixed with `NEXT_PUBLIC_`, so nothing here can ever reach the browser
 * bundle — which is the point: the browser never talks to the Koala API
 * directly, so it has no business knowing where the API lives.
 *
 * Validation is deliberately fail-fast. `src/instrumentation.ts` imports this
 * module during server startup, so a missing or malformed variable stops the
 * process with a readable error instead of letting the app half-boot and fail
 * later on the first request.
 */
const serverEnvSchema = z.object({
  /**
   * Root of the Koala backend. The backend has no servlet context-path;
   * endpoints are served from the root (`/reference/job-categories`, ...).
   *
   * Local:      http://localhost:8080
   * Production: https://api.iskoala.com
   */
  // Custom `required` message so an unset variable reads as "zorunlu" rather
  // than zod's "expected string, received undefined" — the person hitting this
  // is usually setting the project up for the first time.
  //
  // No `localhostOnlyHttp`: the backend is reached server-to-server, often over
  // a private network, so plain http is a deployment choice rather than a leak.
  KOALA_API_BASE_URL: absoluteUrl({ required: "zorunlu (.env.local içinde tanımlayın)" }),

  /** Hard ceiling for a single backend round trip, in milliseconds. */
  KOALA_API_TIMEOUT_MS: z.coerce
    .number()
    .int("tam sayı olmalı")
    .positive("pozitif olmalı")
    .max(120_000, "en fazla 120000 olabilir")
    .default(15_000),

  /**
   * Origins the evidence-download BFF may server-follow after the backend
   * returns a signed redirect. Empty is fail-closed and still supports the
   * local-storage 200 stream contract.
   */
  EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS: originAllowlist(),

  /**
   * The panel's own public origin.
   *
   * One job left, and it is not cosmetic: it decides whether the session cookie
   * is marked `Secure` (`src/server/auth/cookies.ts`). A `Secure` cookie is not
   * stored at all over plain HTTP, so an `http://admin.iskoala.com` would not
   * fail loudly — nobody could sign in and the reason would be invisible. This
   * variable is validated instead, so that deployment never boots.
   *
   * Named after what it is rather than after the auth library that used to read
   * an `AUTH_URL` to build an OIDC `redirect_uri`. There is no redirect any
   * more: ADR-0014 dropped the identity provider and the panel signs people in
   * itself.
   */
  ADMIN_PUBLIC_ORIGIN: absoluteUrl({
    required: "zorunlu (panelin dış adresi, ör. http://localhost:3000)",
    localhostOnlyHttp: true,
  }),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";

  constructor(readonly issues: readonly string[]) {
    super(
      [
        "Ortam değişkenleri doğrulanamadı; uygulama başlatılmadı.",
        ...issues.map((issue) => `  - ${issue}`),
        "",
        "`.env.example` dosyasını `.env.local` olarak kopyalayıp doldurun.",
      ].join("\n"),
    );
  }
}

/**
 * Pure, testable validator. Exported so a test can prove that a missing
 * required variable produces a readable failure rather than `undefined`
 * leaking into a fetch call.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.join(".") || "(kök)";
        return `${path}: ${issue.message}`;
      }),
    );
  }

  return result.data;
}

export const env: ServerEnv = parseServerEnv(process.env);

/**
 * An absolute `http(s)` URL with any trailing slash removed, so callers can
 * always append a leading-slash path.
 *
 * `localhostOnlyHttp` marks a variable addressing something that must be behind
 * TLS in production but is plain HTTP during development — today only the
 * panel's own origin. Plain HTTP anywhere but localhost would put the session
 * cookie, and with it a staff access token, on the wire in the clear, so it is
 * rejected rather than merely discouraged.
 */
function absoluteUrl(options: { required: string; localhostOnlyHttp?: boolean }) {
  const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"];

  return (
    z
      .string({ error: options.required })
      .min(1, "boş olamaz")
      // `abort` so the checks below never run `new URL` on a string that already
      // failed to parse.
      .refine((value) => URL.canParse(value), {
        error: "geçerli bir mutlak URL olmalı",
        abort: true,
      })
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        error: "http ya da https olmalı",
        abort: true,
      })
      .refine(
        (value) =>
          options.localhostOnlyHttp !== true ||
          new URL(value).protocol === "https:" ||
          LOCAL_HOSTS.includes(new URL(value).hostname),
        "localhost dışında https olmalı",
      )
      .transform((value) => value.replace(/\/+$/, ""))
  );
}

function originAllowlist() {
  const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"];

  return z
    .string()
    .default("")
    .transform((value, context) => {
      const origins: string[] = [];

      for (const candidate of value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        if (!URL.canParse(candidate)) {
          context.addIssue({
            code: "custom",
            message: `${candidate}: geçerli bir mutlak URL olmalı`,
          });
          return z.NEVER;
        }

        const url = new URL(candidate);
        const isSecure = url.protocol === "https:";
        const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname);
        if (
          (!isSecure && !isLocalHttp) ||
          url.username.length > 0 ||
          url.password.length > 0 ||
          url.pathname !== "/" ||
          url.search.length > 0 ||
          url.hash.length > 0
        ) {
          context.addIssue({
            code: "custom",
            message: `${candidate}: yalnız güvenli origin (şema + host + opsiyonel port) olmalı`,
          });
          return z.NEVER;
        }

        origins.push(url.origin);
      }

      return [...new Set(origins)];
    });
}
