import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_IBAN_VERIFICATION_STATE,
  type IbanVerificationAction,
} from "@/lib/iban-verification";

import { IbanVerificationForm } from "./iban-verification-form";

const VALUES = {
  reference: "KOALA-9F3A2C",
  senderIban: "TR18 0006 2001 1900 0006 6723 15",
  amount: "0.17",
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

async function fillRequired() {
  await user.type(screen.getByLabelText(/^Ekstre referansı/), VALUES.reference);
  await user.type(screen.getByLabelText(/^Gönderen IBAN/), VALUES.senderIban);
  await user.type(screen.getByLabelText(/^Tutar/), VALUES.amount);
}

const idleAction: IbanVerificationAction = async () => INITIAL_IBAN_VERIFICATION_STATE;

describe("the two-step statement confirmation", () => {
  it("prefills reference and amount from a queue row", () => {
    render(
      <IbanVerificationForm
        action={idleAction}
        defaults={{ reference: VALUES.reference, amount: VALUES.amount }}
      />,
    );

    expect(screen.getByLabelText(/^Ekstre referansı/)).toHaveValue(VALUES.reference);
    expect(screen.getByLabelText(/^Tutar/)).toHaveValue(VALUES.amount);
    expect(screen.getByLabelText(/^Gönderen IBAN/)).toHaveValue("");
  });

  it("does not require a sender name", () => {
    render(<IbanVerificationForm action={idleAction} />);

    expect(screen.getByLabelText(/^Ekstre referansı/)).toBeRequired();
    expect(screen.getByLabelText(/^Gönderen IBAN/)).toBeRequired();
    expect(screen.getByLabelText(/^Tutar/)).toBeRequired();
    expect(screen.getByLabelText(/^Gönderen adı/)).not.toBeRequired();
  });

  it("does not submit on review and restates the statement facts", async () => {
    const action = vi.fn(idleAction);
    render(<IbanVerificationForm action={action} />);
    await fillRequired();

    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));

    expect(action).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(VALUES.reference);
    expect(dialog).toHaveTextContent(VALUES.senderIban);
    expect(dialog).toHaveTextContent(VALUES.amount);
    expect(screen.getByRole("button", { name: "Doğrulamayı gönder" })).toBeDisabled();
  });
});

describe("submitting the confirmation", () => {
  it("shows masked IBAN and VERIFIED from the action result", async () => {
    const action = vi.fn(async () => ({
      ...INITIAL_IBAN_VERIFICATION_STATE,
      status: "SUCCEEDED" as const,
      message: "IBAN doğrulaması tamamlandı.",
      account: {
        id: "7c000000-0000-4000-8000-000000000048",
        maskedIban: "TR18***2315",
        primary: true,
        verificationStatus: "VERIFIED" as const,
      },
    }));
    render(<IbanVerificationForm action={action} />);
    await fillRequired();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /ekstre satırını doğruladım/ }));
    await user.click(screen.getByRole("button", { name: "Doğrulamayı gönder" }));

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("TR18***2315");
    expect(result).toHaveTextContent("VERIFIED");
  });

  it("turns two clicks in one tick into one Server Action", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    const action = vi.fn<IbanVerificationAction>(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return INITIAL_IBAN_VERIFICATION_STATE;
    });
    render(<IbanVerificationForm action={action} />);
    await fillRequired();
    await user.click(screen.getByRole("button", { name: "Kanıtı gözden geçir" }));
    await user.click(screen.getByRole("checkbox", { name: /ekstre satırını doğruladım/ }));

    const submit = screen.getByRole("button", { name: "Doğrulamayı gönder" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    gate.release();
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });
});
