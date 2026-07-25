// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardDeployModal } from "@/components/pipeline/dashboard-deploy-modal";
import type { DashboardRecommendation } from "@/lib/dashboard/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardDeployModal publication failure", () => {
  it("retains the draft ID and open link returned by a failed publication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          success: false,
          error: "Published dashboard state is missing",
          dashboardId: "draft-123",
          dashboardUrl: "https://example.cloud.databricks.com/sql/dashboardsv3/draft-123",
          action: "created",
          publicationStatus: "publish_failed",
        }),
      }),
    );

    render(
      <DashboardDeployModal
        open
        onOpenChange={vi.fn()}
        runId="run-1"
        recommendations={
          [
            {
              domain: "Sales",
              title: "Sales",
              datasetCount: 1,
            },
          ] as DashboardRecommendation[]
        }
        databricksHost="https://example.cloud.databricks.com"
        onDeployComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deploy 1 Dashboard" }));

    await waitFor(() =>
      expect(screen.getByText("Published dashboard state is missing")).toBeInTheDocument(),
    );
    expect(screen.getByText(/draft-123/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Sales draft/i })).toHaveAttribute(
      "href",
      "https://example.cloud.databricks.com/sql/dashboardsv3/draft-123",
    );
  });

  it("retries only failed domains and preserves successful results across repeated retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          dashboardId: "sales-1",
          dashboardUrl: "https://example/sql/dashboardsv3/sales-1",
          action: "created",
          publicationStatus: "published",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          dashboardId: "finance-1",
          dashboardUrl: "https://example/sql/dashboardsv3/finance-1",
          action: "created",
          publicationStatus: "publish_failed",
          error: "finance publish failed",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          dashboardId: "finance-1",
          dashboardUrl: "https://example/sql/dashboardsv3/finance-1",
          action: "updated",
          publicationStatus: "publish_failed",
          error: "finance publish still failed",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          dashboardId: "finance-1",
          dashboardUrl: "https://example/sql/dashboardsv3/finance-1",
          action: "updated",
          publicationStatus: "published",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DashboardDeployModal
        open
        onOpenChange={vi.fn()}
        runId="run-1"
        recommendations={
          [
            { domain: "Sales", title: "Sales", datasetCount: 1 },
            { domain: "Finance", title: "Finance", datasetCount: 1 },
          ] as DashboardRecommendation[]
        }
        databricksHost="https://example.cloud.databricks.com"
        onDeployComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deploy 2 Dashboards" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: /Open Sales dashboard/i })).toHaveAttribute(
      "href",
      "https://example/sql/dashboardsv3/sales-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/Sales/deploy"),
      expect.stringContaining("/Finance/deploy"),
      expect.stringContaining("/Finance/deploy"),
    ]);
    expect(screen.getByRole("link", { name: /Open Sales dashboard/i })).toHaveAttribute(
      "href",
      "https://example/sql/dashboardsv3/sales-1",
    );
    await waitFor(() =>
      expect(screen.getByText("finance publish still failed")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toContain("/Finance/deploy");
    expect(screen.getByRole("link", { name: /Open Sales dashboard/i })).toHaveAttribute(
      "href",
      "https://example/sql/dashboardsv3/sales-1",
    );
    expect(screen.getByRole("link", { name: /Open Finance dashboard/i })).toHaveAttribute(
      "href",
      "https://example/sql/dashboardsv3/finance-1",
    );
  });
});
