import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";

import { CategoryManager, type CategoryRecord } from "./category-manager";

const CATEGORY: CategoryRecord = {
  id: "ca000000-0000-4000-8000-000000000001",
  code: "BARISTA",
  name: "Barista",
  requiresInsurance: true,
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
  categories: readonly CategoryRecord[],
  overrides: Partial<{
    createAction: AuthorizationChangeAction;
    updateAction: AuthorizationChangeAction;
    deleteAction: AuthorizationChangeAction;
  }> = {},
) {
  const unchanged = vi.fn(async () => IDLE_AUTHORIZATION_OUTCOME);
  return render(
    <CategoryManager
      categories={categories}
      createAction={overrides.createAction ?? unchanged}
      updateAction={overrides.updateAction ?? unchanged}
      deleteAction={overrides.deleteAction ?? unchanged}
    />,
  );
}

describe("an empty catalogue", () => {
  it("offers creation directly and opens a complete category form", async () => {
    renderManager([]);

    expect(screen.getByText("Hiç iş kategorisi yok.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "İlk kategoriyi ekle" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Kategori ekle");
    expect(screen.getByLabelText(/^Kod/)).toHaveAttribute("pattern", "[A-Z][A-Z0-9_]{1,63}");
    expect(screen.getByLabelText(/^Ad/)).toHaveAttribute("maxlength", "255");
    expect(screen.getByLabelText("Sigorta zorunlu")).not.toBeChecked();
  });
});

describe("editing", () => {
  it("prefills every field and keeps edits visible with the backend requestId", async () => {
    const refused: AuthorizationChangeOutcome = {
      status: "REFUSED",
      message: "Bu kategori kodu zaten kullanılıyor.",
      errorCode: "JOB_CATEGORY_CODE_ALREADY_EXISTS",
      requestId: "rid-duplicate",
      field: "code",
    };
    const updateAction = vi.fn(async () => refused);
    renderManager([CATEGORY], { updateAction });

    await user.click(screen.getByRole("button", { name: "Barista kategorisini düzenle" }));

    const code = screen.getByLabelText(/^Kod/);
    const name = screen.getByLabelText(/^Ad/);
    expect(code).toHaveValue("BARISTA");
    expect(name).toHaveValue("Barista");
    expect(screen.getByLabelText("Sigorta zorunlu")).toBeChecked();

    await user.clear(name);
    await user.type(name, "Kıdemli Barista");
    await user.click(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalledOnce());
    expect(name).toHaveValue("Kıdemli Barista");
    expect(screen.getByRole("status")).toHaveTextContent("rid-duplicate");
    expect(screen.getByRole("status")).toHaveTextContent("JOB_CATEGORY_CODE_ALREADY_EXISTS");
  });

  it("associates an insurance validation error with its checkbox", async () => {
    const blocked: AuthorizationChangeOutcome = {
      status: "BLOCKED",
      message: "Sigorta gereksinimi geçerli değil.",
      errorCode: "PANEL_VALIDATION_FAILED",
      requestId: null,
      field: "requiresInsurance",
    };
    renderManager([], { createAction: vi.fn(async () => blocked) });

    await user.click(screen.getByRole("button", { name: "İlk kategoriyi ekle" }));
    await user.type(screen.getByLabelText(/^Kod/), "BARISTA");
    await user.type(screen.getByLabelText(/^Ad/), "Barista");
    await user.click(screen.getByRole("button", { name: "Kategori oluştur" }));

    const checkbox = screen.getByLabelText("Sigorta zorunlu");
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-describedby"));
    const errorId = checkbox.getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    expect(document.getElementById(errorId ?? "")).toHaveTextContent(
      "Sigorta gereksinimi geçerli değil.",
    );
  });
});

describe("deleting", () => {
  it("cancels without a request and requires an explicit irreversible acknowledgement", async () => {
    const deleteAction = vi.fn(async () => IDLE_AUTHORIZATION_OUTCOME);
    renderManager([CATEGORY], { deleteAction });

    await user.click(screen.getByRole("button", { name: "Barista kategorisini sil" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("BARISTA");
    expect(screen.getByRole("dialog")).toHaveTextContent("geri alınamaz");
    expect(screen.getByRole("button", { name: "Kategoriyi kalıcı olarak sil" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(deleteAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Barista kategorisini sil" }));
    await user.click(screen.getByRole("checkbox", { name: /geri alınamayacağını/ }));
    expect(screen.getByRole("button", { name: "Kategoriyi kalıcı olarak sil" })).toBeEnabled();
  });

  it("turns a double click into one DELETE action with the selected id and confirmation", async () => {
    const gate: { release: () => void } = { release: () => undefined };
    let seen: FormData | null = null;
    const deleteAction = vi.fn(async (_state: AuthorizationChangeOutcome, formData: FormData) => {
      seen = formData;
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return { ...IDLE_AUTHORIZATION_OUTCOME, status: "SUCCEEDED" as const, message: "Silindi." };
    });
    renderManager([CATEGORY], { deleteAction });

    await user.click(screen.getByRole("button", { name: "Barista kategorisini sil" }));
    await user.click(screen.getByRole("checkbox", { name: /geri alınamayacağını/ }));
    const submit = screen.getByRole("button", { name: "Kategoriyi kalıcı olarak sil" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
    expect((seen as unknown as FormData).get("categoryId")).toBe(CATEGORY.id);
    expect((seen as unknown as FormData).get("deleteConfirmation")).toBe(`DELETE:${CATEGORY.id}`);
    gate.release();
    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
  });

  it("associates a server confirmation error with the acknowledgement checkbox", async () => {
    const blocked: AuthorizationChangeOutcome = {
      status: "BLOCKED",
      message: "Açık silme onayı gerekli.",
      errorCode: "PANEL_VALIDATION_FAILED",
      requestId: null,
      field: "deleteConfirmation",
    };
    renderManager([CATEGORY], { deleteAction: vi.fn(async () => blocked) });

    await user.click(screen.getByRole("button", { name: "Barista kategorisini sil" }));
    const checkbox = screen.getByRole("checkbox", { name: /geri alınamayacağını/ });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Kategoriyi kalıcı olarak sil" }));

    await waitFor(() => expect(checkbox).toHaveAttribute("aria-describedby"));
    const errorId = checkbox.getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    expect(document.getElementById(errorId ?? "")).toHaveTextContent("Açık silme onayı gerekli.");
  });
});
