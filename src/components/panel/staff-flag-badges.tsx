import { Badge } from "@/components/ui";
import { staffFlagKindLabel, staffFlagKindTone } from "@/lib/staff-notes";

/**
 * Liste ve nesne sayfasındaki işaret rozetleri. Sunum: fetch yok, izin yok.
 * Çağıran `note.read` yoksa boş dizi verir ve istek çıkmaz.
 */
export interface StaffFlagBadgeView {
  readonly kind: string;
  readonly label?: string | null;
}

export function StaffFlagBadges({
  flags,
  testId = "staff-flag-badges",
}: {
  flags: readonly StaffFlagBadgeView[];
  testId?: string;
}) {
  if (flags.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid={testId}>
      {flags.map((flag) => (
        <Badge key={`${flag.kind}-${flag.label ?? ""}`} tone={staffFlagKindTone(flag.kind)}>
          {staffFlagKindLabel(flag.kind)}
          {flag.label === null || flag.label === undefined || flag.label.length === 0
            ? null
            : ` · ${flag.label}`}
        </Badge>
      ))}
    </span>
  );
}
