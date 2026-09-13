import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";

import { AuthorizationForm } from "./authorization-form";

function succeeded(message: string): AuthorizationChangeOutcome {
  return {
    status: "SUCCEEDED",
    message,
    errorCode: null,
    requestId: null,
    field: null,
  };
}

function stubAction(
  outcome: AuthorizationChangeOutcome = IDLE_AUTHORIZATION_OUTCOME,
): AuthorizationChangeAction {
  return vi.fn(async () => outcome);
}

describe("AuthorizationForm", () => {
  it("keeps the success notice after the row closes on refresh", async () => {
    const action = stubAction(succeeded("Rol atandı."));
    const props = {
      action,
      hiddenFields: { userId: "u-1" },
      submitLabel: "Rol ekle",
      consequence: "Seçilen rol kullanıcıya yazılır.",
      idPrefix: "user-role",
    };

    const { rerender } = render(<AuthorizationForm {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Rol ekle" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Rol atandı"));

    rerender(<AuthorizationForm {...props} disabled disabledReason="Bu değişiklik yapılamaz." />);

    expect(screen.getByRole("status").textContent).toContain("Rol atandı");
    expect(screen.getByText("Bu değişiklik yapılamaz.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rol ekle" })).toBeNull();
  });
});
