import { describe, expect, it } from "vitest";

import {
  presentSettings,
  runtimeSettingSpec,
  validateSettingWrite,
  type StoredSetting,
} from "./runtime-settings";

describe("the runtime settings catalogue", () => {
  it("pins the rate keys the backend clamps to [0, 1]", () => {
    expect(runtimeSettingSpec("commission.rate")).toMatchObject({
      kind: "rate",
      defaultValue: "0.075",
    });
    expect(runtimeSettingSpec("cancellation.late-fee-rate")).toMatchObject({
      kind: "rate",
      defaultValue: "0.50",
    });
  });

  it("pins hour and day keys as unbounded numeric policy", () => {
    expect(runtimeSettingSpec("cancellation.free-window-hours")?.kind).toBe("numeric");
    expect(runtimeSettingSpec("assignment.auto-completion.grace-days")?.defaultValue).toBe("3");
    expect(runtimeSettingSpec("assignment.unpaid-expiry.hours-before-start")?.defaultValue).toBe(
      "6",
    );
  });

  it("treats empty version thresholds as the closed gate", () => {
    expect(runtimeSettingSpec("app.minimum-version")?.defaultValue).toBe("");
    expect(runtimeSettingSpec("app.minimum-version.web")?.kind).toBe("version");
  });

  it("does not invent a key the backend would 400", () => {
    expect(runtimeSettingSpec("rastgele.anahtar")).toBeNull();
  });
});

describe("presenting stored rows against the catalogue", () => {
  it("uses the catalogue default when the table has no row", () => {
    const presented = presentSettings([]);
    const commission = presented.find((row) => row.key === "commission.rate");

    expect(commission).toMatchObject({
      effectiveValue: "0.075",
      defaultValue: "0.075",
      stored: false,
      updatedAt: null,
    });
  });

  it("overlays the table value without losing the default", () => {
    const stored: StoredSetting[] = [
      {
        key: "commission.rate",
        value: "0.10",
        description: "Canlı komisyon.",
        updatedAt: "2026-09-11T08:00:00Z",
      },
    ];

    const commission = presentSettings(stored).find((row) => row.key === "commission.rate");

    expect(commission).toMatchObject({
      effectiveValue: "0.10",
      defaultValue: "0.075",
      description: "Canlı komisyon.",
      stored: true,
      updatedAt: "2026-09-11T08:00:00Z",
    });
  });

  it("does not drop defined keys that the GET omitted", () => {
    expect(presentSettings([]).map((row) => row.key)).toContain(
      "assignment.unpaid-expiry.hours-before-start",
    );
  });
});

describe("writes the backend would refuse stay off the wire", () => {
  it("rejects an unknown key in operator language", () => {
    expect(validateSettingWrite("rastgele.anahtar", "1")).toEqual({
      field: "key",
      message: "Bu anahtar tanımlı değil. Yalnız katalogdaki politika sayıları yazılabilir.",
    });
  });

  it("rejects a blank value", () => {
    expect(validateSettingWrite("commission.rate", "")?.field).toBe("value");
  });

  it("rejects a non-numeric value on a numeric key", () => {
    expect(validateSettingWrite("cancellation.free-window-hours", "yirmi dört")).toEqual({
      field: "value",
      message: "Ayar değeri sayısal olmalıdır.",
    });
  });

  it("rejects a commission rate above one without clamping it", () => {
    expect(validateSettingWrite("commission.rate", "1.5")).toEqual({
      field: "value",
      message: "Bu ayar 0 ile 1 arasında bir oran olmalıdır.",
    });
  });

  it("rejects a negative rate", () => {
    expect(validateSettingWrite("cancellation.late-fee-rate", "-0.1")?.field).toBe("value");
  });

  it("accepts the inclusive rate bounds the backend accepts", () => {
    expect(validateSettingWrite("commission.rate", "0")).toBeNull();
    expect(validateSettingWrite("commission.rate", "1")).toBeNull();
    expect(validateSettingWrite("commission.rate", "0.10")).toBeNull();
  });

  it("does not apply the unit-interval rule to hour keys", () => {
    expect(validateSettingWrite("cancellation.free-window-hours", "24")).toBeNull();
  });

  it("accepts a dotted app version and refuses free text", () => {
    expect(validateSettingWrite("app.minimum-version", "1.4.0")).toBeNull();
    expect(validateSettingWrite("app.minimum-version.ios", "not-a-version")).toEqual({
      field: "value",
      message: "Değer 1.4.0 biçiminde bir sürüm olmalı.",
    });
  });
});
