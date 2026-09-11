import type { Metadata } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { ErrorState } from "@/components/ui";
import { isKoalaApiError } from "@/server/api/errors";
import { getManagedJobCategories, type JobCategory } from "@/server/api/job-categories";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";

import { submitCategoryCreate, submitCategoryDelete, submitCategoryUpdate } from "./actions";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "İş kategorileri" };

/**
 * The `category.manage` screen — the entry a `CATALOG_EDITOR` sees, and the
 * only one they see.
 *
 * The fetch lives in the child element so the gate withholding it withholds
 * the authenticated management request too. Every mutation independently
 * repeats the permission decision in its Server Action.
 */
export default async function JobCategoriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="İş kategorileri"
        description={
          <>
            Pazaryerinin ilan kategorilerini oluşturun, düzenleyin veya silin.{" "}
            <code className="font-mono">category.manage</code> izni gerekir; başarılı değişiklikler
            backend denetim kaydına yazılır.
          </>
        }
      />

      <RequirePermission permission="category.manage">
        <JobCategoryTable />
      </RequirePermission>
    </div>
  );
}

async function JobCategoryTable() {
  let categories: JobCategory[];

  try {
    categories = await getManagedJobCategories(await getKoalaAccessToken());
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

  return (
    <CategoryManager
      categories={categories}
      createAction={submitCategoryCreate}
      updateAction={submitCategoryUpdate}
      deleteAction={submitCategoryDelete}
    />
  );
}
