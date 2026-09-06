import type { Metadata } from "next";

import { DecisionForm, QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatInteger } from "@/lib/format";
import {
  APPROVAL_MIN_NOTE_LENGTH,
  COMPANY_BACKEND_GAPS,
  COMPANY_PAGING,
  companyContactRoleLabel,
  companyTypeLabel,
  contactDisplayName,
  getCompanies,
  type Company,
} from "@/server/api/companies";
import {
  pageWindow,
  readEnumParam,
  readPaging,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitCompanyApproval } from "./actions";

export const metadata: Metadata = { title: "Şirket onayları" };

/**
 * The screen that ends a dead end.
 *
 * A company is created unapproved and cannot post a job until somebody
 * approves it, and until now nobody could: `POST /admin/companies/{id}/approve`
 * existed with no operator in front of it, so the entire company branch of the
 * employer flow stopped at `PENDING`.
 *
 * What this screen can and cannot do is decided by `AdminController`, and it
 * says so rather than filling the gaps in:
 *
 *  - **Approval is the only move.** There is no rejection endpoint, no
 *    un-approve, no "ask for documents". The decision form offers one option
 *    and the screen states the absence in words.
 *  - **The note goes nowhere on the backend.** The approve endpoint takes no
 *    body. The panel still requires a written reason — approval is
 *    irreversible — and says out loud where it does and does not end up.
 *  - **No notification is sent.** `CompanyManager.approveCompany` flips a
 *    boolean and logs; it never calls `notificationService`. An operator who
 *    assumes the owner was told would be wrong, so the screen tells them.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Şirket onay kuyruğu</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Onay bekleyen şirket başvuruları. Onaylanana kadar şirket ilan yayınlayamaz.{" "}
          <code className="font-mono">company.approve</code> izni gerektirir; karar backend&apos;in
          denetim kaydına yazılır (koala-backend#15).
        </p>
      </header>

      <RequirePermission permission="company.approve">
        <CompanyQueue params={params} />
      </RequirePermission>
    </div>
  );
}

/** The two views `@RequestParam boolean approved` can produce, named in Turkish. */
const VIEWS = ["bekleyen", "onayli"] as const;

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "name,asc", label: "Ada göre (A-Z)" },
  { value: "name,desc", label: "Ada göre (Z-A)" },
];

