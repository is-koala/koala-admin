import type { Metadata } from "next";

import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE } from "@/lib/format";
import {
  pageWindow,
  readPaging,
  readParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import { getMarketplaceUsers, USER_PAGING } from "@/server/api/marketplace-users";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

export const metadata: Metadata = { title: "Kullanıcılar" };

/**
 * Pazaryeri kullanıcı dizini — koala-admin#46.
 *
 * Personel dizini (`/staff`) değil: `GET /admin/users` marketplace
 * `users` tablosunu `user.read` ile arar. Rol verme `user.role.manage` ve
 * ayrı issue. Bu sayfa salt okunur, Server Action yok.
 *
 * Fetch kapının içinde: izni olmayan kişide `GET /admin/users` hiç çıkmaz.
 * Arama URL'den okunup backend'e gider; dönen sayfa tarayıcıda süzülmez.
 *
 * `SafeUserDto` e-posta taşımaz. Operatör e-posta ile arayabilir; tabloda
 * e-posta görünmez. Fixture'da gelse Zod onu düşürür.
 */

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Kullanıcılar</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Pazaryeri kullanıcıları. Liste <code className="font-mono">user.read</code> ister. E-posta
          aramada kullanılır, yanıtta yoktur — tabloda yalnız ad, kullanıcı adı ve kimlik görünür.
        </p>
      </header>

      <RequirePermission permission="user.read">
        <UserDirectory params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "firstName,asc", label: "Ada göre (A-Z)" },
  { value: "firstName,desc", label: "Ada göre (Z-A)" },
  { value: "lastName,asc", label: "Soyada göre (A-Z)" },
  { value: "lastName,desc", label: "Soyada göre (Z-A)" },
];

async function UserDirectory({ params }: { params: SearchParams }) {
  const paging = readPaging(params, USER_PAGING);
  const rawQuery = readParam(params, "ara");
  const query = rawQuery?.trim() || null;

  const viewState = {
    ...(query === null ? {} : { ara: query }),
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size), ...(query === null ? {} : { ara: query }) }}
      notice={
        <>
          Arama ve sıralama backend&apos;e gider; gelen sayfa tarayıcıda yeniden süzülmez. Arama
          e-posta ve ad+soyad üzerindedir. E-posta yanıtta yoktur.
        </>
      }
    />
  );

  let page;
  try {
    page = await getMarketplaceUsers(await getKoalaAccessToken(), { query, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <UserSearch query={query} state={viewState} />
        <QueueLoadFailure
          subject="Kullanıcı dizini"
          permission="user.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const users = page.content;

  return (
    <div className="flex flex-col gap-6">
      {filters}
      <UserSearch query={query} state={viewState} />

      {users.length === 0 ? (
        <EmptyState
          title={query === null ? "Kayıtlı kullanıcı yok." : "Aramayla eşleşen kullanıcı yok."}
          description={
            query === null
              ? "Kuyruğu daha sonra yenileyebilirsiniz."
              : "Arama e-posta ve ad+soyad üzerinde sunucuda çalışır."
          }
        />
      ) : (
        <Table caption="Pazaryeri kullanıcıları">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Ad</TableHeaderCell>
              <TableHeaderCell>Kullanıcı adı</TableHeaderCell>
              <TableHeaderCell>Kimlik</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{safeUserName(user)}</TableCell>
                <TableCell>{user.username ?? EMPTY_VALUE}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{user.id}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="kullanıcı" />
    </div>
  );
}

function UserSearch({
  query,
  state,
}: {
  query: string | null;
  state: Readonly<Record<string, string>>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      {Object.entries(state)
        .filter(([name]) => name !== "ara")
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <input type="hidden" name="sayfa" value="0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="kullanici-ara" className="text-sm font-medium text-ink">
          Ad ya da e-posta ara
        </label>
        <input
          id="kullanici-ara"
          name="ara"
          type="search"
          defaultValue={query ?? ""}
          placeholder="ör. ada yılmaz veya ada@example.com"
          className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        Ara
      </button>
    </form>
  );
}
