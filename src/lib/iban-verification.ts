/** Plain data shared by the client form and its Server Action. */

export const IBAN_VERIFICATION_FIELDS = {
  reference: "reference",
  senderIban: "senderIban",
  amount: "amount",
  senderName: "senderName",
} as const;

export type IbanVerificationField =
  (typeof IBAN_VERIFICATION_FIELDS)[keyof typeof IBAN_VERIFICATION_FIELDS];

export type IbanVerificationStatus = "IDLE" | "SUCCEEDED" | "REFUSED" | "BLOCKED";

export const BANK_ACCOUNT_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "EXPIRED",
] as const;

export type BankAccountVerificationStatus = (typeof BANK_ACCOUNT_VERIFICATION_STATUSES)[number];

const BANK_ACCOUNT_VERIFICATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  UNVERIFIED: "Doğrulanmadı",
  PENDING: "Bekliyor",
  VERIFIED: "Doğrulandı",
  EXPIRED: "Süresi doldu",
} satisfies Record<BankAccountVerificationStatus, string>;

/** Yalnız gösterim: bilinmeyen kod olduğu gibi yazılır, kullanıcı sayfası yeni bir durum yüzünden düşmez. */
export function bankAccountVerificationStatusLabel(status: string): string {
  return BANK_ACCOUNT_VERIFICATION_STATUS_LABELS[status] ?? status;
}

export interface VerifiedBankAccountSummary {
  readonly id: string;
  readonly maskedIban: string;
  readonly primary: boolean;
  readonly verificationStatus: BankAccountVerificationStatus;
}

export interface IbanVerificationState {
  readonly status: IbanVerificationStatus;
  readonly message: string;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly field: IbanVerificationField | null;
  readonly account: VerifiedBankAccountSummary | null;
}

export const INITIAL_IBAN_VERIFICATION_STATE: IbanVerificationState = {
  status: "IDLE",
  message: "",
  errorCode: null,
  requestId: null,
  field: null,
  account: null,
};

export type IbanVerificationAction = (
  previous: IbanVerificationState,
  formData: FormData,
) => Promise<IbanVerificationState> | IbanVerificationState;

/**
 * `IbanValidator.java` — TR + 24 karakter, boşluksuz 26, mod-97 checksum.
 *
 * Panel ikinci bir kural icat etmesin diye algoritma backend'inkiyle aynı;
 * biçim tutmazsa istek gitmez.
 */
export function isTurkishIban(iban: string): boolean {
  const normalized = iban.replaceAll(/\s/g, "");
  if (normalized.length !== 26 || !normalized.startsWith("TR")) {
    return false;
  }

  const reordered = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
  let numeric = "";
  for (const ch of reordered) {
    if (ch >= "A" && ch <= "Z") {
      numeric += String(ch.charCodeAt(0) - 55);
    } else if (ch >= "0" && ch <= "9") {
      numeric += ch;
    } else {
      return false;
    }
  }

  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}
