import "server-only";

import { z } from "zod";

import { isKoalaApiError } from "./errors";
import { addressSchema, jobPath } from "./jobs";
import { koalaApi } from "./koala";

/**
 * Personel ulaşım okuması (koala-admin#120 / koala-backend T1).
 *
 * Pazaryeri `GET /jobs/{id}/transport-plan` işveren ister; personel token'ı
 * USER olmadığı için 403/404 olur. Personel ucu
 * `GET /admin/jobs/{jobId}/transport-plan` (`job.read`) ve işveren görünümüyle
 * aynı gövdeyi verir: plaka, şoför, tam durak adresi. Plan yoksa
 * `TRANSPORT_PLAN_NOT_FOUND` — sayfa bunu boş durum sayar, ilanı 404'lemez.
 */

export const TRANSPORT_METHODS = ["SHUTTLE", "CASH_ALLOWANCE", "SELF", "NONE"] as const;
export type TransportMethod = (typeof TRANSPORT_METHODS)[number];

export const TRANSPORT_METHOD_LABELS: Record<TransportMethod, string> = {
  SHUTTLE: "Servis",
  CASH_ALLOWANCE: "Yol parası",
  SELF: "Kendi imkânı",
  NONE: "Yok",
};

export const TRANSPORT_DIRECTIONS = ["OUTBOUND", "RETURN"] as const;
export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number];

export const TRANSPORT_DIRECTION_LABELS: Record<TransportDirection, string> = {
  OUTBOUND: "Gidiş",
  RETURN: "Dönüş",
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableMoney = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => value ?? null);

const count = z
  .number()
  .nullish()
  .transform((value) => value ?? 0);

export const seatAssignmentSchema = z.object({
  id: nullableString,
  direction: z
    .enum(TRANSPORT_DIRECTIONS)
    .nullish()
    .transform((value) => value ?? null),
  shuttleId: nullableString,
  stopId: nullableString,
  createdAt: nullableString,
});

export type SeatAssignment = z.infer<typeof seatAssignmentSchema>;

export const shuttleStopSchema = z.object({
  id: nullableString,
  label: nullableString,
  scheduledAt: nullableString,
  sortOrder: count,
  address: addressSchema.nullish().transform((value) => value ?? null),
  seatsTaken: count,
});

export type ShuttleStop = z.infer<typeof shuttleStopSchema>;

export const shuttleSchema = z.object({
  id: nullableString,
  direction: z
    .enum(TRANSPORT_DIRECTIONS)
    .nullish()
    .transform((value) => value ?? null),
  name: nullableString,
  plate: nullableString,
  capacity: count,
  seatsTaken: count,
  driverName: nullableString,
  driverPhone: nullableString,
  sortOrder: count,
  stops: z.array(shuttleStopSchema).default([]),
});

export type Shuttle = z.infer<typeof shuttleSchema>;

export const assignmentTransportSchema = z.object({
  outboundMethod: z
    .enum(TRANSPORT_METHODS)
    .nullish()
    .transform((value) => value ?? null),
  returnMethod: z
    .enum(TRANSPORT_METHODS)
    .nullish()
    .transform((value) => value ?? null),
  allowanceAmount: nullableMoney,
  allowanceNote: nullableString,
  notes: nullableString,
  shuttles: z.array(shuttleSchema).default([]),
  seats: z.array(seatAssignmentSchema).default([]),
});

export type AssignmentTransport = z.infer<typeof assignmentTransportSchema>;

export const transportPlanSchema = assignmentTransportSchema.extend({
  id: nullableString,
  jobId: nullableString,
  updatedAt: nullableString,
});

export type TransportPlan = z.infer<typeof transportPlanSchema>;

export const TRANSPORT_PLAN_NOT_FOUND = "TRANSPORT_PLAN_NOT_FOUND";

export function transportPlanPath(jobId: string): string {
  return `${jobPath(jobId)}/transport-plan`;
}

/**
 * Plan yoksa `null`. İlanın kendisinin yokluğu (`JOB_NOT_FOUND`) ve diğer
 * hatalar çağırana düşer — boş plan ile kayıp ilanı karıştırmamak için.
 */
export async function getAdminTransportPlan(
  accessToken: string,
  jobId: string,
): Promise<TransportPlan | null> {
  try {
    return await koalaApi.get({
      path: transportPlanPath(jobId),
      schema: transportPlanSchema,
      accessToken,
      cache: "no-store",
    });
  } catch (error) {
    if (
      isKoalaApiError(error) &&
      error.isResourceNotFound &&
      error.errorCode === TRANSPORT_PLAN_NOT_FOUND
    ) {
      return null;
    }
    throw error;
  }
}
