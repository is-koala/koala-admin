import { describe, expect, it } from "vitest";

import { staffMemberHref } from "./panel-href";

const ALICE = "5f000000-0000-4000-8000-000000000055";

describe("staffMemberHref", () => {
  it("anchors the staff row and pre-filters by email when it is known", () => {
    expect(staffMemberHref(ALICE)).toBe(`/staff#personel-${ALICE}`);
    expect(staffMemberHref(ALICE, "a+b@koala.local")).toBe(
      `/staff?ara=a%2Bb%40koala.local#personel-${ALICE}`,
    );
  });
});
