import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_ESCROW_FORM_STATE, type EscrowFormState } from "@/lib/escrow-form";

import { EscrowOperationForm, type MoneyMovement } from "./escrow-operation-form";

/**
 * The confirmation, as a person meets it.
 *
 * Two claims are worth a test rather than a screenshot: the dialog shows the
 * server's figure and the server's party *in words*, and a double click
 * produces one submission. The second is checked with two clicks in the same
 * tick, which is what a real double click is and what a `disabled` attribute
 * alone does not catch — React has not re-rendered in between.
 */

const MOVEMENT: MoneyMovement = {
  confirmedAmount: "1240.5",
  amountText: "₺1.240,50",
  partyName: "Ayşe Yılmaz",
  partyRole: "İşçi",
  source: "jobAssignment.workerPayout",
};

const REASON = "İşçi işi tamamladı, itiraz kanıtlanamadı.";

beforeAll(() => {
  // jsdom does not implement the native dialog top layer.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

function renderForm(
  action: (state: EscrowFormState, formData: FormData) => Promise<EscrowFormState>,
  overrides: Partial<React.ComponentProps<typeof EscrowOperationForm>> = {},
) {
  return render(
    <EscrowOperationForm
      action={action}
      kind="RELEASE"
      assignmentId="assignment-1"
      disputeId="dispute-1"
      triggerLabel="Çıkışı gözden geçir"
      title="İşçiye çıkışı onayla"
      summary="Emanetteki tutar işçiye çıkacak."
      movement={MOVEMENT}
      {...overrides}
    />,
  );
}

const succeed = async (): Promise<EscrowFormState> => ({
  ...INITIAL_ESCROW_FORM_STATE,
  status: "SUCCEEDED",
  message: "Çıkış kaydı oluşturuldu.",
});

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe("step one keeps the money button shut", () => {
  it("will not open a confirmation until a reason long enough to read is written", async () => {
    renderForm(vi.fn(succeed));

    const trigger = screen.getByRole("button", { name: "Çıkışı gözden geçir" });
    expect(trigger).toBeDisabled();

    await user.type(screen.getByLabelText(/Gerekçe/), "kısa");
    expect(trigger).toBeDisabled();

    await user.type(screen.getByLabelText(/Gerekçe/), " ama yeterince uzun bir gerekçe");
    expect(trigger).toBeEnabled();
  });

  it("stays shut when the operation cannot be offered at all", async () => {
    renderForm(vi.fn(succeed), {
      disabledReason: "Para emanette değil (ödeme durumu: REFUNDED).",
    });

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);

    expect(screen.getByRole("button", { name: "Çıkışı gözden geçir" })).toBeDisabled();
    expect(screen.getByTestId("escrow-disabled-reason")).toHaveTextContent("REFUNDED");
  });
});

describe("step two restates the amount and the party", () => {
  it("shows the server's figure and the person who receives it, not a generic warning", async () => {
    renderForm(vi.fn(succeed));

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);
    await user.click(screen.getByRole("button", { name: "Çıkışı gözden geçir" }));

    const confirmation = screen.getByTestId("money-confirmation");
    expect(screen.getByTestId("confirmation-amount")).toHaveTextContent("₺1.240,50");
    expect(screen.getByTestId("confirmation-party")).toHaveTextContent("Ayşe Yılmaz");
    expect(confirmation).toHaveTextContent("İşçi");
    // Provenance, so the operator can see the panel did not work it out.
    expect(confirmation).toHaveTextContent("jobAssignment.workerPayout");
    // The reason is quoted back rather than left behind on the previous step.
    expect(screen.getByRole("dialog")).toHaveTextContent(REASON);
  });

  it("keeps the commit disabled until the amount is explicitly acknowledged", async () => {
    const action = vi.fn(succeed);
    renderForm(action);

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);
    await user.click(screen.getByRole("button", { name: "Çıkışı gözden geçir" }));

    const confirm = screen.getByTestId("escrow-confirm");
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("posts the operation key and the server's figure, and no field an operator could edit", async () => {
    let seen: FormData | null = null;
    const action = vi.fn(async (_state: EscrowFormState, formData: FormData) => {
      seen = formData;
      return succeed();
    });

    renderForm(action);

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);
    await user.click(screen.getByRole("button", { name: "Çıkışı gözden geçir" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByTestId("escrow-confirm"));

    await waitFor(() => expect(seen).not.toBeNull());
    const formData = seen as unknown as FormData;

    expect(formData.get("kind")).toBe("RELEASE");
    expect(formData.get("assignmentId")).toBe("assignment-1");
    expect(formData.get("reason")).toBe(REASON);
    expect(formData.get("confirmedAmount")).toBe("1240.5");
    expect(String(formData.get("operationKey")).length).toBeGreaterThan(0);
    // The amount travels as the server sent it; there is no editable amount
    // input anywhere on the form.
    expect(document.querySelector('input[name="amount"]')).toBeNull();
  });
});

describe("a double click", () => {
  it("submits once, because the second click happens before any re-render", async () => {
    // Held in a property rather than a `let`: the action must still be in
    // flight when the second click lands, which is the whole scenario.
    const gate: { release: () => void } = { release: () => undefined };
    const action = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return succeed();
    });

    renderForm(action);

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);
    await user.click(screen.getByRole("button", { name: "Çıkışı gözden geçir" }));
    await user.click(screen.getByRole("checkbox"));

    const confirm = screen.getByTestId("escrow-confirm");
    // Two clicks in one tick — not `await`ed apart, which is the whole point.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    gate.release();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});

describe("a resolution that touches no money", () => {
  it("asks for a reason but shows no amount", async () => {
    renderForm(vi.fn(succeed), {
      kind: "RESOLVE_DISPUTE",
      triggerLabel: "Kararı gözden geçir",
      title: "Uyuşmazlık kararını onayla",
      movement: null,
      choices: [
        {
          resolution: "DISMISSED",
          label: "Reddet (emanete dokunma)",
          description: "Emanete dokunulmaz.",
          movement: null,
          unavailableReason: null,
        },
      ],
    });

    // A single character is enough when nothing moves.
    await user.type(screen.getByLabelText(/Gerekçe/), "Kanıt yok.");
    await user.click(screen.getByRole("button", { name: "Kararı gözden geçir" }));

    expect(screen.queryByTestId("money-confirmation")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent("Bu karar emanetteki paraya dokunmaz.");
  });

  it("refuses to arm a decision the backend would reject", async () => {
    renderForm(vi.fn(succeed), {
      kind: "RESOLVE_DISPUTE",
      triggerLabel: "Kararı gözden geçir",
      title: "Uyuşmazlık kararını onayla",
      movement: null,
      choices: [
        {
          resolution: "RELEASE_TO_WORKER",
          label: "İşçiye çıkar",
          description: "Emanetteki tutar işçiye çıkar.",
          movement: null,
          unavailableReason: "Emanet özeti okunamadı.",
        },
      ],
    });

    await user.type(screen.getByLabelText(/Gerekçe/), REASON);
    await user.click(screen.getByRole("button", { name: "Kararı gözden geçir" }));
    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByTestId("escrow-confirm")).toBeDisabled();
  });
});
