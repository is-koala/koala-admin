import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DecisionForm } from "./decision-form";
import {
  decisionFailed,
  decisionRejected,
  initialDecisionState,
  type DecisionAction,
  type DecisionState,
} from "./decision-state";
import { QueueFilters } from "./filters";
import { QueueLoadFailure } from "./load-failure";
import { QueuePager } from "./pager";

/**
 * The shared queue pattern, exercised once so both queues inherit the evidence.
 *
 * The two assertions that matter are about *where* things happen. The filter
 * and the pager are GET forms, so what they produce is a URL — which is the
 * only way "the filter goes to the server" can be true of a screen. And the
 * decision form refuses to submit without a written reason, which is a rule
 * both koala-admin#7 and #8 state and neither backend enforces.
 */

/** Every `name=value` a GET form would put in the query string. */
function formPairs(form: HTMLFormElement): Array<[string, string]> {
  return [...new FormData(form).entries()].map(([key, value]) => [key, String(value)]);
}

function theForm(): HTMLFormElement {
  const form = document.querySelector("form");
  if (form === null) throw new Error("Form render edilmedi.");
  return form;
}

describe("the filter bar puts the filter in the URL", () => {
  it("is a GET form, so the filter is a request rather than a client-side slice", () => {
    render(
      <QueueFilters
        filters={[
          {
            name: "durum",
            label: "Durum",
            value: "OPEN",
            options: [
              { value: "OPEN", label: "Açık" },
              { value: "ACTIONED", label: "Haklı bulundu" },
            ],
          },
        ]}
      />,
    );

    expect(theForm().method).toBe("get");
    expect(screen.getByLabelText("Durum")).toHaveValue("OPEN");
  });

  it("resets to the first page, because page 4 of another filter means nothing", () => {
    render(
      <QueueFilters
        filters={[
          {
            name: "durum",
            label: "Durum",
            value: "OPEN",
            options: [{ value: "OPEN", label: "Açık" }],
          },
        ]}
        carry={{ boyut: "50" }}
      />,
    );

    expect(formPairs(theForm())).toEqual([
      ["sayfa", "0"],
      ["boyut", "50"],
      ["durum", "OPEN"],
    ]);
  });

  it("says what cannot be filtered, so nobody hunts for a control that does not exist", () => {
    render(
      <QueueFilters
        filters={[
          {
            name: "durum",
            label: "Durum",
            value: "OPEN",
            options: [{ value: "OPEN", label: "Açık" }],
          },
        ]}
        notice="Şikayet türüne göre süzme backend'de yok."
      />,
    );

    expect(screen.getByText("Şikayet türüne göre süzme backend'de yok.")).toBeInTheDocument();
  });
});

