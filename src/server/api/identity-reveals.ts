import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { marketplaceUserPath } from "./marketplace-users";
import {
  DEFAULT_PAGE_SIZE,
  pagingQuery,
  readParam,
  type Paging,
  type PagingContract,
  type SearchParams,
} from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * Kimlik görüntüleme kayıtları (koala-admin#128) — `webAPI/AdminController`.
 *
 * ```java
 * GET /admin/users/{userId}/identity-reveals  user.read_pii  Pageable
 * ```
 *
 * İşverenler `GET /job-assignments/{id}/worker-identity` ile bir işçinin
 * kimlik bilgilerini (TCKN) gördüğünde backend bir satır yazar
 * (`IdentityReveal`); bu uç o satırları işçi başına, yeniden eskiye listeler.
 * Satır görüntüleyenin kimliği ve adı, atama ve ilan, an ve **maskeli** IP
 * taşır. TCKN'nin kendisi DTO'da yok: panel kimin baktığını gösterir, neye
 * baktığını değil. Uç `PERSONAL_DATA` sınıfındadır ve her okuma backend'de
 * denetim satırı yazar — bu yüzden panel onu yalnız `kimlik` sekmesi seçiliyken
 * ister.
 *
 * `viewerFullName`, görüntüleyen hesabını sildiyse `null` döner; satır ve
 * `viewerId` kalır. Sıralama yalnız `revealedAt`
 * (`IdentityRevealManager.SORTABLE`); bilinmeyen alan 400, o yüzden panel
 * sıralamayı adresten hiç okumaz.
 */

/** `IdentityRevealManager.SORTABLE` ve `listForStaff`'ın varsayılan sırası, kopya. */
export const IDENTITY_REVEAL_PAGING: PagingContract = {
  sortable: ["revealedAt"],
  defaultSort: { field: "revealedAt", direction: "desc" },
  defaultSize: DEFAULT_PAGE_SIZE,
};

/**
 * Sekmenin sayfa anahtarı. `sayfa` değil: nesne sayfasında o, liste
 * görünümünün anahtarıdır (`QUEUE_STATE_KEYS`) ve kırıntı onu "kullanıcı
 * listesinin kaçıncı sayfası" diye geri okur; sekmenin sayfalayıcısı ona
 * dokunursa "Kullanıcılar" bağlantısı yanlış sayfaya döner.
 */
export const IDENTITY_REVEAL_PAGE_PARAM = "kimlik-sayfa";

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `core/dtos/identity/response/AdminIdentityRevealDto.java`. Kimlikler zorunlu
 * (satır DB'de hepsi `nullable = false`); ad, ilan başlığı ve IP boş gelebilir.
 */
export const identityRevealSchema = z.object({
  id: z.string(),
  viewerId: z.string(),
  viewerFullName: nullableString,
  jobAssignmentId: z.string(),
  jobId: z.string(),
  jobTitle: nullableString,
  revealedAt: nullableString,
  ipAddress: nullableString,
});

export type IdentityReveal = z.infer<typeof identityRevealSchema>;

/**
 * Adresten sayfa: negatif, sayı olmayan ya da kesirli değer backend'e gitmez
 * (`PageRequest.of` 400 verir). Boyut sabit — sekmede boyut seçici yok —
 * ve sıralama tek alan, varsayılan.
 */
export function readIdentityRevealPaging(params: SearchParams): Paging {
  const requested = Number(readParam(params, IDENTITY_REVEAL_PAGE_PARAM) ?? 0);
  const page = Number.isFinite(requested) ? Math.max(0, Math.trunc(requested)) : 0;

  return {
    page,
    size: DEFAULT_PAGE_SIZE,
    sort: IDENTITY_REVEAL_PAGING.defaultSort,
  };
}

export function userIdentityRevealsPath(userId: string): string {
  return `${marketplaceUserPath(userId)}/identity-reveals`;
}

/**
 * `GET /admin/users/{userId}/identity-reveals`. İzinsiz personel var olan ve
 * olmayan kullanıcıya aynı 403 zarfını alır; izinli personel olmayan
 * kullanıcıya 404.
 */
export function getIdentityReveals(
  accessToken: string,
  userId: string,
  paging: Paging,
): Promise<PageDto<IdentityReveal>> {
  return koalaApi.get({
    path: userIdentityRevealsPath(userId),
    schema: pageDtoSchema(identityRevealSchema),
    query: pagingQuery(paging),
    accessToken,
    cache: "no-store",
  });
}
