import "server-only";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";
import { safeUserSchema, type SafeUser } from "./users";

/**
 * Pazaryeri kullanıcı dizini — `webAPI/AdminController.users`.
 *
 * ```java
 * GET /admin/users?query=  user.read  Pageable
 * ```
 *
 * `query` boşsa herkes; doluysa e-posta ve ad+soyad `LIKE`. Yanıt
 * `SafeUserDto`: e-posta aramada kullanılır, cevapta yoktur. Sıralama
 * `UserManager.USER_SORTABLE` — bilinmeyen alan 400.
 */

export const MARKETPLACE_USERS_PATH = "/admin/users";

/** `UserManager.USER_SORTABLE` and `USER_SORT`, copied. */
export const USER_PAGING: PagingContract = {
  sortable: ["createdAt", "firstName", "lastName"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export type MarketplaceUser = SafeUser;

export interface MarketplaceUserQuery {
  readonly query: string | null;
  readonly paging: Paging;
}

export function getMarketplaceUsers(
  accessToken: string,
  query: MarketplaceUserQuery,
): Promise<PageDto<MarketplaceUser>> {
  return koalaApi.get({
    path: MARKETPLACE_USERS_PATH,
    schema: pageDtoSchema(safeUserSchema),
    query: {
      query: query.query?.trim() || undefined,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}
