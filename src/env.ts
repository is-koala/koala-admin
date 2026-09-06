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
   * The panel's own public origin. Auth.js builds the OAuth `redirect_uri` and
   * the post-logout return URL from it, and Keycloak compares both against the
   * realm's allow-list — a mismatch is answered with `invalid_redirect_uri` and
   * no explanation, so this is validated here rather than discovered in a
   * Keycloak error page.
   *
   * It also decides whether the session cookie is marked `Secure`
   * (`src/server/auth/cookies.ts`).
   */
  AUTH_URL: absoluteUrl({
    required: "zorunlu (panelin dış adresi, ör. http://localhost:3000)",
    localhostOnlyHttp: true,
  }),

  /**
   * Key the session cookie is encrypted with. 32 bytes of randomness:
   * `openssl rand -base64 32`.
   *
   * The cookie is a JWE, not a signed-but-readable JWT: whoever holds this
   * value can read the Keycloak tokens inside it, so it is a real secret and
   * never a `NEXT_PUBLIC_*`.
   */
  AUTH_SECRET: z
    .string({ error: "zorunlu (openssl rand -base64 32)" })
    .min(32, "en az 32 karakter olmalı (openssl rand -base64 32)"),

  /** `https://auth.iskoala.com/realms/koala-staff` (docs/keycloak-setup.md §7). */
  KEYCLOAK_ISSUER: absoluteUrl({
    required: "zorunlu (ör. https://auth.iskoala.com/realms/koala-staff)",
    localhostOnlyHttp: true,
  }),

  KEYCLOAK_CLIENT_ID: z.string().min(1, "boş olamaz").default("koala-admin-web"),

  /**
   * The confidential client's secret. Server-side only — it never reaches a
   * `NEXT_PUBLIC_*` variable, the browser bundle, or a tracked file.
   */
  KEYCLOAK_CLIENT_SECRET: z
    .string({ error: "zorunlu (Keycloak → Clients → koala-admin-web → Credentials)" })
    .min(1, "boş olamaz"),

  /**
   * Audience the access token must carry, produced by the realm's audience
   * mapper (docs/keycloak-setup.md §4). The panel checks every token against
   * this before using it: without the mapper the backend answers 401, and a
   * 401 is indistinguishable from "you lack permission" unless the panel knows
   * what the audience was supposed to be.
   */
  KOALA_API_AUDIENCE: z.string().min(1, "boş olamaz").default("koala-api"),

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
 * `localhostOnlyHttp` marks the variables that address a service which must be
 * behind TLS in production but is a plain-HTTP container during development —
 * Keycloak and the panel's own origin. Plain HTTP against anything but
 * localhost would silently put the client secret, the authorization code and
 * the session cookie on the wire in the clear, so it is rejected rather than
 * merely discouraged.
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
