import { describe, expect, it } from "vitest";

import {
  ibanVerificationsForUserHref,
  paymentHref,
  paymentsHref,
  staffMemberHref,
} from "./panel-href";

const ALICE = "5f000000-0000-4000-8000-000000000055";

describe("staffMemberHref", () => {
  it("anchors the staff row and pre-filters by email when it is known", () => {
    expect(staffMemberHref(ALICE)).toBe(`/staff#personel-${ALICE}`);
    expect(staffMemberHref(ALICE, "a+b@koala.local")).toBe(
      `/staff?ara=a%2Bb%40koala.local#personel-${ALICE}`,
    );
  });
});

/** koala-admin#108/#111: ödeme nesnesi iki girişten, IBAN kuyruğu kullanıcıya süzülür. */
describe("payment and IBAN queue addresses", () => {
  const PAYMENT_ID = "7b000000-0000-4000-8000-000000000071";
  const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";
  const USER_ID = "b2000000-0000-4000-8000-000000000002";

  it("carries the assignment from the assignment page and the list view from the payments list", () => {
    expect(paymentHref(PAYMENT_ID)).toBe(`/payments/${PAYMENT_ID}`);
    expect(paymentHref(PAYMENT_ID, ASSIGNMENT_ID)).toBe(
      `/payments/${PAYMENT_ID}?atama=${ASSIGNMENT_ID}`,
    );
    expect(paymentHref(PAYMENT_ID, null, { durum: "VERIFY_PENDING", sayfa: "0" })).toBe(
      `/payments/${PAYMENT_ID}?durum=VERIFY_PENDING&sayfa=0`,
    );
    expect(paymentsHref({ durum: "VERIFY_PENDING" })).toBe("/payments?durum=VERIFY_PENDING");
    expect(paymentsHref()).toBe("/payments");
  });

  it("filters the IBAN queue with the panel's kullanici key", () => {
    expect(ibanVerificationsForUserHref(USER_ID)).toBe(`/iban-verifications?kullanici=${USER_ID}`);
  });
});
