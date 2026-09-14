import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { IbanVerificationForm } from "@/components/iban-verification/iban-verification-form";
import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { listCrumb, type BreadcrumbItem } from "@/lib/breadcrumb";
import { userHrefOrNull } from "@/lib/panel-href";
import {
  findPendingIbanVerification,
  ibanPendingAmountText,
  type IbanPending,
} from "@/server/api/iban-verification";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitIbanVerification } from "../actions";

export const metadata: Metadata = { title: "IBAN doğrulaması" };

/** `ConfirmIbanTransferDto` referansı 1–128 karakter kabul eder; daha uzunu hiçbir kaydı adreslemez. */
const REFERENCE_MAX_LENGTH = 128;

/**
 * IBAN doğrulama nesne sayfası (koala-admin#95).
 *
 * Backend'de `GET .../{reference}` yok: nesne, PENDING kuyruğunun referansla
 * süzülüp tam eşleşen satırından kurulur (`findPendingIbanVerification`).
 * Kuyrukta olmayan referans — onaylanmış, süresi dolmuş ya da hiç var
 * olmamış — ortak 404 yüzeyine gider (koala-admin#85); panel bu üçünü
 * ayıramaz, çünkü backend ayırt edecek bir uç vermiyor. Deneme geçmişi de
 * yoktur: backend hesap başına tek bir açık doğrulama tutar ve yalnız
 * başlangıç/bitiş anlarını verir; çizelge onlardan kurulur. Kalan deneme
 * hakkı (`attemptsLeft`) koala-backend#283 ile geldi; eski sunucuda "—".
 *
 * Onay mevcut confirm eylemi; kapı ve `guardDecision` aynı
 * `bank.account.verify`.
 */
export default async function IbanVerificationDetailPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  // Referans UUID değil serbest metin (`KOALA-9F3A`): kısaltılmaz, olduğu gibi
  // kırıntıdır; kuyruk süzgeçsizdir (yalnız PENDING), taşınacak durum yok.
  const breadcrumb: readonly BreadcrumbItem[] = [
    listCrumb("/iban-verifications"),
    { label: safeDecode(reference) ?? reference, mono: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="IBAN doğrulaması"
        breadcrumb={breadcrumb}
        description="Bekleyen küçük havale: hesap sahibi, maskeli IBAN, referans ve süre. Onay ekstre satırıyla yapılır; reddetme ucu yok."
      />

      <RequirePermission permission="bank.account.verify">
        <IbanVerificationObject rawReference={reference} />
      </RequirePermission>
    </div>
  );
}

async function IbanVerificationObject({ rawReference }: { rawReference: string }) {
  const reference = safeDecode(rawReference);
  // Boş ya da 128'i aşan referans hiçbir kaydı adresleyemez: backend'e
  // sormadan 404. Kuyrukta olmayan referans da aynı yüzeye gider.
  if (reference === null || reference.length === 0 || reference.length > REFERENCE_MAX_LENGTH) {
    notFound();
  }

  const accessToken = await getKoalaAccessToken();

  let pending: IbanPending | null;
  try {
    pending = await findPendingIbanVerification(accessToken, reference);
  } catch (error) {
    return (
      <QueueLoadFailure
        subject="IBAN doğrulaması"
        permission="bank.account.verify"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  if (pending === null) notFound();

  const personHref = userHrefOrNull(pending.user.id);
  const amountText = ibanPendingAmountText(pending.amount);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2" aria-labelledby="iban-summary-heading">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="iban-summary-heading" className="text-sm font-semibold">
            Doğrulama
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Referans"
              value={<span className="font-mono text-xs">{pending.reference}</span>}
            />
            {/* Kuyruk yalnız PENDING ve süresi dolmamış satırı verir; burada olan bekliyordur. */}
            <Row label="Durum" value={<Badge tone="warning">Bekliyor</Badge>} />
            <Row
              label="Hesap sahibi"
              value={
                personHref === null ? (
                  safeUserName(pending.user)
                ) : (
                  <Link href={personHref} className="text-brand hover:underline">
                    {safeUserName(pending.user)}
                  </Link>
                )
              }
            />
            <Row
              label="Maskeli IBAN"
              value={<span className="font-mono text-xs">{pending.maskedIban}</span>}
            />
            <Row
              label="Banka hesabı"
              value={<span className="font-mono text-xs break-all">{pending.accountId}</span>}
            />
            <Row
              label="Beklenen tutar"
              value={pending.amount === null ? EMPTY_VALUE : formatCurrency(pending.amount)}
            />
            <Row
              label="Kalan deneme"
              value={
                pending.attemptsLeft === null ? (
                  EMPTY_VALUE
                ) : (
                  <span data-testid="iban-attempts-left">
                    {formatInteger(pending.attemptsLeft)}
                  </span>
                )
              }
            />
          </dl>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-semibold">Zaman çizelgesi</h2>
          <p className="max-w-prose text-xs text-ink-muted">
            Backend hesap başına tek açık doğrulama tutar; deneme geçmişi vermez, yalnız kalan hakkı
            sayar. Görünen, bu doğrulamanın anlarıdır.
          </p>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Hesap oluşturulma" value={formatDateTime(pending.createdAt)} />
            <Row label="Doğrulama başlangıcı" value={formatDateTime(pending.startedAt)} />
            <Row label="Son geçerlilik" value={formatDateTime(pending.expiresAt)} />
          </dl>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="iban-confirm-heading">
        <h2 id="iban-confirm-heading" className="text-lg font-semibold">
          Ekstre onayı
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Referans ve beklenen tutar bu kayıttan dolduruldu. Gönderen IBAN&apos;ı ekstreden yazılır;
          kuyruk onu taşımaz.
        </p>
        <IbanVerificationForm
          key={`${pending.reference}-${amountText}`}
          action={submitIbanVerification}
          defaults={{
            reference: pending.reference,
            ...(amountText.length === 0 ? {} : { amount: amountText }),
          }}
        />
      </section>

      <AuditPointer permission="bank.account.verify" linkLabel="IBAN doğrulama kayıtlarını aç">
        Backend başarılı işlemi <code className="font-mono">bank.account.verify</code> adıyla
        kaydeder. Panel, ekstre alanlarının request body olarak denetim kaydında tutulduğunu iddia
        etmez; hata araştırmasında ekrandaki requestId ile backend logları eşleştirilir.
      </AuditPointer>
    </div>
  );
}

/**
 * Next yol parçasını çözülmüş verir; ikinci çözüm backend'in ürettiği
 * referans için (`BankAccountManager.nextReference`: önek + harf/rakam)
 * no-op'tur ve yalnız elle yazılmış bozuk bir yüzde dizisini (`%E0%A4%A`)
 * yakalar — o da hiçbir kaydı adreslemez: `null`, yani 404.
 */
function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
