import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  categoryCreatedEntry,
  erasedDetailEntry,
  refusedEntry,
} from "../../../test/fixtures/audit-log";
import type { AuditEntry } from "@/lib/audit-log";

import { AuditLogTable } from "./audit-log-table";

/**
 * The table and its side panel, in a DOM.
 *
 * `audit.test.ts` covers what goes out on the wire; this file covers the four
 * things koala-admin#10 asks the *screen* to do — make a refusal stand out,
 * make `FINANCIAL` tellable apart, print an absolute timestamp with its
 * seconds, and say out loud when a detail record has been erased instead of
 * drawing an empty panel.
 */

/** The fixtures are wire bodies; the component takes the parsed row. */
function toEntry(body: typeof categoryCreatedEntry): AuditEntry {
  return {
    ...body,
    requestBody: body.requestBody === null ? null : JSON.stringify(body.requestBody, null, 2),
    before: body.before === null ? null : JSON.stringify(body.before, null, 2),
    after: body.after === null ? null : JSON.stringify(body.after, null, 2),
  };
}

const ENTRIES: AuditEntry[] = [
  toEntry(categoryCreatedEntry),
  toEntry(refusedEntry),
  toEntry(erasedDetailEntry),
];

const LABELS = {
  "category.manage": "İş kategorilerini yönet",
  "payout.release": "Escrow'dan ödeme serbest bırak",
};

function renderTable(entries: readonly AuditEntry[] = ENTRIES) {
  return render(<AuditLogTable entries={entries} permissionLabels={LABELS} />);
}

function rows() {
  return screen.getAllByTestId("audit-row");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the table renders the page the server sent", () => {
  it("draws one row per entry, in the order given, filtering nothing", async () => {
    renderTable();

    expect(rows()).toHaveLength(3);
    expect(rows().map((row) => row.getAttribute("data-allowed"))).toEqual([
      "true",
      "false",
      "true",
    ]);
  });

  it("shows absolute Europe/Istanbul timestamps down to the second", async () => {
    renderTable([toEntry(categoryCreatedEntry)]);

    // 06:20:31 UTC is 09:20:31 in Istanbul. Seconds are kept because two
    // /admin calls a second apart are two decisions, not a duplicate line.
    const cell = within(rows()[0] as HTMLElement).getByText("06.09.2026 09:20:31");
    expect(cell).toHaveAttribute("dateTime", categoryCreatedEntry.occurredAt);

    // And nothing anywhere says "3 dakika önce".
    expect(screen.queryByText(/önce/)).not.toBeInTheDocument();
  });
});

describe("a refused row is the one you have to be able to see", () => {
  it("marks it, names it, and tints it differently from the allowed rows", async () => {
    renderTable();

    const [allowed, refused] = rows() as [HTMLElement, HTMLElement];

    expect(within(allowed).getByText("İzin verildi")).toBeInTheDocument();
    expect(within(refused).getByText("Reddedildi")).toBeInTheDocument();

    // Not merely a badge: the row itself is drawn differently, so a reviewer
    // scanning twenty-five lines finds it without reading every one.
    expect(refused.className).not.toBe(allowed.className);
    expect(refused.className).toContain("danger");
  });
});

describe("sensitivity is a badge and FINANCIAL is not one of the crowd", () => {
  it("labels all three classes and gives the financial one its own tone", async () => {
    renderTable();

    expect(screen.getAllByText("Normal")).toHaveLength(2);
    expect(screen.getByText("Finansal")).toBeInTheDocument();

    const normal = screen.getAllByText("Normal")[0] as HTMLElement;
    const financial = screen.getByText("Finansal");
    expect(financial.className).not.toBe(normal.className);

    expect(rows().map((row) => row.getAttribute("data-sensitivity"))).toEqual([
      "NORMAL",
      "NORMAL",
      "FINANCIAL",
    ]);
  });
});

describe("row detail opens in a side panel", () => {
  it("shows the core record and the detail record when both are there", async () => {
    renderTable();

    expect(screen.queryByTestId("audit-detail")).not.toBeInTheDocument();

    await userEvent.click(
      within(rows()[0] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );

    const panel = screen.getByTestId("audit-detail");
    expect(panel).toHaveAttribute("data-detail-present", "true");
    expect(within(panel).getByText("10.4.2.19")).toBeInTheDocument();
    // The request body and the "after" snapshot are separate blocks.
    expect(within(panel).getByText(/"name": "Kurye"/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/"id": "9a1c0f10-0001-4c00-8000-000000000009"/),
    ).toBeInTheDocument();
    // The permission's Turkish label, resolved on the server and passed in.
    expect(within(panel).getByText("İş kategorilerini yönet")).toBeInTheDocument();
  });

  it("says why an erased detail is empty instead of showing empty fields", async () => {
    // The acceptance criterion, verbatim: a row with no detail must explain
    // itself. An empty panel is indistinguishable from a rendering bug, and the
    // two mean opposite things — one is a KVKK erasure working as designed.
    renderTable();

    await userEvent.click(
      within(rows()[2] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );

    const panel = screen.getByTestId("audit-detail");
    expect(panel).toHaveAttribute("data-detail-present", "false");
    expect(within(panel).getByTestId("audit-detail-erased")).toHaveTextContent(
      "saklama süresi dolduğu için detay silindi, çekirdek kayıt duruyor",
    );

    // The core record is still all there, which is the other half of the claim.
    expect(within(panel).getByText("Finans Sorumlusu")).toBeInTheDocument();
    // 2026-03-01T11:05:44Z, in Istanbul, to the second.
    expect(within(panel).getByText("01.03.2026 14:05:44")).toBeInTheDocument();
    expect(within(panel).getByText("Escrow'dan ödeme serbest bırak")).toBeInTheDocument();
    expect(within(panel).getByText("Finansal")).toBeInTheDocument();

    // And no blank IP / user-agent fields pretending to be data.
    expect(within(panel).queryByText("User agent")).not.toBeInTheDocument();
  });

  it("closes, and swaps to another row without closing first", async () => {
    renderTable();

    await userEvent.click(
      within(rows()[0] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );
    await userEvent.click(
      within(rows()[1] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );

    expect(screen.getByTestId("audit-detail")).toHaveTextContent("Destek Uzmanı");

    await userEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByTestId("audit-detail")).not.toBeInTheDocument();
  });

  it("offers no way to change or delete a row", async () => {
    // The audit log's value is that it cannot be edited from where it is read.
    renderTable();
    await userEvent.click(
      within(rows()[0] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons.filter((label) => label !== "Ayrıntı" && label !== "Kapat")).toEqual([]);
  });
});

describe("nothing happens on its own", () => {
  it("fetches nothing and schedules nothing while the page sits open", async () => {
    // Reading the audit log is itself an audited, sensitive read
    // (koala-backend#15), so a poller would spend the afternoon writing rows
    // about itself into the table it is polling. The assertion is about
    // *scheduling*, not about markup: a timer that has not fired yet is still
    // a poller.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderTable();
    // Ten minutes of an operator reading the screen.
    await vi.advanceTimersByTimeAsync(600_000);

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });

  it("opens a row's detail without a request, because the row is already here", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderTable();
    await userEvent.click(
      within(rows()[0] as HTMLElement).getByRole("button", { name: "Ayrıntı" }),
    );

    expect(screen.getByTestId("audit-detail")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
