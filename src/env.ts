import "server-only";

import { z } from "zod";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"];

type HttpOriginPolicy = "allow" | "local-only";

type StrictRootOriginResult =
  | { readonly ok: true; readonly origin: string }
  | {
      readonly ok: false;
      readonly reason:
        | "control-character"
        | "invalid-url"
        | "protocol"
        | "credentials"
        | "root-syntax"
        | "insecure-http";
    };

const ROOT_ORIGIN_ERROR_MESSAGES: Record<
  Exclude<StrictRootOriginResult, { ok: true }>["reason"],
  string
> = {
  "control-character": "TAB, CR ya da LF içermemeli",
  "invalid-url": "geçerli bir mutlak URL olmalı",
  protocol: "http ya da https olmalı",
  credentials: "kullanıcı adı ya da parola içermemeli",
  "root-syntax": "yalnız kök origin (şema + host + opsiyonel port) olmalı",
  "insecure-http": "localhost dışında https olmalı",
};

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
  // `httpPolicy: "allow"`: the backend is reached server-to-server, often over
  // a private network, so plain http is a deployment choice rather than a leak.
  KOALA_API_BASE_URL: canonicalRootOrigin({
    required: "zorunlu (.env.local içinde tanımlayın)",
    httpPolicy: "allow",
  }),

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
  ADMIN_PUBLIC_ORIGIN: canonicalRootOrigin({
    required: "zorunlu (panelin dış adresi, ör. http://localhost:3000)",
    httpPolicy: "local-only",
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
 * A root `http(s)` origin in canonical form: lower-case scheme/host, no
 * credentials, path, query, fragment or trailing slash, and a non-default port
 * retained. Callers can therefore append a leading-slash path without URL
 * components from configuration changing that path.
 *
 * `httpPolicy: "local-only"` marks a variable addressing something that must be
 * behind TLS in production but is plain HTTP during development — today only
 * the panel's own origin. Plain HTTP anywhere but localhost would put the
 * session cookie, and with it a staff access token, on the wire in the clear,
 * so it is rejected rather than merely discouraged.
 */
function canonicalRootOrigin(options: { required: string; httpPolicy: HttpOriginPolicy }) {
  return z
    .string({ error: options.required })
    .min(1, "boş olamaz")
    .transform((value, context) => {
      const result = parseStrictRootOrigin(value, options.httpPolicy);
      if (!result.ok) {
        context.addIssue({ code: "custom", message: ROOT_ORIGIN_ERROR_MESSAGES[result.reason] });
        return z.NEVER;
      }
      return result.origin;
    });
}

function parseStrictRootOrigin(
  value: string,
  httpPolicy: HttpOriginPolicy,
): StrictRootOriginResult {
  const trimmed = value.trim();
  if (/[\t\r\n]/.test(trimmed)) return { ok: false, reason: "control-character" };
  if (!URL.canParse(trimmed)) return { ok: false, reason: "invalid-url" };

  const url = new URL(trimmed);
  if (!["http:", "https:"].includes(url.protocol)) return { ok: false, reason: "protocol" };

  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd < 0) return { ok: false, reason: "root-syntax" };

  const authorityAndSuffix = trimmed.slice(schemeEnd + 3);
  const suffixStart = authorityAndSuffix.search(/[\\/?#]/);
  const authority = suffixStart < 0 ? authorityAndSuffix : authorityAndSuffix.slice(0, suffixStart);

  if (authority.includes("@") || url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: "credentials" };
  }
  if (authority.endsWith(":")) return { ok: false, reason: "root-syntax" };

  const suffix = suffixStart < 0 ? "" : authorityAndSuffix.slice(suffixStart);
  if (suffix !== "" && suffix !== "/") return { ok: false, reason: "root-syntax" };

  if (
    httpPolicy === "local-only" &&
    url.protocol === "http:" &&
    !LOCAL_HOSTS.includes(url.hostname)
  ) {
    return { ok: false, reason: "insecure-http" };
  }

  return { ok: true, origin: url.origin };
}

function originAllowlist() {
  return z
    .string()
    .default("")
    .transform((value, context) => {
      const origins: string[] = [];

      for (const candidate of value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        const result = parseStrictRootOrigin(candidate, "local-only");
        if (!result.ok) {
          context.addIssue({
            code: "custom",
            message:
              result.reason === "invalid-url"
                ? "geçerli bir mutlak URL olmalı"
                : "yalnız güvenli origin (şema + host + opsiyonel port) olmalı",
          });
          return z.NEVER;
        }

        origins.push(result.origin);
      }

      return [...new Set(origins)];
    });
}