async function CompanyQueue({ params }: { params: SearchParams }) {
  const view = readEnumParam(params, "onay", VIEWS, "bekleyen");
  const approved = view === "onayli";
  const paging = readPaging(params, COMPANY_PAGING);

  const viewState = {
    onay: view,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "onay",
          label: "Görünüm",
          value: view,
          options: [
            { value: "bekleyen", label: "Onay bekleyenler" },
            { value: "onayli", label: "Onaylanmışlar" },
          ],
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size) }}
      notice={
        <>
          Görünüm ve sıralama sunucuya gider; gelen sayfa panelde süzülmez.{" "}
          <strong>Ada ya da vergi numarasına göre arama yok</strong> —{" "}
          <code className="font-mono">GET /admin/companies</code> tek süzgeç olarak{" "}
          <code className="font-mono">approved</code> alıyor.
        </>
      }
    />
  );

  let page;
  try {
    page = await getCompanies(await getKoalaAccessToken(), { approved, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <QueueLoadFailure
          subject="Şirket kuyruğu"
          permission="company.approve"
          failure={classifyQueueFailure(error)}
        />
        <BackendGaps />
      </div>
    );
  }

  const companies = page.content;

  return (
    <div className="flex flex-col gap-6">
      {filters}

      <NoRejectionNotice />

      {companies.length === 0 ? (
        <EmptyState
          title={approved ? "Onaylanmış şirket yok." : "Onay bekleyen şirket yok. Kuyruk temiz."}
          description={
            approved
              ? "Bu görünüm yalnızca onaylanmış şirketleri listeler."
              : "Yeni bir başvuru geldiğinde burada görünür."
          }
        />
      ) : (
        <>
          <Table caption="Şirket onay kuyruğu">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Şirket</TableHeaderCell>
                <TableHeaderCell>Tür</TableHeaderCell>
                <TableHeaderCell>Vergi no</TableHeaderCell>
                <TableHeaderCell>Yetkililer</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Detay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name ?? EMPTY_VALUE}</TableCell>
                  <TableCell>{companyTypeLabel(company.type) ?? EMPTY_VALUE}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{company.taxNumber ?? EMPTY_VALUE}</span>
                  </TableCell>
                  <TableCell>
                    {company.companyContacts.length === 0
                      ? EMPTY_VALUE
                      : formatInteger(company.companyContacts.length)}
                  </TableCell>
                  <TableCell>
                    {company.approved ? (
                      <Badge tone="success">Onaylı</Badge>
                    ) : (
                      <Badge tone="warning">Onay bekliyor</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <a href={`#sirket-${company.id}`} className="text-brand hover:underline">
                      İncele
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <QueuePager window={pageWindow(page)} state={viewState} unit="şirket" />

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Başvuru detayları ve onay</h2>
            {companies.map((company) => (
              <CompanyDetail key={company.id} company={company} />
            ))}
          </section>
        </>
      )}

      <BackendGaps />
    </div>
  );
}

/**
 * Stated once, above the queue, rather than only inside each decision form.
 *
 * An operator opening an application that should clearly be refused needs to
 * find out immediately that there is nothing they can do about it here — not
 * after reading the whole record and looking for a button.
 */
function NoRejectionNotice() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
      <p className="text-sm font-semibold text-warning">Bu kuyrukta ret yolu yok.</p>
      <p className="max-w-prose text-sm text-ink">
        koala-backend yalnızca{" "}
        <code className="font-mono">POST /admin/companies/&#123;companyId&#125;/approve</code> ucunu
        veriyor; reddetme, onayı geri alma ya da eksik belge isteme ucu bulunmuyor. Reddedilmesi
        gereken bir başvuru kuyrukta kalmaya devam eder. Panel bunun için bir düğme uydurmuyor —
        eksik olan backend&apos;dedir.
      </p>
    </div>
  );
}

