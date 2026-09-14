import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListSearchForm, SearchResultSummary, activeSearch, searchEmptyTitle } from "./search-form";

/**
 * koala-admin#94'ün ortak arama kutusu. Kanıtın büyük kısmı bir URL: form GET
 * olduğu için ürettiği şey bir sorgu dizesidir ve "arama sunucuya gider"
 * ancak öyle doğru olabilir. Geri kalanı, kutunun kendi hakkında söyledikleri.
 */

function formPairs(form: HTMLFormElement): Array<[string, string]> {
  return [...new FormData(form).entries()].map(([key, value]) => [key, String(value)]);
}

function theForm(): HTMLFormElement {
  const form = document.querySelector("form");
  if (form === null) throw new Error("Form render edilmedi.");
  return form;
}

const BASE = {
  id: "atama-ara",
  label: "Atamalarda ara",
  pathname: "/assignments",
} as const;

describe("the search box is a GET form named q", () => {
  it("submits q with the carried view and resets the page to the first", () => {
    render(
      <ListSearchForm
        {...BASE}
        query="ayşe"
        state={{ durum: "PENDING", sirala: "createdAt,desc", boyut: "20", sayfa: "3" }}
      />,
    );

    const form = theForm();
    expect(form.method).toBe("get");
    expect(form).toHaveAttribute("role", "search");
    expect(form).toHaveAttribute("aria-label", "Atamalarda ara");
    expect(formPairs(form)).toEqual([
      ["durum", "PENDING"],
      ["sirala", "createdAt,desc"],
      ["boyut", "20"],
      ["sayfa", "0"],
      ["q", "ayşe"],
    ]);
  });

  it("names the field for assistive technology and keeps the typed text in it", () => {
    render(<ListSearchForm {...BASE} query="ayşe" />);

    const input = screen.getByRole("searchbox", { name: "Atamalarda ara" });
    expect(input).toHaveValue("ayşe");
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
  });

  it("has exactly one submit button, so Enter in the field submits", () => {
    render(<ListSearchForm {...BASE} query={null} />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ara" })).toHaveAttribute("type", "submit");
  });
});

describe("clearing", () => {
  it("offers Temizle only while a search is active, and the link drops q but keeps the view", () => {
    const { rerender } = render(<ListSearchForm {...BASE} query={null} />);

    expect(screen.queryByRole("link", { name: "Temizle" })).not.toBeInTheDocument();

    rerender(
      <ListSearchForm {...BASE} query="ayşe" state={{ durum: "PENDING", boyut: "50", q: "x" }} />,
    );

    expect(screen.getByRole("link", { name: "Temizle" })).toHaveAttribute(
      "href",
      "/assignments?durum=PENDING&boyut=50",
    );
  });
});

describe("what the box says about the search", () => {
  it("explains that one character does not filter", () => {
    render(<ListSearchForm {...BASE} query="a" />);

    expect(screen.getByText(/En az 2 karakter yazın/)).toBeInTheDocument();
    expect(activeSearch("a")).toBeNull();
  });

  it("says when the text was clipped to 100", () => {
    render(<ListSearchForm {...BASE} query={"k".repeat(120)} />);

    expect(screen.getByText(/100 karaktere kırpılarak gönderildi/)).toBeInTheDocument();
    expect(activeSearch("k".repeat(120))).toHaveLength(100);
  });

  it("shows the backend's refusal inline and marks the field invalid", () => {
    render(
      <ListSearchForm {...BASE} query="uzun" error="Arama metni en fazla 100 karakter olabilir." />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Arama metni en fazla 100 karakter olabilir.",
    );
    expect(screen.getByRole("searchbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the hint about which fields the backend searches", () => {
    render(<ListSearchForm {...BASE} query={null} hint="Atama kimliği, ilan başlığı." />);

    expect(screen.getByRole("searchbox")).toHaveAccessibleDescription(
      "Atama kimliği, ilan başlığı.",
    );
  });
});

describe("the result line", () => {
  it("draws nothing without an active search", () => {
    const { container } = render(<SearchResultSummary search={null} total={5} unit="atama" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the query and the backend's total", () => {
    render(<SearchResultSummary search="ayşe" total={1204} unit="atama" />);

    expect(screen.getByRole("status")).toHaveTextContent("“ayşe” için 1.204 atama bulundu.");
  });

  it("says there is no result for the query, in the same words the empty state uses", () => {
    render(<SearchResultSummary search="ayşe" total={0} unit="atama" />);

    expect(screen.getByRole("status")).toHaveTextContent(searchEmptyTitle("ayşe"));
    expect(searchEmptyTitle("ayşe")).toBe("“ayşe” için sonuç yok.");
  });
});
