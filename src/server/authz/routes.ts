import type { Permission } from "./permissions";

/**
 * Every page and route handler the panel serves, and what it takes to reach it.
 *
 * This is koala-admin#5's counterpart to koala-backend#14's `/admin/**` mapping
 * test. The backend's defect was `.requestMatchers("/admin/**").hasRole("ADMIN")`
 * — one door in front of everything, so every endpoint added afterwards was
 * open to every admin by default. The panel's version of that defect is a page
 * someone adds without a gate, and the way it is prevented is the same: a
 * registry that must name a permission, plus a test that walks `src/app` and
 * fails when a file is not in it.
 *
 * Two rules make it work, and neither is optional:
 *
 *  1. **Anything not permission-gated has to say why, in writing.** The type
 *     below cannot be satisfied by an entry that is `public` or `session`
 *     without an `ungatedReason`. Adding a hole is allowed; adding one silently
 *     is not, and `routes.test.ts` pins the exact set so growing it is a
 *     deliberate diff someone reviews.
 *  2. **The menu is drawn from this list and nowhere else.** The
 *     permission→menu mapping is the `nav` field on these entries, so a screen
 *     cannot quietly add itself to the navigation with a different rule from
 *     the one that guards it.
 *
 * And the rule this registry cannot enforce on its own, stated so nobody
 * mistakes the hiding for the protection: **the backend is the authority.**
 * A missing menu entry is cosmetic. What actually stops a `CATALOG_EDITOR`
 * reading the audit log is `@RequiresPermission` on the backend; the panel's
 * gate exists so the person gets an explanation instead of a broken screen.
 */

/** How a route is reached. `permission` is the only one that protects anything. */
type RouteGate =
  | { readonly access: "permission"; readonly permission: Permission }
  /** Signed in, no permission required — and a written reason for that. */
  | { readonly access: "session"; readonly ungatedReason: string }
  /** Reachable with no session at all — and a written reason for that. */
  | { readonly access: "public"; readonly ungatedReason: string };

interface RouteIdentity {
  /** URL path as Next.js serves it, with route groups already stripped. */
  readonly path: string;
  /** What the route is, in Turkish, for anywhere the panel has to name it. */
  readonly title: string;
}

interface NavPlacement {
  /**
   * Where the route appears in the menu. Absent means "reachable, but not
   * advertised" — a verification page, or a screen only linked from another.
   */
  readonly nav?: {
    readonly label: string;
    /** Lower first. Gaps are fine; they leave room for later slices. */
    readonly order: number;
  };
}

type PanelRouteShape = RouteIdentity & RouteGate & NavPlacement;

/**
 * Pages — one entry per `src/app/**\/page.tsx`.
 *
 * `as const` on purpose: it keeps `path` a literal union, which is what lets
 * `next.config.ts`'s `typedRoutes` check the menu's `<Link href>` values
 * instead of waving a `string` through.
 */
