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
import { formatInteger } from "@/lib/format";
import { isKoalaApiError } from "@/server/api/errors";
import { getJobCategories, type JobCategory } from "@/server/api/reference";
import { RequirePermission } from "@/server/authz/require-permission";

export const metadata: Metadata = { title: "İş kategorileri" };

/**
 * The `category.manage` screen — the entry a `CATALOG_EDITOR` sees, and the
 * only one they see.
 *
 * Editing arrives with koala-admin#6; this slice ships the read side behind the
 * gate so the permission has a real screen rather than a placeholder. As with
 * the audit log, the fetch lives in the child element so the gate withholding
 * it withholds the request too.
 */
export default async function JobCategoriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">İş kategorileri</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Pazaryerinin ilan kategorileri. <code className="font-mono">category.manage</code> izni
          gerektirir; düzenleme ekranı bir sonraki dilimde gelir.
        </p>
      </header>

      <RequirePermission permission="category.manage">
        <JobCategoryTable />
      </RequirePermission>
    </div>
  );
}

async function JobCategoryTable() {
  let categories: JobCategory[];

  try {
    categories = await getJobCategories();
  } catch (error) {
    return (
      <ErrorState
        title="Kategoriler yüklenemedi."
        description={
          isKoalaApiError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "Bilinmeyen bir hata oluştu."
        }
        errorCode={isKoalaApiError(error) ? error.errorCode : null}
        requestId={isKoalaApiError(error) ? error.requestId : null}
      />
    );
  }

  if (categories.length === 0) {
    return (
      <EmptyState
        title="Hiç iş kategorisi yok."
        description="Kategori seed'i ADR-0009 ile kaldırıldı. Boş veritabanında kategori olmadığı için ilan da açılamaz."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{formatInteger(categories.length)} kategori.</p>

      <Table caption="İş kategorileri">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Ad</TableHeaderCell>
            <TableHeaderCell>Kod</TableHeaderCell>
            <TableHeaderCell>Sigorta</TableHeaderCell>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
