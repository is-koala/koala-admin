import { describe, expect, it } from "vitest";

import {
  BOARDING_FLAGS,
  boardingFlagInfo,
  boardingKindLabel,
  boardingRecorderRoleLabel,
  boardingSourceLabel,
} from "./boarding";

/**
 * koala-admin#133: T2 biniş sözlüğü. Etiketler gösterim içindir; bilinmeyen
 * kod olduğu gibi yazılır çünkü yeni bir backend değeri yüzünden atama sayfası
 * düşmemeli.
 */

describe("boardingSourceLabel", () => {
  it("words the three sources as the issue does", () => {
    expect(boardingSourceLabel("WORKER_SCANNED_SHUTTLE_QR")).toBe("İşçi servis QR'ını okuttu");
    expect(boardingSourceLabel("EMPLOYER_SCANNED_WORKER_QR")).toBe("İşveren işçi QR'ını okuttu");
    expect(boardingSourceLabel("EMPLOYER_MARKED")).toBe("İşveren elle işaretledi");
  });

  it("returns an unknown source untouched, even one that is a name on every object", () => {
    expect(boardingSourceLabel("DRIVER_TAPPED")).toBe("DRIVER_TAPPED");
    expect(boardingSourceLabel("constructor")).toBe("constructor");
    expect(boardingFlagInfo("toString").label).toBe("toString");
  });
});

describe("boardingKindLabel and boardingRecorderRoleLabel", () => {
  it("says marked, not proven", () => {
    expect(boardingKindLabel("BOARDED")).toBe("Biniş kaydedildi");
    expect(boardingKindLabel("NO_SHOW")).toBe("Gelmedi olarak işaretlendi");
    expect(boardingKindLabel("ALIGHTED")).toBe("Biniş olayı (ALIGHTED)");
    expect(boardingKindLabel(null)).toBe("Biniş olayı");
  });

  it("calls the employer side a side, because a company representative is not the employer", () => {
    expect(boardingRecorderRoleLabel("WORKER")).toBe("İşçi");
    expect(boardingRecorderRoleLabel("EMPLOYER")).toBe("İşveren tarafı");
    expect(boardingRecorderRoleLabel("STAFF")).toBe("STAFF");
  });
});

describe("boardingFlagInfo", () => {
  it("explains all five flags the backend can put on a boarding", () => {
    expect(BOARDING_FLAGS).toEqual([
      "LATE_SYNC",
      "DEVICE_TIME_IMPLAUSIBLE",
      "OFF_SCHEDULE",
      "FAR_FROM_STOP",
      "STATIC_QR",
    ]);
    for (const flag of BOARDING_FLAGS) {
      const info = boardingFlagInfo(flag);
      expect(info.code).toBe(flag);
      expect(info.label).not.toBe(flag);
      expect(info.explanation).not.toBeNull();
      expect(info.explanation?.length).toBeGreaterThan(30);
    }
  });

  it("keeps an unknown flag as its code with no explanation rather than inventing one", () => {
    expect(boardingFlagInfo("SOMETHING_NEW")).toEqual({
      code: "SOMETHING_NEW",
      label: "SOMETHING_NEW",
      explanation: null,
    });
  });
});