describe("the pager asks the server for another page", () => {
  const window = { page: 1, size: 20, totalElements: 41, totalPages: 3, first: false, last: false };

  it("carries the current filter forward so paging does not reset it", () => {
    render(
      <QueuePager
        window={window}
        state={{ durum: "OPEN", sirala: "createdAt,desc" }}
        unit="şikayet"
      />,
    );

    expect(formPairs(theForm())).toEqual([
      ["durum", "OPEN"],
      ["sirala", "createdAt,desc"],
    ]);
    expect(screen.getByRole("button", { name: "Önceki" })).toHaveValue("0");
    expect(screen.getByRole("button", { name: "Sonraki" })).toHaveValue("2");
  });

  it("counts pages and rows from the backend's own page metadata", () => {
    render(<QueuePager window={window} state={{}} unit="şikayet" />);

    expect(screen.getByText(/Sayfa 2 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/toplam 41 şikayet/)).toBeInTheDocument();
  });

  it("trusts first/last rather than guessing from the page number", () => {
    render(
      <QueuePager
        window={{ page: 0, size: 20, totalElements: 3, totalPages: 1, first: true, last: true }}
        state={{}}
        unit="şirket"
      />,
    );

    expect(screen.getByRole("button", { name: "Önceki" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sonraki" })).toBeDisabled();
  });

  it("never shows 'sayfa 1 / 0' on an empty queue", () => {
    render(
      <QueuePager
        window={{ page: 0, size: 20, totalElements: 0, totalPages: 0, first: true, last: true }}
        state={{}}
        unit="şikayet"
      />,
    );

    expect(screen.getByText(/Sayfa 1 \/ 1/)).toBeInTheDocument();
  });

  it("drops any stale page parameter it is handed", () => {
    render(<QueuePager window={window} state={{ sayfa: "9", durum: "OPEN" }} unit="şikayet" />);

    expect(formPairs(theForm())).toEqual([["durum", "OPEN"]]);
  });
});

describe("a queue the backend would not hand over", () => {
  it("shows the backend's verdict rather than an empty table", () => {
    // An empty table would read as "nobody has filed a report", which is the
    // one thing a safety queue must never say by accident.
    render(
      <QueueLoadFailure
        subject="Şikayet kuyruğu"
        permission="content.moderate"
        failure={{ kind: "forbidden", errorCode: "ACCESS_DENIED", requestId: "rid-403" }}
      />,
    );

    expect(screen.getByText("Backend bu işlem için yetki vermedi.")).toBeInTheDocument();
    expect(screen.getByText("rid-403")).toBeInTheDocument();
    expect(screen.getByText(/content.moderate/)).toBeInTheDocument();
  });

  it("keeps an ordinary failure distinguishable from a refusal", () => {
    render(
      <QueueLoadFailure
        subject="Şirket kuyruğu"
        permission="company.approve"
        failure={{
          kind: "error",
          message: "Koala API zaman aşımına uğradı.",
          errorCode: "REQUEST_TIMEOUT",
          requestId: null,
        }}
      />,
    );

    expect(screen.getByText("Şirket kuyruğu yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByText("Koala API zaman aşımına uğradı.")).toBeInTheDocument();
  });
});

const OPTIONS = [
  {
    value: "ACTIONED",
    label: "Haklı bulundu",
    consequence: "Şikayet haklı bulunarak kapanır.",
    irreversible: true,
  },
  {
    value: "UNDER_REVIEW",
    label: "Ek bilgi bekleniyor",
    consequence: "Şikayet açık kalır ve incelemeye alındı olarak işaretlenir.",
  },
];

/** A stand-in Server Action, typed so the `FormData` it received stays typed. */
function stubAction(result: DecisionState = initialDecisionState) {
  return vi.fn<DecisionAction>(async () => result);
}

function renderDecision(action = stubAction()) {
  render(
    <DecisionForm
      action={action}
      hiddenFields={{ reportId: "report-1" }}
      options={OPTIONS}
      legend="Karar"
      noteLabel="Gerekçe"
      submitLabel="Kararı gönder"
      idPrefix="report-1"
    />,
  );
  return action;
}

describe("a decision says what it will do, and will not go without a reason", () => {
  it("shows every option's consequence in the markup, not behind a hover", () => {
    renderDecision();

    // The selected option's sentence appears twice — once on the radio and once
    // in the summary — and the unselected one still appears, unrevealed.
    expect(screen.getAllByText("Şikayet haklı bulunarak kapanır.")).toHaveLength(2);
    expect(
      screen.getAllByText("Şikayet açık kalır ve incelemeye alındı olarak işaretlenir."),
    ).toHaveLength(1);
  });

  it("repeats the selected consequence directly above the button", async () => {
    renderDecision();

    const summary = screen.getByText("Bu karar ne yapacak?").parentElement;
    expect(summary?.textContent).toContain("Şikayet haklı bulunarak kapanır.");

    await userEvent.click(screen.getByLabelText(/Ek bilgi bekleniyor/));

    expect(summary?.textContent).toContain(
      "Şikayet açık kalır ve incelemeye alındı olarak işaretlenir.",
    );
  });

  it("marks a decision the backend cannot undo", () => {
    renderDecision();

    expect(screen.getByText("Geri alınamaz")).toBeInTheDocument();
  });

  it("refuses to submit until a reason is written", async () => {
    const action = renderDecision();
    const submit = screen.getByRole("button", { name: "Kararı gönder" });

    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Gerekçe/), "kısa");
    expect(submit).toBeDisabled();
    expect(screen.getByText(/en az 10 karakter/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Gerekçe/), " ama yeterince uzun");
    expect(submit).toBeEnabled();
    expect(action).not.toHaveBeenCalled();
  });

  it("sends the decision, the reason and the record id together", async () => {
    const action = stubAction();
    renderDecision(action);

    await userEvent.click(screen.getByLabelText(/Ek bilgi bekleniyor/));
    await userEvent.type(screen.getByLabelText(/Gerekçe/), "Kanıt yetersiz, ek bilgi istendi.");
    await userEvent.click(screen.getByRole("button", { name: "Kararı gönder" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    const submitted = action.mock.calls[0]?.[1];
    if (submitted === undefined) throw new Error("Server Action FormData almadı.");
    expect(submitted.get("reportId")).toBe("report-1");
    expect(submitted.get("decision")).toBe("UNDER_REVIEW");
    expect(submitted.get("note")).toBe("Kanıt yetersiz, ek bilgi istendi.");
  });

  it("renders the backend's refusal with its request id", async () => {
    const action = stubAction(
      decisionFailed("Bu işlem için yetkiniz yok.", "ACCESS_DENIED", "rid-9"),
    );
    renderDecision(action);

    await userEvent.type(screen.getByLabelText(/Gerekçe/), "Yeterince uzun bir gerekçe.");
    await userEvent.click(screen.getByRole("button", { name: "Kararı gönder" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Bu işlem için yetkiniz yok."),
    );
    expect(screen.getByRole("alert").textContent).toContain("rid-9");
  });

  it("puts a field-level refusal on the field it is about", async () => {
    const action = stubAction(decisionRejected("Gerekçe çok kısa.", "note"));
    renderDecision(action);

    await userEvent.type(screen.getByLabelText(/Gerekçe/), "Yeterince uzun bir gerekçe.");
    await userEvent.click(screen.getByRole("button", { name: "Kararı gönder" }));

    await waitFor(() => expect(screen.getByText("Gerekçe çok kısa.")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains itself instead of rendering controls when no decision is possible", () => {
    render(
      <DecisionForm
        action={stubAction()}
        hiddenFields={{ reportId: "report-2" }}
        options={OPTIONS}
        legend="Karar"
        noteLabel="Gerekçe"
        submitLabel="Kararı gönder"
        idPrefix="report-2"
        disabled
        disabledReason="Bu şikayet zaten sonuçlandırılmış."
      />,
    );

    expect(screen.getByText("Bu şikayet zaten sonuçlandırılmış.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kararı gönder" })).toBeNull();
  });
});
