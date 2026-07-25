/**
 * Zod request-body schemas for Metadata Genie API routes.
 *
 * Runtime validation replaces unsafe `as` casts on request.json().
 */

import { z } from "zod/v4";

export const GenerateBodySchema = z.object({
  title: z.string().optional(),
  catalogScope: z.array(z.string()).optional(),
  questionComplexity: z.enum(["simple", "medium", "complex"]).optional(),
});

export const DeployBodySchema = z.object({
  id: z.string().min(1, "id is required"),
  viewTarget: z.object({
    catalog: z.string().min(1, "catalog is required"),
    schema: z.string().min(1, "schema is required"),
  }),
  authMode: z.string().optional(),
  resourcePrefix: z.string().optional(),
});

export const DeleteBodySchema = z.object({
  id: z.string().min(1, "id is required"),
  dropViews: z.boolean().optional(),
});

export const SpaceEditBodySchema = z
  .object({
    type: z.string().min(1, "type is required"),
    id: z.string().min(1, "id is required"),
  })
  .passthrough();
