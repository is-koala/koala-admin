import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";
import type { PresentedSetting } from "@/lib/runtime-settings";

import { SettingsManager } from "./settings-manager";

const COMMISSION: PresentedSetting = {
  key: "commission.rate",
  kind: "rate",
  defaultValue: "0.075",
  description: "İşveren ücretine eklenen hizmet bedeli oranı.",
  effectiveValue: "0.10",
  updatedAt: "2026-09-11T08:00:00Z",
  stored: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the settings table", () => {
  it("shows key, effective value, default and description", () => {
    render(<SettingsManager settings={[COMMISSION]} updateAction={vi.fn()} />);

    expect(screen.getByRole("table", { name: "Çalışma zamanı ayarları" })).toBeInTheDocument();
    expect(screen.getByText("commission.rate")).toBeInTheDocument();
    expect(screen.getByText("0.10")).toBeInTheDocument();
    expect(screen.getByText("0.075")).toBeInTheDocument();
    expect(screen.getByText("İşveren ücretine eklenen hizmet bedeli oranı.")).toBeInTheDocument();
  });

  it("keeps a 400 in operator language with the backend requestId", async () => {
    const refused: AuthorizationChangeOutcome = {
      status: "REFUSED",
      message: "Bu ayar 0 ile 1 arasında bir oran olmalıdır.",
      errorCode: "SETTING_VALUE_OUT_OF_RANGE",
      requestId: "rid-range",
      field: "value",
    };
    const updateAction: AuthorizationChangeAction = vi.fn(async () => refused);
    const user = userEvent.setup();

    render(<SettingsManager settings={[COMMISSION]} updateAction={updateAction} />);

    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(updateAction).toHaveBeenCalledOnce());
    expect(screen.getByText("Bu ayar 0 ile 1 arasında bir oran olmalıdır.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Yeni değer/)).toHaveAccessibleDescription(/0 ile 1/);
  });
});
