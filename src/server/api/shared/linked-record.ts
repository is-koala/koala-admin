import { z } from "zod";

/**
 * `core/dtos/common/LinkedRecordDto.java` — bağlı kaydın yalnız kimliği,
 * durumu ve zamanı. Durum serbest metin: ödeme, hakediş, uyuşmazlık ve
 * şikayet enum'ları farklı; panel onu olduğu gibi yazar, çevirmez.
 */
export const linkedRecordSchema = z.object({
  id: z.string(),
  status: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  createdAt: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

export type LinkedRecord = z.infer<typeof linkedRecordSchema>;
