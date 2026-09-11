/**
 * Tanımlı çalışma zamanı ayarları — panelin `SettingKeys` yarısı.
 *
 * Backend yalnız bu anahtarları yazdırır (`PUT /admin/settings/rastgele` 400).
 * GET ise tablodaki satırları döner; satırı olmayan anahtar yaml varsayılanına
 * düşer. Operatörün "etkin değer / varsayılan" görmesi için katalog burada,
 * API'de değil: DTO `default` taşımaz.
 *
 * Varsayılanlar koala-backend CLAUDE.md §2ac ve seed changelog ile aynı
 * kaynaklıdır; buraya kopyalandılar çünkü panel backend'in yaml'ını okuyamaz.
 */

export const SETTING_KINDS = ["numeric", "rate", "version"] as const;

export type SettingKind = (typeof SETTING_KINDS)[number];

export interface RuntimeSettingSpec {
  readonly key: string;
  readonly kind: SettingKind;
  /** Yaml / seed başlangıç değeri. Boş sürüm eşiği kapının kapalı olduğu hâldir. */
  readonly defaultValue: string;
  readonly description: string;
}

export const RUNTIME_SETTINGS = [
  {
    key: "assignment.auto-completion.grace-days",
    kind: "numeric",
    defaultValue: "3",
    description: "İş bitiminden kaç gün sonra atama kendiliğinden tamamlansın.",
  },
  {
    key: "cancellation.free-window-hours",
    kind: "numeric",
    defaultValue: "24",
    description: "İşverenin cezasız iptal edebileceği süre (saat).",
  },
  {
    key: "cancellation.late-fee-rate",
    kind: "rate",
    defaultValue: "0.50",
    description: "Pencere içinde iptalde kesilen oran.",
  },
  {
    key: "assignment.unpaid-expiry.hours-before-start",
    kind: "numeric",
    defaultValue: "6",
    description: "Ödenmemiş atama iş başlangıcına kaç saat kala düşer.",
  },
  {
    key: "commission.rate",
    kind: "rate",
    defaultValue: "0.075",
    description: "İşveren ücretine eklenen hizmet bedeli oranı.",
  },
  {
    key: "app.minimum-version",
    kind: "version",
    defaultValue: "",
    description: "Bu sürümün altındaki istemci 426 alır; boşsa kapı kapalı.",
  },
  {
    key: "app.minimum-version.ios",
    kind: "version",
    defaultValue: "",
    description: "iOS eşiği; yoksa tekil eşiğe düşer.",
  },
  {
    key: "app.minimum-version.android",
    kind: "version",
    defaultValue: "",
    description: "Android eşiği; yoksa tekil eşiğe düşer.",
  },
  {
    key: "app.minimum-version.web",
    kind: "version",
    defaultValue: "",
    description: "Bağımsız web eşiği; boşsa yalnız web kapısı kapalı.",
  },
] as const satisfies readonly RuntimeSettingSpec[];

export type RuntimeSettingKey = (typeof RUNTIME_SETTINGS)[number]["key"];

const BY_KEY = new Map<string, RuntimeSettingSpec>(
  RUNTIME_SETTINGS.map((spec) => [spec.key, spec]),
);

export function isRuntimeSettingKey(value: string): value is RuntimeSettingKey {
  return BY_KEY.has(value);
}

export function runtimeSettingSpec(key: string): RuntimeSettingSpec | null {
  return BY_KEY.get(key) ?? null;
}

/** Backend'in `GET /admin/settings` satırı — DTO `key/value/description/updatedAt`. */
export interface StoredSetting {
  readonly key: string;
  readonly value: string;
  readonly description: string | null;
  readonly updatedAt: string | null;
}

export interface PresentedSetting {
  readonly key: RuntimeSettingKey;
  readonly kind: SettingKind;
  readonly defaultValue: string;
  readonly description: string;
  /** Tablodaki değer, satır yoksa katalog varsayılanı. */
  readonly effectiveValue: string;
  readonly updatedAt: string | null;
  readonly stored: boolean;
}

/**
 * Katalogdaki her tanımlı anahtarı, tabloda olmasa da gösterir.
 *
 * Backend satırı olmayan anahtarı listeden düşürür; operatör o zaman varsayılanı
 * göremez ve "bu anahtar yok" sanır. Birleşme burada, GET yanıtını genişletmek
 * için değil — backend sözleşmesi değişmesin diye.
 */
export function presentSettings(stored: readonly StoredSetting[]): readonly PresentedSetting[] {
  const byKey = new Map(stored.map((row) => [row.key, row]));

  return RUNTIME_SETTINGS.map((spec) => {
    const row = byKey.get(spec.key);
    const description =
      row !== undefined && row.description !== null && row.description.trim().length > 0
        ? row.description
        : spec.description;

    return {
      key: spec.key,
      kind: spec.kind,
      defaultValue: spec.defaultValue,
      description,
      effectiveValue: row?.value ?? spec.defaultValue,
      updatedAt: row?.updatedAt ?? null,
      stored: row !== undefined,
    };
  });
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const VERSION_CORE = /^\d{1,9}(\.\d{1,9})*$/;

export interface SettingValueProblem {
  readonly message: string;
  readonly field: "key" | "value";
}

/**
 * Backend `SettingsManager.update` ile aynı reddetmeler, istek gitmeden.
 *
 * Oranlar `[0, 1]`; diğer sayılar işaretli ondalık; sürüm anahtarları
 * `AppVersion.isParsable`. Tanımsız anahtar 400'dür, serbest depo değil.
 */
export function validateSettingWrite(key: string, value: string): SettingValueProblem | null {
  const spec = runtimeSettingSpec(key);
  if (spec === null) {
    return {
      field: "key",
      message: "Bu anahtar tanımlı değil. Yalnız katalogdaki politika sayıları yazılabilir.",
    };
  }

  if (value.length === 0) {
    return { field: "value", message: "Ayar değeri zorunludur." };
  }

  if (value.length > 512) {
    return { field: "value", message: "Ayar değeri en fazla 512 karakter olabilir." };
  }

  if (spec.kind === "version") {
    if (!isParsableAppVersion(value)) {
      return { field: "value", message: "Değer 1.4.0 biçiminde bir sürüm olmalı." };
    }
    return null;
  }

  if (!NUMERIC.test(value)) {
    return { field: "value", message: "Ayar değeri sayısal olmalıdır." };
  }

  if (spec.kind === "rate" && !isRateInUnitInterval(value)) {
    return { field: "value", message: "Bu ayar 0 ile 1 arasında bir oran olmalıdır." };
  }

  return null;
}

function isParsableAppVersion(value: string): boolean {
  const core = value.split(/[+\-]/, 2)[0] ?? "";
  return VERSION_CORE.test(core);
}

function isRateInUnitInterval(value: string): boolean {
  if (!NUMERIC.test(value)) return false;
  if (value.startsWith("-")) return false;
  const [whole, fraction = ""] = value.split(".");
  if (whole === undefined) return false;
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  if (integer === "0") return true;
  if (integer !== "1") return false;
  return fraction === "" || /^0+$/.test(fraction);
}
