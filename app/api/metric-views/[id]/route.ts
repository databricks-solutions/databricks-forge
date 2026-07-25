/**
 * API: /api/metric-views/[id]
 *
 * GET    -- Fetch a single metric view proposal by ID
 * PATCH  -- Update YAML/DDL of a proposal
 * DELETE -- Delete a proposal
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import {
  getMetricViewProposalById,
  updateMetricViewProposal,
  deleteMetricViewProposal,
} from "@/lib/lakebase/metric-view-proposals";
import { loadMetricViewProposalOrRespond } from "@/lib/auth/route-guards";
import { clearAclForResource } from "@/lib/lakebase/acl";
import { proposalToDefinition } from "@/lib/metric-views/legacy-adapter";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await loadMetricViewProposalOrRespond(request, id, "read");
    if (!guard.ok) return guard.response;

    return NextResponse.json({ proposal: guard.value.proposal });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const guard = await loadMetricViewProposalOrRespond(request, id, "edit");
    if (!guard.ok) return guard.response;
    if (
      (guard.value.proposal.classification === "improve" ||
        guard.value.proposal.classification === "reuse") &&
      (typeof body.yaml === "string" || typeof body.ddl === "string")
    ) {
      return NextResponse.json(
        { error: "Reuse and improvement previews are immutable; regenerate the proposal." },
        { status: 409 },
      );
    }

    const updateData: Parameters<typeof updateMetricViewProposal>[1] = {};
    if (typeof body.yaml === "string") {
      updateData.yaml = body.yaml;
      updateData.definition = proposalToDefinition({
        name: guard.value.proposal.name,
        yaml: body.yaml,
      });
    }
    if (typeof body.ddl === "string") updateData.ddl = body.ddl;
    if (updateData.yaml !== undefined || updateData.ddl !== undefined) {
      updateData.validationStatus = "unverified";
      updateData.validationIssues = ["Definition changed after validation; repair to validate again."];
      updateData.validationEvidence = null;
      updateData.validatorVersion = null;
      updateData.validatedAt = null;
    }

    await updateMetricViewProposal(id, updateData);

    const updated = await getMetricViewProposalById(id);
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const guard = await loadMetricViewProposalOrRespond(request, id, "edit");
    if (!guard.ok) return guard.response;
    if (guard.permission !== "owner") {
      return NextResponse.json({ error: "Only the owner can delete this proposal" }, { status: 403 });
    }

    await deleteMetricViewProposal(id);
    await clearAclForResource("metric_view_proposal", id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
