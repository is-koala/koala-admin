import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "./badge";
import { Button, buttonClass } from "./button";
import { Dialog } from "./dialog";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { FormField, TextInput } from "./form-field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./table";

describe("Button", () => {
  it("defaults to a non-submitting type so a form cannot fire by accident", () => {
    render(<Button>Kaydet</Button>);
    expect(screen.getByRole("button", { name: "Kaydet" })).toHaveAttribute("type", "button");
  });

  it("keeps an explicit submit type when the caller is a form action", () => {
    render(
      <Button type="submit" variant="primary">
        Giriş yap
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Giriş yap" })).toHaveAttribute("type", "submit");
  });

  it("exposes the HeroUI BEM classes for native links on JS-free pages", () => {
    expect(buttonClass()).toContain("button--primary");
    expect(buttonClass({ variant: "danger-soft", size: "sm" })).toContain("button--danger-soft");
  });
});

describe("Table", () => {
  it("renders a caption for screen readers and one row per record", () => {
    render(
      <Table caption="İş kategorileri">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Ad</TableHeaderCell>
            <TableHeaderCell numeric>Adet</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Barista</TableCell>
            <TableCell numeric>12</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Garsonluk</TableCell>
            <TableCell numeric>4</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table", { name: "İş kategorileri" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("columnheader", { name: "Ad" })).toBeInTheDocument();
    expect(screen.getByText("Barista")).toBeInTheDocument();
  });
});

describe("FormField", () => {
  it("wires the label, hint and error to the control", async () => {
    render(
      <FormField
        id="category-name"
        label="Kategori adı"
        hint="Kullanıcıya görünen ad."
        error="Ad boş olamaz."
        required
      >
        {({ id, describedBy, invalid }) => (
          <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </FormField>,
    );

    const input = screen.getByLabelText(/Kategori adı/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Kullanıcıya görünen ad. Ad boş olamaz.");
  });
});

describe("EmptyState", () => {
  it("says nothing is here, without implying a failure", () => {
    render(<EmptyState title="Hiç iş kategorisi yok." description="Kategori seed'i kaldırıldı." />);

    expect(screen.getByText("Hiç iş kategorisi yok.")).toBeInTheDocument();
    // An empty result is not an error; nothing here should be announced as one.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("announces the failure and shows the request id", () => {
    render(
      <ErrorState
        title="Kategoriler yüklenemedi."
        description="Koala API'ye ulaşılamadı."
        errorCode="NETWORK_FAILURE"
        requestId="917829b9-cb2c-4586-82d5-29da1c9a623f"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Kategoriler yüklenemedi.");
    // On screen on purpose: it is what a support request can quote to find the
    // matching backend log line.
    expect(alert).toHaveTextContent("917829b9-cb2c-4586-82d5-29da1c9a623f");
    expect(alert).toHaveTextContent("NETWORK_FAILURE");
  });

  it("lists per-field messages from a validation failure", () => {
    render(
      <ErrorState
        title="Kaydedilemedi."
        details={[
          { field: "name", message: "Ad boş olamaz." },
          { field: "code", message: "Kod benzersiz olmalı." },
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Kod benzersiz olmalı\./)).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders its tone", () => {
    render(<Badge tone="warning">Zorunlu</Badge>);
    expect(screen.getByText("Zorunlu")).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("stays closed until asked", () => {
    render(<Dialog open={false} onClose={() => {}} title="Kategoriyi sil" />);
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
  });

  it("opens as a modal and reports Escape as a close", async () => {
    const onClose = vi.fn();
    // jsdom does not implement the native dialog top layer.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };

    render(
      <Dialog open onClose={onClose} title="Kategoriyi sil" description="Bu işlem geri alınamaz.">
        <p>Barista</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Bu işlem geri alınamaz.")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
