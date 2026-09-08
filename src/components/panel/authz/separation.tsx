import { Badge } from "@/components/ui";
import { DUTY_BRANCH_LABELS, type SeparationVerdict } from "@/lib/role-graph";

/**
 * Görev ayrılığı teşhisi, tek rozet.
 *
 * Rol grafiğinde bir rolün kapanışı, personel listesinde bir kişinin
 * üyeliklerinin birleşimi için — aynı kural, aynı dört hâl, tek yerde yazılı.
 *
 * Rozet bir **teşhis**: "kural ihlali" yazan bir satır, backend'in o yazımı
 * reddettiği anlamına gelmiyor. Reddetmiyor; sebebi ekranın kendi uyarı
 * kutusunda ve `ROLE_GRAPH_BACKEND_GAPS` / `STAFF_BACKEND_GAPS` maddelerinde
 * yazılı.
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
