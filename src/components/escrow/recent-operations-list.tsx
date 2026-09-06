import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { RecordedOperation } from "@/server/escrow/recent-operations";

/**
 * "Son işlemler" — what this panel process did, and what the backend answered.
 *
 * Presentational and synchronous: it takes rows and renders them, so a test can
 * exercise it without a request. The caveat it prints is not decoration —
 * see `src/server/escrow/recent-operations.ts` for why this list is a screen
 * affordance and koala-backend#15's audit row is the record.
 */

const KIND_LABELS: Record<RecordedOperation["kind"], string> = {
  RESOLVE_DISPUTE: "Uyuşmazlık kararı",
  RELEASE: "İşçiye çıkış",
  REFUND: "İşverene iade",
};

export interface RecentOperationsListProps {
  operations: readonly RecordedOperation[];
}

export function RecentOperationsList({ operations }: RecentOperationsListProps) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="recent-operations-heading">
      <div className="flex flex-col gap-1">
        <h2 id="recent-operations-heading" className="text-lg font-semibold">
          Son işlemler
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Bu listeyi panel süreci bellekte tutar: yeniden başlatıldığında silinir ve başka bir panel
          örneğinde görünmez. Kalıcı kayıt backend&apos;in denetim kaydıdır (koala-backend#15);
          finansal işlemler orada 10 yıl saklanır. Buradaki her satır backend cevap verdikten sonra,
          backend&apos;in kendi cevabından yazılır.
        </p>
      </div>

      {operations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface px-4 py-6 text-sm text-ink-muted">
          Bu panel süreci henüz bir para hareketi yapmadı.
        </p>
      ) : (
        <Table caption="Bu panel sürecinin yaptığı son işlemler">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Zaman</TableHeaderCell>
              <TableHeaderCell>İşlem</TableHeaderCell>
              <TableHeaderCell>Sonuç</TableHeaderCell>
              <TableHeaderCell>Taraf</TableHeaderCell>
              <TableHeaderCell>Tutar</TableHeaderCell>
              <TableHeaderCell>Personel</TableHeaderCell>
              <TableHeaderCell>Gerekçe</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {operations.map((operation) => (
              <TableRow key={`${operation.operationKey}:${operation.at}`}>
                <TableCell>{formatDateTime(operation.at)}</TableCell>
                <TableCell>{KIND_LABELS[operation.kind]}</TableCell>
                <TableCell>
                  {operation.outcome === "SUCCEEDED" ? (
                    <Badge tone="success">Başarılı</Badge>
                  ) : (
                    <Badge tone="danger">Reddedildi</Badge>
                  )}
                  <span className="ml-2 text-xs text-ink-muted">{operation.message}</span>
                </TableCell>
                <TableCell>{operation.beneficiary ?? "—"}</TableCell>
                <TableCell>{operation.amountText ?? "—"}</TableCell>
                <TableCell>{operation.actor}</TableCell>
                <TableCell>
                  <span className="text-xs text-ink-muted">{operation.reason}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