export const ROUTES = [
  {
    path: "/giris",
    title: "Giriş",
    access: "public",
    ungatedReason:
      "Oturumun başladığı yer. Gate'lemek yönlendirmeyi döngüye sokar; hiçbir iş verisi göstermez, yalnız e-posta ve parola sorar.",
  },
  {
    path: "/giris/hata",
    title: "Giriş yapılamadı",
    access: "public",
    ungatedReason:
      "Oturumun neden olmadığını anlatır. Gate'lenirse her hata, bildirmeye çalıştığı hatanın arkasında kaybolur.",
  },
  {
    path: "/giris/parola",
    title: "Parola değiştirme",
    access: "session",
    ungatedReason:
      "İlk girişte parola değiştirme ekranı. Bir izin isteyemez, çünkü backend o bayrak açıkken /admin/me dâhil her ucu 403'le reddeder — yani izin çözülemez ve izin isteyen bir kapı bu sayfayı kalıcı olarak kilitlerdi. Bayrağı düşürmenin tek yolu bu ekran.",
  },
  {
    path: "/",
    title: "Panel",
    access: "session",
    ungatedReason:
      "Kimlikten ve menüden başka bir şey göstermez; menü zaten izinlere göre çizilir. Buraya bir izin koymak, izni olmayan personele 'giriş yaptın ama hiçbir sayfaya gidemezsin' demenin yolunu kapatırdı — oysa bu, geçiş penceresinin normal durumudur.",
  },
  {
    path: "/verification/job-categories",
    title: "İş kategorileri (doğrulama)",
    access: "session",
    ungatedReason:
      "koala-admin#2'nin API katmanı doğrulama sayfası. Yalnız permitAll olan GET /reference/job-categories verisini gösterir ve /admin/me çalışmadığında da ulaşılabilir kalmalıdır — aksi hâlde backend kimliği bozulduğunda API katmanını doğrulayacak sayfa da kaybolur.",
  },
  {
    path: "/job-categories",
    title: "İş kategorileri",
    access: "permission",
    permission: "category.manage",
    nav: { label: "İş kategorileri", order: 10 },
  },
  {
    /**
     * koala-admin#41. Backend `BadgesController` dört yazma ucunu
     * `badge.manage` ile koruyor; kapı aynı izin. Katalog okuması da bu
     * izne bağlı — public `GET /reference/badges` yalnız aktifleri verir.
     */
    path: "/badges",
    title: "Rozetler",
    access: "permission",
    permission: "badge.manage",
    nav: { label: "Rozetler", order: 15 },
  },
  {
    /**
     * koala-admin#7. `content.moderate`, deliberately not `dispute.resolve`:
     * a DISPUTE_HANDLER settling money disputes has no business taking images
     * down, and the backend draws the same line
     * (`ReportsController` and `DELETE /admin/images/{imageId}` both sit behind
     * `CONTENT_MODERATE`).
     */
    path: "/reports",
    title: "Şikayetler",
    access: "permission",
    permission: "content.moderate",
    nav: { label: "Şikayetler", order: 20 },
  },
  {
    /**
     * koala-admin#39. Liste `user.read_pii` ister çünkü DTO `subjectId`
     * taşır. Ret ayrı: `user.deletion.manage`, form ve action'da.
     */
    path: "/account-deletions",
    title: "Hesap silme talepleri",
    access: "permission",
    permission: "user.read_pii",
    nav: { label: "Hesap silme", order: 25 },
  },
  {
    /**
     * koala-admin#46/#47. Pazaryeri `users` tablosu, personel değil.
     * Kapı `user.read`: `GET /admin/users` ve roller onu ister. Rol yazımı
     * `user.role.manage` ve `runAuthorizationChange` her gönderimde yeniden
     * çözer — sayfanın kapısı Server Action'ı korumaz.
     */
    path: "/users",
    title: "Kullanıcılar",
    access: "permission",
    permission: "user.read",
    nav: { label: "Kullanıcılar", order: 26 },
  },
  {
    /**
     * koala-admin#8. Approval is irreversible and is the gate in front of a
     * company posting jobs at all, so it gets its own permission rather than
     * riding along with anything else — `COMPANY_APPROVE` on the backend.
     */
    path: "/companies",
    title: "Şirket onayları",
    access: "permission",
    permission: "company.approve",
    nav: { label: "Şirket onayları", order: 30 },
  },
  {
    /**
     * The queue *and* the detail *and* the escrow operations, on one path.
     * There is no `GET /admin/disputes/{id}` to build a detail route on — see
     * the comment at the top of `src/app/(panel)/disputes/page.tsx` — so the
     * selected dispute travels in `?uyusmazlik=`, which needs no second entry
     * here and no second gate to keep in step with this one.
     */
    path: "/disputes",
    title: "Uyuşmazlıklar",
    access: "permission",
    permission: "dispute.resolve",
    nav: { label: "Uyuşmazlıklar", order: 40 },
  },
  {
    /**
     * Banka ekstresiyle mutabakat, escrow çıkışından ayrı bir operasyondur:
     * `payout.release` talimatı başlatır; `payout.reconcile` gerçekleşmiş banka
     * satırını kanıtlar. Backend de iki ucu ve iki izni ayrı tutar.
     */
    path: "/payout-reconciliation",
    title: "Hakediş banka mutabakatı",
    access: "permission",
    permission: "payout.reconcile",
    nav: { label: "Hakediş mutabakatı", order: 50 },
  },
  {
    /**
     * koala-admin#40. Backend `GET/PUT /admin/settings` `settings.manage`
     * ister; panelin kapısı aynı izin, yoksa OWNER sayı değiştirmek için
     * veritabanına iner.
     */
    path: "/settings",
    title: "Çalışma zamanı ayarları",
    access: "permission",
    permission: "settings.manage",
    nav: { label: "Ayarlar", order: 60 },
  },
  {
    /**
     * koala-admin#9, rol→izin yarısı. `role.manage`, ve bu izin tek başına
     * `/admin/roles`'un yedi ucunun tamamını açıyor — okumalar dâhil, çünkü
     * backend'de `role.read` diye bir izin yok.
     *
     * Rol *üyeliği* burada değil: o `staff.manage`'e bağlı ve `/staff`'ta.
     * İkisini tek ekranda toplamak, bir kişiye rol grafiğini gösterirken
     * personel kayıtlarını da göstermek olurdu — oysa backend bunları ayrı
     * izinlere bağlamış.
     */
    path: "/roles",
    title: "Roller ve izinler",
    access: "permission",
    permission: "role.manage",
    nav: { label: "Roller ve izinler", order: 70 },
  },
  {
    /**
     * koala-admin#9, personel yarısı — ADR-0014 ile dış yönetim konsolundan
     * devralınan iş.
     *
     * Kapı `staff.read`, `staff.manage` değil: sayfanın gösterdiği şey
     * `GET /admin/staff` ve backend onu `staff.read`'e bağlamış. Yazma formları
     * sayfanın içinde ayrıca `staff.manage`'e bakıyor, ve asıl kapı orada
     * değil — `runAuthorizationChange` her gönderimde izni yeniden çözüyor.
     */
    path: "/staff",
    title: "Personel",
    access: "permission",
    permission: "staff.read",
    nav: { label: "Personel", order: 80 },
  },
  {
    path: "/audit-log",
    title: "Denetim kaydı",
    access: "permission",
    permission: "audit.read",
    nav: { label: "Denetim kaydı", order: 90 },
  },
] as const satisfies readonly PanelRouteShape[];

