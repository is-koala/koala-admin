import { Badge } from "@/components/ui";
import { DUTY_BRANCH_LABELS, type SeparationVerdict } from "@/lib/role-graph";

/**
 * Görev ayrılığı ön izlemesi, tek rozet.
 *
 * Rol grafiğinde bir rolün kapanışı, personel listesinde bir kişinin
 * üyeliklerinin birleşimi için — aynı kural, aynı dört hâl, tek yerde yazılı.
 *
 * Rozet bir yetki kapısı değildir. Form geçersiz seçeneği önceden kapatsa da
 * bayat veya değiştirilmiş bir isteğin nihai kararını backend verir.
 */
export function SeparationBadge({ verdict }: { verdict: SeparationVerdict }) {
  const only = verdict.branches.length === 1 ? verdict.branches[0] : undefined;

  if (only !== undefined) {
    return <Badge tone="neutral">Yalnız {DUTY_BRANCH_LABELS[only]}</Badge>;
  }

  if (verdict.branches.length === 0) {
    return <Badge tone="neutral">Dal dışı</Badge>;
  }

  return verdict.exempt ? (
    <Badge tone="brand">İki dal — yazılı istisna</Badge>
  ) : (
    <Badge tone="danger">İki dal — kural ihlali</Badge>
  );
}
