import type { EscrowSummary } from "@/server/api/escrow";

type AdminAssignmentOverrides = Omit<Partial<EscrowSummary>, "pricing"> & {
  readonly pricing?: Partial<EscrowSummary["pricing"]>;
};

const DEFAULT_ADMIN_ASSIGNMENT = {
  id: "9a1c0f10-0001-4c00-8000-0000000000aa",
  jobId: "9a1c0f10-0001-4c00-8000-0000000000bb",
  jobTitle: "Garsonluk",
  companyId: "c0000000-0000-4000-8000-0000000000c1",
  companyName: "Koala Kafe",
  worker: {
    id: "w-1",
    firstName: "Ayşe",
    lastName: "Yılmaz",
    username: "ayse",
    profilePictureUrl: null,
  },
  employer: {
    id: "e-1",
    firstName: "Mehmet",
    lastName: "Demir",
    username: "mehmet",
    profilePictureUrl: null,
  },
  status: "COMPLETED",
  paymentStatus: "HELD_IN_ESCROW",
  assignmentDateTime: "2026-09-01T08:00:00.000000000Z",
  actualCompletionDateTime: "2026-09-01T16:00:00.000000000Z",
  workHours: 8,
  pricing: {
    pricingVersion: "v1",
    currency: "TRY",
    workerPayout: "1240.50",
    serviceFeeRate: "0.1000",
    serviceFeeAmount: "137.83",
    employerTotal: "1378.33",
  },
} as const satisfies EscrowSummary;

/** Current `AdminAssignmentDto`, with nested overrides for pricing contract tests. */
export function adminAssignmentFixture(overrides: AdminAssignmentOverrides = {}): EscrowSummary {
  return {
    ...DEFAULT_ADMIN_ASSIGNMENT,
    ...overrides,
    pricing: {
      ...DEFAULT_ADMIN_ASSIGNMENT.pricing,
      ...overrides.pricing,
    },
  };
}
