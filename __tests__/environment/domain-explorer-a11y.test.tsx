// @vitest-environment jsdom
/**
 * Task 7 Req5: keyboard accessibility for the Domain Explorer.
 *
 * The bubble-map "bubbles" and the list-view rows are interactive drill-downs.
 * They must be operable without a mouse: focusable, exposed as buttons to AT,
 * and driven by Enter/Space. These tests assert the semantics and the keyboard
 * behaviour end-to-end against the real rendered component.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DomainExplorer } from "@/components/environment/domain-explorer";
import type { TableDetailRow } from "@/app/environment/types";
import messages from "@/messages/en.json";
import ptBR from "@/messages/pt-BR.json";

// jsdom has no fetch for the overrides effect; stub it so the effect is a no-op.
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

const details = [
  {
    tableFqn: "cat.fin.ledger",
    dataDomain: "Finance",
    dataSubdomain: "GL",
    numRows: 1000,
    sizeInBytes: 5000,
    dataTier: "gold",
  },
  {
    tableFqn: "cat.sales.orders",
    dataDomain: "Sales",
    dataSubdomain: "Orders",
    numRows: 2000,
    sizeInBytes: 9000,
    dataTier: "silver",
  },
] as unknown as TableDetailRow[];

const humanNumber = (v: string | number | null) => String(v ?? "—");
const humanSize = (v: string | number | null) => String(v ?? "—");

function renderExplorer(locale = "en", catalog = messages) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={catalog}
      formats={{ number: { precise: { maximumFractionDigits: 2 } } }}
    >
      <DomainExplorer details={details} humanNumber={humanNumber} humanSize={humanSize} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("Domain Explorer — map bubbles keyboard access", () => {
  it("localizes native SVG title counts, units, and decimal formatting", () => {
    const { container } = renderExplorer("pt-BR", ptBR);
    const titles = [...container.querySelectorAll("title")].map((node) => node.textContent);
    expect(titles).toContain("Finance\n1 tabela · 1.000 linhas · 4,88 KB");
  });

  it("exposes bubbles as focusable buttons with accessible names", () => {
    const { container } = renderExplorer();
    const bubble = container.querySelector('g[role="button"]');
    expect(bubble).toBeTruthy();
    expect(bubble).toHaveAttribute("tabindex", "0");
    expect(bubble).toHaveAttribute("aria-label");
    expect(bubble!.getAttribute("aria-label")).toMatch(/Finance|Sales/);
  });

  it("drills into a domain on Enter", () => {
    const { container } = renderExplorer();
    const bubble = container.querySelector('g[role="button"]') as SVGGElement;
    fireEvent.keyDown(bubble, { key: "Enter" });
    expect(screen.getByText(/Subdomains of/)).toBeInTheDocument();
  });

  it("drills into a domain on Space", () => {
    const { container } = renderExplorer();
    const bubble = container.querySelector('g[role="button"]') as SVGGElement;
    fireEvent.keyDown(bubble, { key: " " });
    expect(screen.getByText(/Subdomains of/)).toBeInTheDocument();
  });
});

describe("Domain Explorer — list rows keyboard access", () => {
  it("exposes list rows as focusable buttons that drill on Enter", () => {
    const { container } = renderExplorer();
    fireEvent.click(screen.getByLabelText("List view"));
    const row = container.querySelector('tr[role="button"]');
    expect(row).toBeTruthy();
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row!, { key: "Enter" });
    expect(screen.getByText(/Subdomains of/)).toBeInTheDocument();
  });
});