function CompanyDetail({ company }: { company: Company }) {
  const address = company.address;
  const contacts = company.companyContacts;

  return (
    <details
      id={`sirket-${company.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span>{company.name ?? EMPTY_VALUE}</span>
        {company.approved ? (
          <Badge tone="success">Onaylı</Badge>
        ) : (
          <Badge tone="warning">Onay bekliyor</Badge>
        )}
        <span className="font-mono text-xs text-ink-subtle">{company.id.slice(0, 8)}</span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-ink-muted">Şirket kimliği</dt>
          <dd className="font-mono text-sm break-all">{company.id}</dd>

          <dt className="text-sm text-ink-muted">Ticari unvan</dt>
          <dd className="text-sm">{company.name ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Şirket türü</dt>
          <dd className="text-sm">{companyTypeLabel(company.type) ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Vergi numarası</dt>
          <dd className="font-mono text-sm">{company.taxNumber ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">E-posta</dt>
          <dd className="text-sm break-all">{company.email ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Telefon</dt>
          <dd className="text-sm">{company.phoneNumber ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Web sitesi</dt>
          <dd className="text-sm break-all">{company.website ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Adres</dt>
          <dd className="text-sm">
            {address === null
              ? EMPTY_VALUE
              : (address.displayAddress ??
                [address.districtName, address.cityName, address.countryName]
                  .filter(Boolean)
                  .join(", ") ??
                EMPTY_VALUE)}
          </dd>

          <dt className="text-sm text-ink-muted">Tanım</dt>
          <dd className="text-sm whitespace-pre-wrap">{company.description ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Yetkili kişiler</dt>
          <dd className="flex flex-col gap-1 text-sm">
            {contacts.length === 0 ? "Kayıtlı yetkili yok." : null}
            {contacts.map((contact) => (
              <span key={contact.id} className="flex flex-wrap items-center gap-2">
                <span>{contactDisplayName(contact) ?? EMPTY_VALUE}</span>
                <Badge>{companyContactRoleLabel(contact.role) ?? EMPTY_VALUE}</Badge>
              </span>
            ))}
          </dd>

          <dt className="text-sm text-ink-muted">Başvuru tarihi ve başvuran</dt>
          <dd className="text-sm text-ink-muted">
            Backend döndürmüyor. <code className="font-mono">Company</code> kaydında{" "}
            <code className="font-mono">created_at</code> ve{" "}
            <code className="font-mono">created_by_id</code> var,{" "}
            <code className="font-mono">CompanyDto</code> ikisini de taşımıyor. Yukarıdaki yetkili
            kişiler, başvuruyu açan kişi ile aynı olmak zorunda değildir.
          </dd>

          <dt className="text-sm text-ink-muted">Belgeler / galeri</dt>
          <dd className="flex flex-col gap-1 text-sm">
            {company.images.length === 0 ? (
              <span className="text-ink-muted">
                Görsel yok. Backend&apos;de belge için ayrı bir alan da yok — burada görülenler
                şirketin galeri görselleridir.
              </span>
            ) : (
              company.images.map((image) => (
                <a
                  key={image.id}
                  href={image.url ?? "#"}
                  className="break-all text-brand hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {image.caption ?? image.url ?? image.id}
                </a>
              ))
            )}
          </dd>
        </dl>

        <DecisionForm
          action={submitCompanyApproval}
          hiddenFields={{ companyId: company.id }}
          options={[
            {
              value: "APPROVE",
              label: "Şirketi onayla",
              consequence:
                "Şirket onaylanır ve ilan yayınlayabilir hale gelir. Onayı geri alan bir uç yok, bu yüzden karar kalıcıdır.",
              irreversible: true,
            },
          ]}
          legend="Karar"
          noteLabel="Onay gerekçesi"
          noteHint={`En az ${APPROVAL_MIN_NOTE_LENGTH} karakter. Hangi belgeye ya da bilgiye bakarak onayladığınızı yazın.`}
          submitLabel="Şirketi onayla"
          minNoteLength={APPROVAL_MIN_NOTE_LENGTH}
          idPrefix={`sirket-${company.id}`}
          disabled={company.approved}
          disabledReason="Bu şirket zaten onaylı. Backend onaylı bir şirketi tekrar onaylamıyor (409) ve onayı geri alan bir uç yok."
          followUp={<ApprovalFollowUp />}
        />
      </div>
    </details>
  );
}

/** The three things that do not happen automatically, said before the click. */
function ApprovalFollowUp() {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-ink">Onaydan sonra:</p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Gerekçeniz backend&apos;e gitmez.</strong> Onay ucu gövde kabul etmiyor; gerekçe
          panelin sunucu günlüğüne düşer. Kalıcı kayıt koala-backend#15 ile gelecek.
        </li>
        <li>
          <strong>Şirket sahibine bildirim gitmez.</strong>{" "}
          <code className="font-mono">CompanyManager.approveCompany</code> yalnızca onay alanını
          değiştirip log yazıyor; bildirim servisi çağrılmıyor. Haber vermek gerekiyorsa panel
          dışından yapın.
        </li>
        <li>
          <strong>Karar geri alınamaz.</strong> Onayı kaldıran bir uç yok.
        </li>
      </ul>
    </div>
  );
}

function BackendGaps() {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">
        Backend&apos;in veremedikleri ({formatInteger(COMPANY_BACKEND_GAPS.length)})
      </h2>
      <p className="max-w-prose text-xs text-ink-muted">
        koala-admin#8&apos;in istediği ama <code className="font-mono">AdminController</code>
        &apos;ın bugün karşılayamadığı alanlar. Panel bunları taklit etmiyor.
      </p>
      <dl className="flex flex-col gap-2">
        {COMPANY_BACKEND_GAPS.map((gap) => (
          <div key={gap.id} className="flex flex-col">
            <dt className="text-sm font-medium text-ink">{gap.title}</dt>
            <dd className="max-w-prose text-xs text-ink-muted">{gap.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
