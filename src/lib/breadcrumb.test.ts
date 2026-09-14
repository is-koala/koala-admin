import { describe, expect, it } from "vitest";

import {
  QUEUE_STATE_KEYS,
  listCrumb,
  objectBreadcrumb,
  objectCrumb,
  objectQueryFor,
  readQueueState,
} from "./breadcrumb";

/**
 * Kırıntının saf yarısı (koala-admin#112): adresten hangi anahtarlar geri
 * okunur, kimlik nasıl kısalır, liste adı nereden gelir.
 */

const ID = "9a1c0f10-0001-4c00-8000-0000000000aa";

describe("readQueueState", () => {
  it("keeps only the registered queue keys, first value of a repeated one", () => {
    expect(
      readQueueState({
        durum: "PENDING",
        sayfa: ["2", "3"],
        ara: "koala",
        sekme: "atamalar",
        sonuc: "approved",
        atama: ID,
        returnTo: "https://evil.example",
      }),
    ).toEqual({ durum: "PENDING", ara: "koala", sayfa: "2" });
  });

  it("drops empty values and yields an empty object for an empty address", () => {
    expect(readQueueState({ durum: "" })).toEqual({});
    expect(readQueueState({})).toEqual({});
  });

  it("names the panel's Turkish filter vocabulary and nothing page-local", () => {
    expect(QUEUE_STATE_KEYS).not.toContain("sekme");
    expect(QUEUE_STATE_KEYS).not.toContain("atama");
    expect(QUEUE_STATE_KEYS).not.toContain("hakedis");
    expect(QUEUE_STATE_KEYS).not.toContain("sonuc");
  });
});

describe("objectCrumb", () => {
  it("shortens a UUID to its first block and keeps the full id as the title", () => {
    expect(objectCrumb(ID)).toEqual({ label: "9a1c0f10", title: ID, mono: true });
  });

  it("leaves a non-UUID alone, without a title or mono flag", () => {
    expect(objectCrumb("bozuk")).toEqual({ label: "bozuk" });
  });
});

describe("objectQueryFor", () => {
  it("appends the current page to the list's view state", () => {
    expect(objectQueryFor({ durum: "OPEN", boyut: "20" }, 3)).toEqual({
      durum: "OPEN",
      boyut: "20",
      sayfa: "3",
    });
  });
});

describe("listCrumb and objectBreadcrumb", () => {
  it("takes the list's name from the menu registry and carries the view in the href", () => {
    expect(listCrumb("/companies", { durum: "REJECTED", sayfa: "2" })).toEqual({
      label: "Şirket onayları",
      href: "/companies?durum=REJECTED&sayfa=2",
    });
    expect(listCrumb("/users")).toEqual({ label: "Kullanıcılar", href: "/users" });
  });

  it("builds list › object with the object last and unlinked", () => {
    const crumbs = objectBreadcrumb("/disputes", ID, { kullanici: ID });
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]).toEqual({ label: "Uyuşmazlıklar", href: `/disputes?kullanici=${ID}` });
    expect(crumbs[1]).toEqual({ label: "9a1c0f10", title: ID, mono: true });
    expect(crumbs[1]).not.toHaveProperty("href");
  });
});
