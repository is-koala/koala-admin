import Link from "next/link";

import { companyHref, isUuid } from "@/lib/panel-href";

/**
 * Şirket adı, kimliği varsa ve personel `company.approve` taşıyorsa şirket
 * sayfasına bağlı (koala-admin#105). Kimlik koala-backend#301 ile geldi;
 * eski sunucu `companyId` göndermez → düz metin. İzni olmayana bağlantı
 * vermek onu 403 ekranına göndermek olur; ad yine yazılır, çünkü ad zaten
 * DTO'daydı ve gizlenmesi gereken bir şey değil.
 */
export function CompanyLink({
  companyId,
  companyName,
  canOpen,
}: {
  companyId: string | null;
  companyName: string;
  canOpen: boolean;
}) {
  if (!canOpen || companyId === null || !isUuid(companyId)) return <>{companyName}</>;
  return (
    <Link href={companyHref(companyId)} className="text-brand hover:underline">
      {companyName}
    </Link>
  );
}
