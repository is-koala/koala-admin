import type { BadgeTone } from "@/components/ui";
import type { AuditSensitivity } from "@/lib/audit-log";

/**
 * How an audit row's two verdicts are drawn.
 *
 * Kept out of the components so both the table and the detail panel say the
 * same words with the same colour, and so a test can assert the mapping without
 * a DOM.
 */

export interface BadgePresentation {
  readonly label: string;
  readonly tone: BadgeTone;
}

/**
 * `FINANCIAL` has to be tellable apart at a glance — those are the rows the
 * backend keeps for ten years rather than two, and the ones an auditor is
 * usually looking for. Three tones, three colours: grey, amber, blue. Not three
 * shades of the same one.
 */
export const SENSITIVITY_PRESENTATION: Record<AuditSensitivity, BadgePresentation> = {
  NORMAL: { label: "Normal", tone: "neutral" },
  PERSONAL_DATA: { label: "Kişisel veri", tone: "warning" },
  FINANCIAL: { label: "Finansal", tone: "brand" },
};

/**
 * Refused first, and in the alarming colour, because it is the asymmetric one:
 * a missed "izin verildi" costs nothing, a missed "reddedildi" is a privilege
 * escalation attempt nobody noticed.
 */
export function outcomePresentation(allowed: boolean): BadgePresentation {
  return allowed
    ? { label: "İzin verildi", tone: "success" }
    : { label: "Reddedildi", tone: "danger" };
}
