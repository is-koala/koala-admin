import Link from "next/link";

import { SEARCH_PARAM } from "@/components/panel/queue";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { ibanVerificationHref, userHrefOrNull } from "@/lib/panel-href";
import { ibanPendingAmountText, type IbanPending } from "@/server/api/iban-verification";
import { safeUserName } from "@/server/api/users";

/**
 * Bekleyen IBAN doğrulamalarının tablosu; kuyruk sayfası ve kullanıcı
 * sayfasının banka sekmesi (koala-admin#108) aynı satırı çizer. Kuyrukta
 * kullanıcı sütunu ve satırdan onaya geçen "Onayla" bağlantısı vardır; banka
 * sekmesi zaten tek kullanıcıdadır ve onayı nesne sayfasına bırakır, o
 * yüzden ikisi de isteğe bağlı. Tam IBAN hiçbir satırda yok.
 */
export interface PendingIbanAction {
  readonly selectedReference: string | null;
  readonly page: number;
  /** Satırdan onaya geçmek aramayı ve kullanıcı süzgecini silmesin. */
  readonly query: string | null;
  readonly userId: string | null;
}

export function PendingIbanTable({
  rows,
  caption = "Bekleyen IBAN doğrulamaları",
  showUser = true,
  action = null,
}: {
  rows: readonly IbanPending[];
  caption?: string;
  showUser?: boolean;
  action?: PendingIbanAction | null;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          {showUser ? <TableHeaderCell>Kullanıcı</TableHeaderCell> : null}
          <TableHeaderCell>IBAN</TableHeaderCell>
          <TableHeaderCell>Tutar</TableHeaderCell>
          <TableHeaderCell>Referans</TableHeaderCell>
          <TableHeaderCell>Başlangıç</TableHeaderCell>
          <TableHeaderCell>Bitiş</TableHeaderCell>
          <TableHeaderCell>Kalan deneme</TableHeaderCell>
          {action === null ? null : <TableHeaderCell>Onay</TableHeaderCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <PendingRow key={row.accountId} row={row} showUser={showUser} action={action} />
        ))}
      </TableBody>
    </Table>
  );
}

function PendingRow({
  row,
  showUser,
  action,
}: {
  row: IbanPending;
  showUser: boolean;
  action: PendingIbanAction | null;
}) {
  const personHref = userHrefOrNull(row.user.id);

  return (
    <TableRow>
      {showUser ? (
        <TableCell>
          {personHref === null ? (
            safeUserName(row.user)
          ) : (
            <Link href={personHref} className="text-brand hover:underline">
              {safeUserName(row.user)}
            </Link>
          )}
        </TableCell>
      ) : null}
      <TableCell>
        <span className="font-mono text-xs">{row.maskedIban}</span>
      </TableCell>
      <TableCell>{row.amount === null ? EMPTY_VALUE : formatCurrency(row.amount)}</TableCell>
      <TableCell>
        <Link
          href={ibanVerificationHref(row.reference)}
          className="font-mono text-xs text-brand hover:underline"
        >
          {row.reference}
        </Link>
      </TableCell>
      <TableCell>{formatDateTime(row.startedAt)}</TableCell>
      <TableCell>{formatDateTime(row.expiresAt)}</TableCell>
      <TableCell>
        {row.attemptsLeft === null ? EMPTY_VALUE : formatInteger(row.attemptsLeft)}
      </TableCell>
      {action === null ? null : (
        <TableCell>
          <ConfirmLink row={row} action={action} />
        </TableCell>
      )}
    </TableRow>
  );
}

function ConfirmLink({ row, action }: { row: IbanPending; action: PendingIbanAction }) {
  if (row.reference === action.selectedReference) return <Badge tone="brand">Seçili</Badge>;
  const amountText = ibanPendingAmountText(row.amount);
  return (
    <Link
      href={{
        pathname: "/iban-verifications",
        query: {
          referans: row.reference,
          ...(amountText.length === 0 ? {} : { tutar: amountText }),
          ...(action.page > 0 ? { sayfa: String(action.page) } : {}),
          ...(action.query === null ? {} : { [SEARCH_PARAM]: action.query }),
          ...(action.userId === null ? {} : { kullanici: action.userId }),
        },
      }}
      className="text-sm font-medium text-brand hover:underline"
    >
      Onayla
    </Link>
  );
}
