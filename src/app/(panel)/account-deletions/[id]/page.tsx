import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { accountDeletionsHref, isUuid } from "@/lib/panel-href";
import { getAccountDeletion } from "@/server/api/account-deletions";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { DeletionReviewBody, DeletionStatusBadge } from "../deletion-detail";

export const metadata: Metadata = { title: "Hesap silme talebi" };

const QUEUE_KEYS = ["durum", "sirala", "boyut", "sayfa"] as const;

function queueReturnTo(params: SearchParams): Route {
  const state: Record<string, string> = {};
  for (const key of QUEUE_KEYS) {
    const value = readParam(params, key);
    if (value !== null && value.length > 0) state[key] = value;
  }
  return accountDeletionsHref(state);
}

/**
 * Hesap silme nesne sayfası. Ret burada; kuyruk yalnız listeler.
 * GET /admin/account-deletions/{id}. Kapı `user.read_pii`. Ret ayrıca
 * `user.deletion.manage` ister — form ve Server Action.
 */
export default async function AccountDeletionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = queueReturnTo(query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hesap silme talebi"
        description={
          <>
            Anonimleştirme zamanlayıcı işidir — panel onaylamaz, yalnız reddeder.{" "}
            <Link href={returnTo} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="user.read_pii">
        <DeletionObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function DeletionObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const canReject = (await getStaffContext()).has("user.deletion.manage");

  let row;
  try {
    row = await getAccountDeletion(await getKoalaAccessToken(), id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Hesap silme talebi"
        permission="user.read_pii"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-lg font-semibold">{row.id.slice(0, 8)}</h2>
        <DeletionStatusBadge status={row.status} />
      </div>
      <DeletionReviewBody row={row} canReject={canReject} />
    </section>
  );
}
