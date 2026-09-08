import { describe, expect, it } from "vitest";

import { asRoleCode, asRoleId, parseRoleOptionValue, roleOptionValue } from "./role-identity";

/**
 * `uuid:KOD` çiftinin yazanı ve okuyanı.
 *
 * Marka tarafının testi yok ve olamaz: `RoleId` ile `RoleCode` çalışma anında
 * var olmayan şeyler, ikisini karıştıran bir satır `tsc`'de kırılıyor — bir
 * `expect` ile değil. Ölçülebilen taraf bu dosyada: bozuk bir çiftin **sessizce
 * yarım bir isteğe** dönüşmemesi.
 */

const ROLE_ID = "9a1c0f10-0003-4c00-8000-000000000009";

describe("kapsama seçeneğinin değeri", () => {
  it("yazdığını geri okuyor", () => {
    const value = roleOptionValue({ id: asRoleId(ROLE_ID), code: asRoleCode("FINANCE_OFFICER") });

    expect(value).toBe(`${ROLE_ID}:FINANCE_OFFICER`);
    expect(parseRoleOptionValue(value)).toEqual({ id: ROLE_ID, code: "FINANCE_OFFICER" });
  });

  it("iki noktası olmayan bir değeri reddediyor", () => {
    /**
     * Kusurun kendisi. Eskiden yalnız ilk yarı okunuyordu: `"COPUK"` bir
     * `includedRoleId` sayılıyor, istek gönderiliyor ve rolün adı olması
     * gereken yer boş kalıyordu — "TRUST_LEAD artık  rolünü kapsıyor".
     */
    expect(parseRoleOptionValue("COPUK")).toBeNull();
  });

  it("boş bir değeri reddediyor", () => {
    expect(parseRoleOptionValue("")).toBeNull();
  });

  it("yarısı boş bir çifti reddediyor", () => {
    expect(parseRoleOptionValue(`${ROLE_ID}:`)).toBeNull();
    expect(parseRoleOptionValue(":FINANCE_OFFICER")).toBeNull();
  });

  it("ayırıcısı birden fazla olan bir değeri tahmin etmeye çalışmıyor", () => {
    // Ne UUID ne rol kodu iki nokta içeriyor; içeriyorsa değer bozulmuş
    // demektir ve bozulmuş bir adresi kurtarmaya çalışmak yanlış rolü
    // yazmakla biterdi.
    expect(parseRoleOptionValue(`${ROLE_ID}:FINANCE:OFFICER`)).toBeNull();
  });
});
