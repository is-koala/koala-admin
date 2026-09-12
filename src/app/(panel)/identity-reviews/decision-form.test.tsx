import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialDecisionState,
  type DecisionAction,
  type DecisionState,
} from "@/components/panel/queue/decision-state";

const { mockSubmit } = vi.hoisted(() => ({
  mockSubmit: vi.fn<DecisionAction>(async () => initialDecisionState),
}));

vi.mock("./actions", () => ({
  submitIdentityReviewDecision: (state: DecisionState, formData: FormData) =>
    mockSubmit(state, formData),
}));

const { IdentityReviewDecision } = await import("./decision-form");

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";

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
  mockSubmit.mockClear();
  mockSubmit.mockImplementation(async () => initialDecisionState);
});

describe("identity approve confirmation", () => {
  it("does not submit until the irreversible confirmation is acknowledged", async () => {
    render(<IdentityReviewDecision reviewId={REVIEW_ID} returnTo="/identity-reviews" canApprove />);

    await user.click(screen.getByRole("button", { name: "Kimliği onayla" }));

    expect(mockSubmit).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("geri alınamaz");
    expect(screen.getByRole("button", { name: "Onayı gönder" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /geri alınamayacağını/ }));
    expect(screen.getByRole("button", { name: "Onayı gönder" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Onayı gönder" }));
    expect(mockSubmit).toHaveBeenCalledOnce();
  });

  it("keeps reject available when approve is closed", () => {
    render(
      <IdentityReviewDecision
        reviewId={REVIEW_ID}
        returnTo="/identity-reviews"
        canApprove={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Kimliği onayla" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İncelemeyi reddet" })).toBeEnabled();
  });
});
