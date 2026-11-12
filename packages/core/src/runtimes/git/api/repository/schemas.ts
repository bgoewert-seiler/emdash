import { z } from 'zod';
import { gitFullRefSchema } from '#runtimes/git/api/repository/states/refs';
import { gitOperationCredentialsSchema } from '#runtimes/git/api/schemas';
import { repositorySelectorSchema } from '#runtimes/git/api/selectors';

/**
 * Repository subdomain schemas: the input shapes for repository-scoped jobs
 * (fetch / fetch-PR). The worktree descriptor (`checkoutInfoSchema`)
 * is cross-cutting and lives in `../api/schemas`.
 */

export const fetchPrForReviewOptionsSchema = z.object({
  prNumber: z.number().int(),
  /** Request head ref fetched from configuredRemote, including for fork requests. */
  sourceRef: z.string().optional(),
  headRefName: z.string(),
  headRepositoryUrl: z.string(),
  localBranch: z.string(),
  isFork: z.boolean(),
  /**
   * The effective base remote, resolved by the caller (blessed resolver;
   * spec: github-git-settings §2) — this layer never invents one. Fork requests
   * without sourceRef fetch through a dedicated fork remote.
   */
  configuredRemote: z.string(),
});
export type FetchPrForReviewOptions = z.infer<typeof fetchPrForReviewOptionsSchema>;

// -- Job inputs --

export const fetchJobInputSchema = repositorySelectorSchema.extend({
  remote: z.string().optional(),
  refspec: z.string().optional(),
  force: z.boolean().optional(),
  credentials: gitOperationCredentialsSchema.optional(),
});
export type FetchJobInput = z.infer<typeof fetchJobInputSchema>;

export const fetchPrForReviewJobInputSchema = repositorySelectorSchema.extend({
  options: fetchPrForReviewOptionsSchema,
  credentials: gitOperationCredentialsSchema.optional(),
});
export type FetchPrForReviewJobInput = z.infer<typeof fetchPrForReviewJobInputSchema>;

// -- Tree reads --

export const gitTreeEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(['tree', 'blob']),
  oid: z.string(),
});
export type GitTreeEntry = z.infer<typeof gitTreeEntrySchema>;

export const listTreeInputSchema = repositorySelectorSchema.extend({
  /** A full ref, or `HEAD` of the repository's main worktree. */
  ref: z.union([gitFullRefSchema, z.literal('HEAD')]),
  /** Directory relative to the repository root; `''` is the root tree. */
  path: z.string(),
});
export type ListTreeInput = z.infer<typeof listTreeInputSchema>;
