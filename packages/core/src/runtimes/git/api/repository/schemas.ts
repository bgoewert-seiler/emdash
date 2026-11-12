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

// -- Grep --

/** Bounds on `grep` input; patterns are built by plugins from escaped keywords. */
export const GREP_MAX_PATTERNS = 21;
export const GREP_MAX_PATTERN_LENGTH = 256;
export const GREP_MAX_PATHSPECS = 8;
export const GREP_MAX_EXCLUSIONS = 500;
/** Output beyond this is dropped and reported as `truncated`. */
export const GREP_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** One argv element; NUL and newlines would break git's line-oriented pattern and output. */
const grepArgSchema = z
  .string()
  .min(1)
  .max(GREP_MAX_PATTERN_LENGTH)
  .refine((value) => !/[\0\r\n]/u.test(value), {
    message: 'Grep arguments cannot contain NUL or newline characters',
  });

export const grepInputSchema = repositorySelectorSchema.extend({
  /** A full ref, or `HEAD` of the repository's main worktree. */
  ref: z.union([gitFullRefSchema, z.literal('HEAD')]),
  /** Extended regular expressions, matched case-sensitively; any one matching selects a line. */
  patterns: z.array(grepArgSchema).min(1).max(GREP_MAX_PATTERNS),
  /** Git pathspecs that narrow the search; the whole tree when empty. */
  pathspec: z.array(grepArgSchema).max(GREP_MAX_PATHSPECS).default([]),
  /** Search exclusion patterns (the file-search policy) applied as `:(exclude)` pathspecs. */
  exclusions: z.array(grepArgSchema).max(GREP_MAX_EXCLUSIONS).default([]),
});
export type GrepInput = z.infer<typeof grepInputSchema>;

export const grepHitSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
});
export type GrepHit = z.infer<typeof grepHitSchema>;

export const grepResultSchema = z.object({
  hits: z.array(grepHitSchema),
  /** True when output passed the byte cap and later hits were dropped. */
  truncated: z.boolean(),
});
export type GrepResult = z.infer<typeof grepResultSchema>;
