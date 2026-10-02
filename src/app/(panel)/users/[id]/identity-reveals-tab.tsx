import Link from "next/link";

import { QueueLoadFailure, QueuePager, type QueueFailure } from "@/components/panel/queue";
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTimeSeconds } from "@/lib/format";
import { assignmentHref, jobHref, userHref, userTabHref } from "@/lib/panel-href";
import { shortId } from "@/lib/short-id";
import { USER_TAB_PARAM, USER_TAB_SPECS } from "@/lib/user-tabs";
import {
  getIdentityReveals,
  IDENTITY_REVEAL_PAGE_PARAM,
  type IdentityReveal,
} from "@/server/api/identity-reveals";
import { pageWindow, type Paging } from "@/server/api/paging";
import type { PageDto } from "@/server/api/types";
import { classifyQueueFailure } from "@/server/queue/decisions";

/**
 * `kimlik` sekmesi (koala-admin#128): bu işçinin kimlik bilgilerini (TCKN)
 * hangi işverenin ne zaman görüntülediği. `GET /admin/users/{id}/identity-reveals`
 * `user.read_pii` ister — sekmenin kapısı `USER_TAB_SPECS.kimlik.permission`,
 * sayfa izinsizde bu bileşeni hiç çizmez ve istek çıkmaz. Backend her okumada
 * denetim satırı yazdığı için liste yalnız bu sekme seçiliyken istenir.
 *
 * Sayfalama sunucuda ve sekmenin kendi anahtarıyla (`kimlik-sayfa`, bkz.
 * `IDENTITY_REVEAL_PAGE_PARAM`): bu ucun "Tümünü aç" diyeceği ayrı bir liste
 * sayfası yok, satırların hepsi burada sayfalanır. Yükleniyor göstergesi bu
 * sekmeye özgü değil: rota düzeyindeki `users/loading.tsx` kullanıcı sayfası
 * ilk açılırken çalışır; aynı sayfada yalnız `?sekme=`/`kimlik-sayfa` değişen
 * gezintide görünmesi beklenmez, diğer sekmelerle aynı davranış.
 *
 * Bağlantılar kendi izinleriyle verilir: ilan `job.read`, atama
 * `payment.read`; görüntüleyenin kullanıcı sayfası `user.read` ister ve bu
 * sayfanın kendi kapısı o. DTO'da şirket kimliği yok, görüntüleyen işverenin
 * şirket sayfasına bu ekrandan gidilmez.
 */

type RevealsResult =
  { ok: true; page: PageDto<IdentityReveal> } | { ok: false; failure: QueueFailure };

async function loadReveals(
  accessToken: string,
  userId: string,
  paging: Paging,
): Promise<RevealsResult> {
  try {
    return { ok: true, page: await getIdentityReveals(accessToken, userId, paging) };
  } catch (error) {
    return { ok: false, failure: classifyQueueFailure(error) };
  }
}

