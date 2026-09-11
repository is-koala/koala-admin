import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";

import { BadgeManager, type BadgeRecord } from "./badge-manager";

const BADGE: BadgeRecord = {
  id: "ba000000-0000-4000-8000-000000000001",
  code: "GEZGIN_SILVER",
  family: "GEZGIN",
  tier: "SILVER",
  name: "Gezgin Gümüş",
  description: "5 tamamlanmış iş.",
  iconUrl: null,
  sortOrder: 10,
  ruleType: "COMPLETED_ASSIGNMENTS",
  minCount: 5,
  minAverageRating: null,
  minReviewCount: null,
  active: true,
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

function renderManager(
  badges: readonly BadgeRecord[],
  overrides: Partial<{
    createAction: AuthorizationChangeAction;
    updateAction: AuthorizationChangeAction;
    iconAction: AuthorizationChangeAction;
    activationAction: AuthorizationChangeAction;
  }> = {},
) {
  const unchanged = vi.fn(async () => IDLE_AUTHORIZATION_OUTCOME);
  return render(
    <BadgeManager
      badges={badges}
      createAction={overrides.createAction ?? unchanged}
      updateAction={overrides.updateAction ?? unchanged}
      iconAction={overrides.iconAction ?? unchanged}
      activationAction={overrides.activationAction ?? unchanged}
    />,
  );
}

describe("an empty catalogue", () => {
  it("offers creation directly and opens a complete badge form", async () => {
    renderManager([]);

    expect(screen.getByText("Hiç rozet yok.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "İlk rozeti ekle" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Rozet ekle");
    expect(screen.getByLabelText(/^Kod/)).toHaveAttribute("pattern", "[A-Z][A-Z0-9_]{1,63}");
    expect(screen.getByLabelText(/^Ad/)).toHaveAttribute("maxlength", "255");
    expect(screen.getByLabelText("Katalogda etkin")).toBeChecked();
  });
});

describe("editing", () => {
  it("prefills every field, keeps the code locked, and shows the backend requestId", async () => {
    const refused: AuthorizationChangeOutcome = {
      status: "REFUSED",
      message: "Bu rozet kodu zaten kullanılıyor.",
      errorCode: "BADGE_CODE_ALREADY_EXISTS",
      requestId: "rid-duplicate",
      field: "code",
    };
    const updateAction = vi.fn(async () => refused);
    renderManager([BADGE], { updateAction });

    await user.click(screen.getByRole("button", { name: "Gezgin Gümüş rozetini düzenle" }));

    const code = screen.getByLabelText(/^Kod/);
    const name = screen.getByLabelText(/^Ad/);
    expect(code).toHaveValue("GEZGIN_SILVER");
    expect(code).toHaveAttribute("readonly");
    expect(name).toHaveValue("Gezgin Gümüş");
    expect(screen.getByLabelText(/^İş sayısı eşiği/)).toHaveValue("5");

    await user.clear(name);
    await user.type(name, "Gezgin Gümüş+");
    await user.click(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalledOnce());
    expect(name).toHaveValue("Gezgin Gümüş+");
    expect(screen.getByRole("status")).toHaveTextContent("rid-duplicate");
    expect(screen.getByRole("status")).toHaveTextContent("BADGE_CODE_ALREADY_EXISTS");
  });
});

describe("icon and activation", () => {
  it("opens the icon dialog for the selected badge", async () => {
    renderManager([BADGE]);

    await user.click(screen.getByRole("button", { name: "Gezgin Gümüş ikonunu değiştir" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Rozet ikonunu değiştir");
    expect(screen.getByLabelText(/^Görsel/)).toHaveAttribute("type", "file");
  });

  it("turns a double click into one activation with the selected id", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    let seen: FormData | null = null;
    const activationAction = vi.fn(
      async (_state: AuthorizationChangeOutcome, formData: FormData) => {
        seen = formData;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        return {
          ...IDLE_AUTHORIZATION_OUTCOME,
          status: "SUCCEEDED" as const,
          message: "Pasifleştirildi.",
        };
      },
    );
    renderManager([BADGE], { activationAction });

    await user.click(screen.getByRole("button", { name: "Gezgin Gümüş rozetini pasifleştir" }));
    const submit = screen.getByRole("button", { name: "Pasifleştir" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(activationAction).toHaveBeenCalledOnce());
    expect((seen as unknown as FormData).get("badgeId")).toBe(BADGE.id);
    expect((seen as unknown as FormData).get("active")).toBe("false");
    gate.release();
    await waitFor(() => expect(activationAction).toHaveBeenCalledOnce());
  });
});
