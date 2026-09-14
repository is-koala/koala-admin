import Link from "next/link";

import { EMPTY_VALUE } from "@/lib/format";
import { staffRefFor, type StaffRefs } from "@/server/staff/staff-refs";

/**
 * Bir personel kimliğinin ekrandaki hâli (koala-admin#112): çözüldüyse ad ve
 * `/staff` bağlantısı, çözülmediyse kısa kimlik; tam UUID her iki durumda
 * `title`'da. Kimlik yoksa "—". Çözüm sayfada bir kez yapılır
 * (`resolveStaffRefs`), bileşen yalnız okur.
 */
export function StaffRefLink({
  staffId,
  refs,
}: {
  staffId: string | null | undefined;
  refs: StaffRefs;
}) {
  if (staffId === null || staffId === undefined || staffId.length === 0) {
    return <>{EMPTY_VALUE}</>;
  }
  const ref = staffRefFor(refs, staffId);
  const text = (
    <span className={ref.resolved ? undefined : "font-mono text-xs"} title={staffId}>
      {ref.label}
    </span>
  );
  if (ref.href === null) return text;
  return (
    <Link href={ref.href} className="text-brand hover:underline">
      {text}
    </Link>
  );
}
