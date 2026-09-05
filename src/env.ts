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
  KOALA_API_BASE_URL: z
    .string()
    .min(1, "zorunlu")
    .refine((value) => URL.canParse(value), "geçerli bir mutlak URL olmalı")
    .refine(
      (value) => ["http:", "https:"].includes(new URL(value).protocol),
      "http ya da https olmalı",
    )
    // Normalise so callers can always join with a leading-slash path.
    .transform((value) => value.replace(/\/+$/, "")),

  /** Hard ceiling for a single backend round trip, in milliseconds. */
  KOALA_API_TIMEOUT_MS: z.coerce
    .number()
    .int("tam sayı olmalı")
    .positive("pozitif olmalı")
    .max(120_000, "en fazla 120000 olabilir")
    .default(15_000),

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
