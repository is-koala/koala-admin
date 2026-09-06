/**
 * The permission catalogue — the panel's half of koala-backend#14.
 *
 * Two things about this file are the point, and both are easy to undo by
 * accident:
 *
 *  1. **These names are not free text.** Every gate, every menu entry and every
 *     route in the registry is typed against {@link Permission}, so a typo is a
 *     compile error rather than a page that silently lets everybody in (a
 *     mistyped permission would never match, so a *deny* is the failure mode —
 *     but a mistyped permission in a `has(...)` call that was supposed to gate
 *     nothing is not, which is why the type is narrowed rather than trusted).
 *  2. **Nothing here maps a role to a permission.** ADR-0010 puts that graph in
 *     the backend's database and resolves it per request. Writing
 *     `CATALOG_EDITOR → category.manage` in this file would be the exact
 *     staleness the ADR exists to avoid, so the catalogue lists permissions and
 *     says nothing about who holds them.
 *
 * Source of truth: koala-backend#14's `/admin/**` mapping test, which forces
 * every admin endpoint to name one of these. The issue body for koala-admin#5
 * lists twelve; #14 added `content.moderate`, `badge.manage` and
 * `settings.manage` (three surfaces matched none of the twelve) and
 * `user.role.manage` for the marketplace role-grant endpoints. Sixteen.
 */

/** `sensitivity` on the backend's permission rows — what an audit reviewer cares about. */
export const PERMISSION_SENSITIVITIES = ["NORMAL", "PERSONAL_DATA", "FINANCIAL"] as const;

export type PermissionSensitivity = (typeof PERMISSION_SENSITIVITIES)[number];

interface PermissionSpecShape {
  /** Backend permission name, verbatim. */
  readonly name: string;
  /** True when holding it changes state rather than only reading it. */
  readonly mutating: boolean;
  readonly sensitivity: PermissionSensitivity;
  /** Turkish label, for anywhere the panel has to name a permission to a person. */
  readonly label: string;
}

/**
 * Ordered the way the backend groups them: catalogue, users, marketplace
 * operations, money, staff administration. The order is cosmetic; the names
 * are not.
 */
const CATALOGUE = [
  {
    name: "category.manage",
    mutating: true,
    sensitivity: "NORMAL",
    label: "İş kategorilerini yönet",
  },
  { name: "badge.manage", mutating: true, sensitivity: "NORMAL", label: "Rozetleri yönet" },
  { name: "settings.manage", mutating: true, sensitivity: "NORMAL", label: "Ayarları yönet" },
  {
    name: "content.moderate",
    mutating: true,
    sensitivity: "NORMAL",
    label: "İçerik denetle",
  },
  { name: "user.read", mutating: false, sensitivity: "NORMAL", label: "Kullanıcıları görüntüle" },
  {
    name: "user.read_pii",
    mutating: false,
    sensitivity: "PERSONAL_DATA",
    label: "Kullanıcı kimlik bilgilerini görüntüle",
  },
  {
    name: "user.role.manage",
    mutating: true,
    sensitivity: "NORMAL",
    label: "Kullanıcı rollerini yönet",
  },
  {
    name: "company.approve",
    mutating: true,
    sensitivity: "NORMAL",
    label: "Şirket başvurularını onayla",
  },
  {
    name: "dispute.resolve",
    mutating: true,
    sensitivity: "NORMAL",
    label: "Anlaşmazlıkları çöz",
  },
  {
    name: "payment.read",
    mutating: false,
    sensitivity: "FINANCIAL",
    label: "Ödemeleri görüntüle",
  },
  {
    name: "finance.read",
    mutating: false,
    sensitivity: "FINANCIAL",
    label: "Finans raporlarını görüntüle",
  },
  {
    name: "payout.release",
    mutating: true,
    sensitivity: "FINANCIAL",
    label: "Escrow'dan ödeme serbest bırak",
  },
  {
    name: "payment.refund",
    mutating: true,
    sensitivity: "FINANCIAL",
    label: "Ödeme iade et",
  },
  {
    name: "staff.manage",
    mutating: true,
    sensitivity: "PERSONAL_DATA",
    label: "Personel kayıtlarını yönet",
  },
  { name: "role.manage", mutating: true, sensitivity: "NORMAL", label: "Rol grafiğini yönet" },
  {
    name: "audit.read",
    mutating: false,
    sensitivity: "PERSONAL_DATA",
    label: "Denetim kaydını görüntüle",
  },
] as const satisfies readonly PermissionSpecShape[];

/**
 * The closed set of permission names the panel knows about.
 *
 * Derived from the catalogue rather than written twice, so the two can never
 * disagree.
 */
export type Permission = (typeof CATALOGUE)[number]["name"];

export type PermissionSpec = PermissionSpecShape & { readonly name: Permission };

export const PERMISSION_SPECS: readonly PermissionSpec[] = CATALOGUE;

export const PERMISSIONS: readonly Permission[] = CATALOGUE.map((spec) => spec.name);

const BY_NAME = new Map<string, PermissionSpec>(CATALOGUE.map((spec) => [spec.name, spec]));

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && BY_NAME.has(value);
}

export function permissionSpec(permission: Permission): PermissionSpec {
  const spec = BY_NAME.get(permission);
  /* v8 ignore next 3 -- unreachable: the parameter type is the map's key set. */
  if (spec === undefined) {
    throw new Error(`Bilinmeyen izin: ${permission}`);
  }
  return spec;
}

/** Turkish label for a permission, for a message a person has to read. */
export function permissionLabel(permission: Permission): string {
  return permissionSpec(permission).label;
}
