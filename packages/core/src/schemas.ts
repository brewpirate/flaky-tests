import { z } from 'zod'

export const FailureKindSchema = z.enum(['assertion', 'timeout', 'uncaught', 'unknown'])

export const RunStatusSchema = z.enum(['pass', 'fail'])

const IsoDateTime = z.string().min(1).max(64)
const RunId = z.string().min(1).max(128)
const TestPath = z.string().min(1).max(1024)

export const InsertRunInputSchema = z.object({
  runId: RunId,
  startedAt: IsoDateTime,
  gitSha: z.string().max(64).nullish(),
  gitDirty: z.boolean().nullish(),
  runtimeVersion: z.string().max(128).nullish(),
  testArgs: z.string().max(4096).nullish(),
})

export const UpdateRunInputSchema = z.object({
  endedAt: IsoDateTime.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: RunStatusSchema.optional(),
  totalTests: z.number().int().nonnegative().optional(),
  passedTests: z.number().int().nonnegative().optional(),
  failedTests: z.number().int().nonnegative().optional(),
  errorsBetweenTests: z.number().int().nonnegative().optional(),
})

export const InsertFailureInputSchema = z.object({
  runId: RunId,
  testFile: TestPath,
  testName: TestPath,
  failureKind: FailureKindSchema,
  errorMessage: z.string().max(16_384).nullish(),
  errorStack: z.string().max(65_536).nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  failedAt: IsoDateTime,
})

export const GetNewPatternsOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
  threshold: z.number().int().min(1).max(10_000).optional(),
})

export const GetRecentRunsOptionsSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

export const GetFailureKindBreakdownOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
})

export const GetHotFilesOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})
