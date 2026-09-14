import { z } from "zod";

/**
 * `core/dtos/payment/response/PricingBreakdownDto.java` — atama, ilan ve
 * ödeme denemesi aynı fiyat anlık görüntüsünü taşır. Ondalıklar bilerek
 * metin: backend `toPlainString()` yazar, panel sayıya çevirmez.
 *
 * `server-only` yok: yalnız şema; ağ `koala.ts`'te.
 */
export const pricingBreakdownSchema = z.object({
  pricingVersion: z.string(),
  currency: z.string(),
  workerPayout: z.string(),
  serviceFeeRate: z.string(),
  serviceFeeAmount: z.string(),
  employerTotal: z.string(),
});

export type PricingBreakdown = z.infer<typeof pricingBreakdownSchema>;
