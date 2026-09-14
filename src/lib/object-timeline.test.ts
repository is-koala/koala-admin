import { describe, expect, it } from "vitest";

import { categoryCreatedEntry, refusedEntry } from "../../test/fixtures/audit-log";
import type { AuditEntry } from "./audit-log";
import { TimelineBuilder, auditTimelineEvents, mergeTimeline } from "./object-timeline";

/**
 * koala-admin#107: iki kaynağın tek kronolojiye inmesi. Sıralama etikete
 * değil zamana göre; aynı anda önce kaydın kendi olayı, sonra personel
 * kararı. Tarihi çözülemeyen kayıt hiç girmez.
 */

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  ...categoryCreatedEntry,
  requestBody: null,
  before: null,
  after: null,
  ...overrides,
});

describe("TimelineBuilder", () => {
  it("drops null and unparsable instants instead of misplacing them", () => {
    const events = new TimelineBuilder()
      .push(null, "Yok")
      .push(undefined, "Yok")
      .push("dün", "Bozuk")
      .push("2026-09-01T10:00:00Z", "Var", { detail: "ayrıntı" })
      .build();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      label: "Var",
      detail: "ayrıntı",
      source: "record",
      allowed: true,
      actor: null,
    });
  });

  it("gives two pushes of the same label and instant distinct keys", () => {
    const events = new TimelineBuilder()
      .push("2026-09-01T10:00:00Z", "Mesai girişi")
      .push("2026-09-01T10:00:00Z", "Mesai girişi")
      .build();
    expect(new Set(events.map((event) => event.key)).size).toBe(2);
  });
});

describe("auditTimelineEvents", () => {
  it("keeps the action, the permission, the actor and the backend's verdict", () => {
    const [allowed, refused] = auditTimelineEvents([
      entry(),
      entry({ ...refusedEntry, requestBody: null, before: null, after: null }),
    ]);

    expect(allowed).toMatchObject({
      at: categoryCreatedEntry.occurredAt,
      label: "job.category.create",
      detail: "category.manage",
      source: "audit",
      allowed: true,
      actor: {
        kind: "staff",
        staffId: categoryCreatedEntry.actorStaffId,
        name: "Katalog Editörü",
      },
      key: `audit:${categoryCreatedEntry.id}`,
    });
    expect(refused).toMatchObject({ allowed: false, actor: { name: "Destek Uzmanı" } });
  });

  it("drops a row whose instant cannot be parsed", () => {
    expect(auditTimelineEvents([entry({ occurredAt: "not-a-date" })])).toHaveLength(0);
  });
});

describe("mergeTimeline", () => {
  it("interleaves record and audit events by time, oldest first", () => {
    const record = new TimelineBuilder()
      .push("2026-09-01T09:00:00Z", "Atama oluşturuldu")
      .push("2026-09-03T09:00:00Z", "İş tamamlandı")
      .build();
    const audit = auditTimelineEvents([
      entry({ id: "a-2", occurredAt: "2026-09-04T09:00:00Z", action: "payout.release" }),
      entry({ id: "a-1", occurredAt: "2026-09-02T09:00:00Z", action: "job-assignments.read" }),
    ]);

    const labels = mergeTimeline(record, audit).map((event) => event.label);

    expect(labels).toEqual([
      "Atama oluşturuldu",
      "job-assignments.read",
      "İş tamamlandı",
      "payout.release",
    ]);
  });

  it("puts the record's own event before the staff decision that shares its instant", () => {
    const at = "2026-09-02T09:00:00Z";
    const audit = auditTimelineEvents([entry({ occurredAt: at, action: "companies.approve" })]);
    const record = new TimelineBuilder().push(at, "Şirket onaylandı").build();

    const merged = mergeTimeline(audit, record);

    expect(merged.map((event) => event.source)).toEqual(["record", "audit"]);
  });

  it("keeps the given order among events of one source at one instant", () => {
    const at = "2026-09-02T09:00:00Z";
    const record = new TimelineBuilder().push(at, "Mesai girişi").push(at, "Mesai çıkışı").build();
    expect(mergeTimeline(record).map((event) => event.label)).toEqual([
      "Mesai girişi",
      "Mesai çıkışı",
    ]);
  });
});
