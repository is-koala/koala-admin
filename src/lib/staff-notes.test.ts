import { describe, expect, it } from "vitest";

import {
  FLAG_BATCH_MAX,
  FLAG_LABEL_MAX_LENGTH,
  NOTE_BODY_MAX_LENGTH,
  groupFlagsByResourceId,
  isStaffFlagKind,
  isStaffResourceType,
  listPathFor,
  objectPathFor,
  staffFlagKindLabel,
  staffFlagKindTone,
} from "./staff-notes";

describe("staff note and flag vocabulary", () => {
  it("keeps backend length and batch limits", () => {
    expect(NOTE_BODY_MAX_LENGTH).toBe(2000);
    expect(FLAG_LABEL_MAX_LENGTH).toBe(120);
    expect(FLAG_BATCH_MAX).toBe(200);
  });

  it("labels known kinds in Turkish and falls back to the raw code", () => {
    expect(staffFlagKindLabel("RISK")).toBe("Riskli");
    expect(staffFlagKindLabel("VIP")).toBe("VIP");
    expect(staffFlagKindLabel("WATCH")).toBe("İzlemede");
    expect(staffFlagKindLabel("OTHER")).toBe("Diğer");
    expect(staffFlagKindLabel("IMPERSONATION")).toBe("IMPERSONATION");
  });

  it("paints risk as danger and an unknown kind as neutral", () => {
    expect(staffFlagKindTone("RISK")).toBe("danger");
    expect(staffFlagKindTone("VIP")).toBe("brand");
    expect(staffFlagKindTone("WATCH")).toBe("warning");
    expect(staffFlagKindTone("OTHER")).toBe("neutral");
    expect(staffFlagKindTone("IMPERSONATION")).toBe("neutral");
  });

  it("accepts only the six resource types and four kinds the panel can write", () => {
    expect(isStaffResourceType("USER")).toBe(true);
    expect(isStaffResourceType("users")).toBe(false);
    expect(isStaffFlagKind("RISK")).toBe(true);
    expect(isStaffFlagKind("risk")).toBe(false);
  });
});

describe("grouping flags for list badges", () => {
  it("groups active flags by resource and drops cleared rows", () => {
    const grouped = groupFlagsByResourceId([
      { resourceId: "u-1", clearedAt: null, kind: "RISK" },
      { resourceId: "u-1", clearedAt: null, kind: "VIP" },
      { resourceId: "u-2", clearedAt: null, kind: "WATCH" },
      { resourceId: "u-3", clearedAt: "2026-09-15T10:00:00Z", kind: "RISK" },
    ]);

    expect(grouped.get("u-1")?.map((flag) => flag.kind)).toEqual(["RISK", "VIP"]);
    expect(grouped.get("u-2")?.map((flag) => flag.kind)).toEqual(["WATCH"]);
    expect(grouped.has("u-3")).toBe(false);
  });
});

describe("paths the write actions revalidate", () => {
  it("maps each resource type to its object and list page", () => {
    expect(objectPathFor("USER", "u-1")).toBe("/users/u-1");
    expect(objectPathFor("JOB_ASSIGNMENT", "a-1")).toBe("/assignments/a-1");
    expect(listPathFor("REPORT")).toBe("/reports");
    expect(listPathFor("COMPANY")).toBe("/companies");
  });
});