export async function IdentityRevealsTab({
  accessToken,
  userId,
  paging,
  canOpenJob,
  canOpenAssignment,
}: {
  accessToken: string;
  userId: string;
  paging: Paging;
  /** `job.read` — ilan başlığı `/jobs/{id}`'ye bağlanır. */
  canOpenJob: boolean;
  /** `payment.read` — atama kimliği `/assignments/{id}`'ye bağlanır. */
  canOpenAssignment: boolean;
}) {
  const result = await loadReveals(accessToken, userId, paging);

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="user-identity-reveals-heading"
      data-testid="user-identity-reveals"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="user-identity-reveals-heading" className="text-sm font-semibold">
          Kimlik görüntüleme kayıtları
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          İşverenlerin bu kullanıcının kimlik bilgilerini (TC kimlik numarası) görüntüleme
          kayıtları, yeniden eskiye. TC kimlik numarasının kendisi bu uçta yoktur, IP maskelidir. Bu
          okuma kişisel veri denetim kaydına düşer.
        </p>
      </div>

      {!result.ok ? (
        <QueueLoadFailure
          subject="Kimlik görüntüleme kayıtları"
          permission={USER_TAB_SPECS.kimlik.permission}
          failure={result.failure}
        />
      ) : (
        <>
          {result.page.content.length === 0 ? (
            // Boş sayfa iki şey olabilir: hiç kayıt yok ya da sayfa sondan sonra.
            // İkincisinde "Önceki" yalnız bir sayfa geri gider ve o da boş kalabilir:
            // ilk sayfaya doğrudan bağlantı ve sayfalayıcı birlikte durur.
            result.page.totalElements === 0 ? (
              <EmptyState title="Bu kullanıcının kimliğini henüz kimse görüntülememiş." />
            ) : (
              <EmptyState
                title="Bu sayfada kayıt yok."
                action={
                  <Link
                    href={userTabHref(userId, "kimlik")}
                    className="text-sm font-medium text-brand hover:underline"
                    data-testid="user-identity-reveals-first-page"
                  >
                    İlk sayfaya dön
                  </Link>
                }
              />
            )
          ) : (
            <IdentityRevealTable
              rows={result.page.content}
              canOpenJob={canOpenJob}
              canOpenAssignment={canOpenAssignment}
            />
          )}
          {result.page.totalElements === 0 ? null : (
            <QueuePager
              window={pageWindow(result.page)}
              state={{ [USER_TAB_PARAM]: "kimlik" }}
              unit="kayıt"
              pageParam={IDENTITY_REVEAL_PAGE_PARAM}
            />
          )}
        </>
      )}
    </section>
  );
}

function IdentityRevealTable({
  rows,
  canOpenJob,
  canOpenAssignment,
}: {
  rows: readonly IdentityReveal[];
  canOpenJob: boolean;
  canOpenAssignment: boolean;
}) {
  return (
    <Table caption="Kimlik görüntüleme kayıtları">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Görüntüleme zamanı</TableHeaderCell>
          <TableHeaderCell>Görüntüleyen</TableHeaderCell>
          <TableHeaderCell>İlan</TableHeaderCell>
          <TableHeaderCell>Atama</TableHeaderCell>
          <TableHeaderCell>IP (maskeli)</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            {/* Kanıt satırı: saniye de yazılır, aynı dakikadaki iki bakış tek satıra çökmesin. */}
            <TableCell>{formatDateTimeSeconds(row.revealedAt)}</TableCell>
            <TableCell>
              <Viewer row={row} />
            </TableCell>
            <TableCell>
              {canOpenJob ? (
                <Link href={jobHref(row.jobId)} className="text-brand hover:underline">
                  {row.jobTitle ?? shortId(row.jobId)}
                </Link>
              ) : (
                (row.jobTitle ?? shortId(row.jobId))
              )}
            </TableCell>
            <TableCell>
              {canOpenAssignment ? (
                <Link
                  href={assignmentHref(row.jobAssignmentId)}
                  title={row.jobAssignmentId}
                  className="font-mono text-xs text-brand hover:underline"
                >
                  {shortId(row.jobAssignmentId)}
                </Link>
              ) : (
                <span className="font-mono text-xs" title={row.jobAssignmentId}>
                  {shortId(row.jobAssignmentId)}
                </span>
              )}
            </TableCell>
            <TableCell>
              <span className="font-mono text-xs">{row.ipAddress ?? EMPTY_VALUE}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Görüntüleyen işveren. Backend adı iki durumda `null` döner: hesap silinmiş ya
 * da canlı hesabın iki adı da boş (`DisplayNames.of`); satırdan hangisi olduğu
 * anlaşılmaz. O yüzden ikisini de söyleyen bir cümle yazılır ve tam kimlik —
 * kayda geri dönmenin tek tutamağı — kullanıcı sayfasına bağlı kalır: hesap
 * silinmişse o sayfa zaten 404 ekranını gösterir, bağlantıyı panel eleyemez.
 */
function Viewer({ row }: { row: IdentityReveal }) {
  const href = userHref(row.viewerId);

  if (row.viewerFullName === null) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="text-ink-muted">Adı yok ya da hesap silinmiş</span>
        <Link href={href} className="font-mono text-xs break-all text-brand hover:underline">
          {row.viewerId}
        </Link>
      </span>
    );
  }

  return (
    <Link href={href} className="text-brand hover:underline">
      {row.viewerFullName}
    </Link>
  );
}