export type PanelRoute = (typeof ROUTES)[number];

/** The literal union of every path the panel serves — a valid `Link` target. */
export type PanelRoutePath = PanelRoute["path"];

/**
 * Route handlers — one entry per `src/app/**\/route.ts`.
 *
 * Kept apart from the pages because they are never menu entries and never
 * `Link` targets, but held to the same rule: a handler that is not in this list
 * fails `routes.test.ts`. An API route is exactly as capable of leaking data as
 * a page, and rather more likely to be added without thinking about it.
 */
export const ROUTE_HANDLERS = [
  {
    path: "/api/health",
    title: "Sağlık yoklaması",
    access: "public",
    ungatedReason:
      "Yük dengeleyici çerezsiz çağırır ve yalnız 'ayaktayım' der; hiçbir iş verisi taşımaz.",
  },
  {
    path: "/api/disputes/[disputeId]/evidence/[evidenceId]/download",
    title: "Uyuşmazlık kanıtı indir",
    access: "permission",
    permission: "dispute.resolve",
  },
] as const satisfies readonly (RouteIdentity & RouteGate)[];

export type RouteHandlerEntry = (typeof ROUTE_HANDLERS)[number];

/** Permission-gated pages, narrowed so `permission` is present at the type level. */
export type GatedRoute = Extract<PanelRoute, { access: "permission" }>;

export function gatedRoutes(): readonly GatedRoute[] {
  return ROUTES.filter((route): route is GatedRoute => route.access === "permission");
}

/** A gated route that also appears in the menu — the only kind that can. */
type NavRoute = Extract<GatedRoute, { nav: object }>;

export interface NavEntry {
  /**
   * Narrowed to the menu's own routes rather than to every path the panel
   * serves, so `typedRoutes` checks the `<Link href>` against real routes and a
   * menu entry can never point at `/giris`.
   */
  readonly href: NavRoute["path"];
  readonly label: string;
  readonly permission: Permission;
  readonly order: number;
}

/**
 * The menu, for a given set of resolved permissions.
 *
 * The single place a permission becomes a menu entry. It takes the permission
 * list rather than reading it, so it is a pure function of the registry and the
 * backend's answer — no session, no roles, nothing to go stale.
 *
 * An empty list in means an empty menu out. That is the fail-closed path from
 * `getStaffContext()` arriving intact: there is no branch here that draws a
 * partial menu when permissions are missing, because "missing" and "none" are
 * deliberately the same thing.
 */
export function navigationFor(permissions: readonly Permission[]): readonly NavEntry[] {
  const held = new Set<Permission>(permissions);

  return ROUTES.filter(
    (route): route is NavRoute =>
      route.access === "permission" && "nav" in route && held.has(route.permission),
  )
    .map((route) => ({
      href: route.path,
      label: route.nav.label,
      permission: route.permission,
      order: route.nav.order,
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "tr"));
}
