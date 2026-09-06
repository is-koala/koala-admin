import type { Metadata } from "next";

import {
  Badge,
  EmptyState,
  ErrorState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatDateTime, formatInteger } from "@/lib/format";
import { isKoalaApiError } from "@/server/api/errors";
import { getJobCategories, type JobCategory } from "@/server/api/reference";

export const metadata: Metadata = {
  title: "İş kategorileri (doğrulama)",
};

/**
 * The request must actually hit the backend on every view — a prerendered
 * snapshot would verify nothing, and would also require the API to be reachable
 * during `next build`.
 */
export const dynamic = "force-dynamic";

/**
 * Verification page for the server-side API layer.
 *
 * `GET /reference/job-categories` is genuinely unauthenticated
 * (`webAPI/ReferenceDataController.java:104`, permitted by
 * `SecurityConfig.java:128`), so this proves the envelope unwrapping, the
 * header set and the base URL wiring without touching identity — which is
 * issue #4's job — or any `/admin/**` endpoint.
 *
 * The fetch happens here, on the server. Nothing about `KOALA_API_BASE_URL`,
 * the request or the response envelope reaches the browser; only the rendered
 * table does.
 */
export default async function JobCategoriesVerificationPage() {
  const result = await loadJobCategories();

  return (
    /* The panel shell supplies <main>, the sidebar and the "← Panel" way back,
       so this page renders a plain section inside it. */
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">İş kategorileri (doğrulama)</h1>
        <p className="text-sm text-ink-muted">
          Sunucudan <code className="font-mono">GET /reference/job-categories</code> çağrılır;
          tarayıcı backend&apos;e hiç istek atmaz. Sayfa {formatDateTime(new Date())} itibarıyla
          oluşturuldu.
        </p>
      </header>

      {result.ok ? <CategoriesResult categories={result.categories} /> : <Failure {...result} />}
    </div>
  );
}

type LoadResult =
  | { ok: true; categories: JobCategory[] }
  | {
      ok: false;
      title: string;
      description: string;
      errorCode: string | null;
      requestId: string | null;
    };

async function loadJobCategories(): Promise<LoadResult> {
  try {
    return { ok: true, categories: await getJobCategories() };
  } catch (error) {
    // A verification page whose whole point is the API layer must survive the
    // API being down: show what went wrong, do not throw a 500 at the operator.
    if (isKoalaApiError(error)) {
      return {
        ok: false,
        title: "Kategoriler yüklenemedi.",
        description: error.message,
        errorCode: error.errorCode,
        requestId: error.requestId,
      };
    }

    return {
      ok: false,
      title: "Kategoriler yüklenemedi.",
      description: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.",
      errorCode: null,
      requestId: null,
    };
  }
}

function Failure({ title, description, errorCode, requestId }: Extract<LoadResult, { ok: false }>) {
  return (
    <ErrorState
      title={title}
      description={description}
      errorCode={errorCode}
      requestId={requestId}
    />
  );
}

function CategoriesResult({ categories }: { categories: JobCategory[] }) {
  if (categories.length === 0) {
    return (
      <EmptyState
        title="Hiç iş kategorisi yok."
        description="Kategori seed'i ADR-0009 ile kaldırıldı. Boş veritabanında kategori olmadığı için ilan da açılamaz; kategori yönetimi ekranı bu boşluğu doldurur."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{formatInteger(categories.length)} kategori.</p>

      <Table caption="Backend'den dönen iş kategorileri">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Ad</TableHeaderCell>
            <TableHeaderCell>Kod</TableHeaderCell>
            <TableHeaderCell>Sigorta</TableHeaderCell>
            <TableHeaderCell>Kimlik</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.id}>
              <TableCell>{category.name}</TableCell>
              <TableCell>
                <span className="font-mono text-xs">{category.code}</span>
              </TableCell>
              <TableCell>
                {category.requiresInsurance ? (
                  <Badge tone="warning">Zorunlu</Badge>
                ) : (
                  <Badge>Gerekmiyor</Badge>
                )}
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-ink-subtle">{category.id}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
