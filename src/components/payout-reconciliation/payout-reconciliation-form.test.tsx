import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_PAYOUT_RECONCILIATION_STATE,
  type PayoutReconciliationAction,
} from "@/lib/payout-reconciliation";

import { PayoutReconciliationForm } from "./payout-reconciliation-form";

const VALUES = {
  payoutId: "9c000000-0000-4000-8000-000000000033",
  settlementReference: "TRF-2026-000033",
  providerReference: "iyz-transaction-000033",
  amount: "1234.50",
  currency: "TRY",
  settledAt: "2026-09-09T09:30:00Z",
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

async function fillForm() {
  const settlement = screen.getByLabelText(/^Ekstre satırı referansı/);
  const settledAt = screen.getByLabelText(/^Gerçekleşme anı/);
  await user.clear(settlement);
  await user.type(settlement, VALUES.settlementReference);
  if ((settledAt as HTMLInputElement).value !== VALUES.settledAt) {
    await user.clear(settledAt);
    await user.type(settledAt, VALUES.settledAt);
  }
}

const idleAction: PayoutReconciliationAction = async () => INITIAL_PAYOUT_RECONCILIATION_STATE;
const RECORDED_PAYOUT = {
  payoutId: VALUES.payoutId,
  providerReference: VALUES.providerReference,
  amount: VALUES.amount,
  currency: VALUES.currency,
  settlementReference: VALUES.providerReference,
  settledAt: VALUES.settledAt,
};

function renderForm(action: PayoutReconciliationAction = idleAction) {
  return render(<PayoutReconciliationForm action={action} recordedPayout={RECORDED_PAYOUT} />);
}

describe("the two-step evidence confirmation", () => {
  it("marks all six inputs as required for forms and assistive technology", () => {
    renderForm();

    for (const label of [
      /^Hakediş kimliği/,
      /^Ekstre satırı referansı/,
      /^Sağlayıcı referansı/,
      /^Tutar/,
      /^Para birimi/,
      /^Gerçekleşme anı/,
    ]) {
      const input = screen.getByLabelText(label);
      expect(input).toBeRequired();
      expect(input).toHaveAttribute("aria-required", "true");
    }
  });

  it("does not submit on review and restates every bank fact before commit", async () => {
    const action = vi.fn(idleAction);
    renderForm(action);
    await fillForm();

    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));

    expect(action).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    for (const value of Object.values(VALUES)) {
      expect(dialog).toHaveTextContent(value);
    }
    expect(screen.getByRole("button", { name: "Mutabakatı gönder" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /kanıtları doğruladım/ }));
    expect(screen.getByRole("button", { name: "Mutabakatı gönder" })).toBeEnabled();
  });

  it("uses an ISO instant text field instead of a timezone-losing datetime-local control", () => {
    renderForm();

    const settledAt = screen.getByLabelText(/^Gerçekleşme anı/);
    expect(settledAt).toHaveAttribute("type", "text");
    expect(settledAt).toHaveAttribute("placeholder", "2026-09-09T09:30:00Z");
  });

  it("locks system evidence while leaving the two statement facts editable", () => {
    renderForm();

    for (const [label, value] of [
      [/^Hakediş kimliği/, VALUES.payoutId],
      [/^Sağlayıcı referansı/, VALUES.providerReference],
      [/^Tutar/, VALUES.amount],
      [/^Para birimi/, VALUES.currency],
    ] as const) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute("readonly");
    }

    expect(screen.getByLabelText(/^Ekstre satırı referansı/)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^Gerçekleşme anı/)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^Ekstre satırı referansı/)).toHaveValue(VALUES.providerReference);
    expect(screen.getByLabelText(/^Gerçekleşme anı/)).toHaveValue(VALUES.settledAt);
    expect(
      screen.getByText(
        "Sağlayıcı onayı kayıttan dolduruldu. Banka ekstresinde farklı bir satır varsa düzeltin; yoksa gözden geçirip onaylayın.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hakedişte kayıtlı tutar; ekstredeki tutarla karşılaştırın."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hakedişte kayıtlı para birimi; ekstreyle aynı olmalı."),
    ).toBeInTheDocument();
  });
});

describe("submitting evidence", () => {
  it("turns two clicks in one tick into one Server Action", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    const action = vi.fn<PayoutReconciliationAction>(async (_previous, _formData) => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return INITIAL_PAYOUT_RECONCILIATION_STATE;
    });
    renderForm(action);
    await fillForm();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /kanıtları doğruladım/ }));

    const submit = screen.getByRole("button", { name: "Mutabakatı gönder" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const posted = action.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(posted)).toEqual(VALUES);
    gate.release();
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });

  it("cannot be closed while pending and keeps the eventual receipt visible", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    const action = vi.fn<PayoutReconciliationAction>(async (_previous, _formData) => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return {
        ...INITIAL_PAYOUT_RECONCILIATION_STATE,
        status: "SUCCEEDED",
        message: "Hakediş banka ekstresiyle mutabık kılındı.",
        payout: {
          id: VALUES.payoutId,
          amount: VALUES.amount,
          currency: VALUES.currency,
          completedAt: VALUES.settledAt,
        },
      };
    });
    renderForm(action);
    await fillForm();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /kanıtları doğruladım/ }));
    await user.click(screen.getByRole("button", { name: "Mutabakatı gönder" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());

    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    gate.release();
    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveTextContent(VALUES.payoutId);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows only backend-confirmed payout fields as success", async () => {
    const action = vi.fn(async () => ({
      ...INITIAL_PAYOUT_RECONCILIATION_STATE,
      status: "SUCCEEDED" as const,
      message: "Hakediş banka ekstresiyle mutabık kılındı.",
      payout: {
        id: VALUES.payoutId,
        amount: "1234.50",
        currency: "TRY",
        completedAt: "2026-09-09T09:30:00Z",
      },
    }));
    renderForm(action);
    await fillForm();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /kanıtları doğruladım/ }));
    await user.click(screen.getByRole("button", { name: "Mutabakatı gönder" }));

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent(VALUES.payoutId);
    expect(result).toHaveTextContent("1234.50 TRY");
    expect(result).toHaveTextContent("2026-09-09T09:30:00Z");
  });

  it("keeps a refusal message, code and request id visible", async () => {
    const action = vi.fn(async () => ({
      ...INITIAL_PAYOUT_RECONCILIATION_STATE,
      status: "REFUSED" as const,
      message: "Ekstre tutarı eşleşmiyor.",
      errorCode: "PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH",
      requestId: "rid-mismatch",
    }));
    renderForm(action);
    await fillForm();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /kanıtları doğruladım/ }));
    await user.click(screen.getByRole("button", { name: "Mutabakatı gönder" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ekstre tutarı eşleşmiyor.");
    expect(alert).toHaveTextContent("PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH");
    expect(alert).toHaveTextContent("rid-mismatch");
  });
});
