import { Injectable } from '@nestjs/common';
import type { LearningOutcome, SubjectCode } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// ============================================================================
// LearningOutcomeService — read-only access to the CDC outcomes catalogue.
//
// Phase: CDC continuous-evaluation foundation. Single read method; the
// underlying table is INSERT-only (populated by the seed runner) and
// platform-global (no tenant scoping). Adding write paths or teacher-
// rating storage is OUT OF SCOPE for this session.
//
// Why no tenant filter:
//   The CDC curriculum is identical for every school in Nepal. Tenant
//   scoping would force every school to seed its own copy, which both
//   wastes storage and risks drift between schools that should be
//   following the same curriculum. The decision is documented in the
//   schema-level comment on `model LearningOutcome`.
//
// Why no caching layer:
//   The table is small (<1000 rows at full expansion across 6 subjects
//   × 5 grades × ~16 units × ~5 indicators). Postgres serves it from
//   memory after the first query. Adding an in-process cache would
//   introduce staleness without measurable wins; revisit only if a
//   real bottleneck shows up.
// ============================================================================

export interface ListLearningOutcomesInput {
  classLevel: number;
  subjectCode: SubjectCode;
  /** Defaults to "2083" — the only version seeded today. */
  curriculumVersion?: string;
  /** Optional filter — narrow the result to a single unit. */
  unitNumber?: number;
}

@Injectable()
export class LearningOutcomeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List learning outcomes for a (classLevel, subjectCode) pair,
   * ordered by unit then sortOrder so the teacher's UI can render
   * units sequentially without further sorting.
   *
   * Returns an empty array (NOT a 404) when no outcomes are seeded
   * for the requested combination — a missing seed is a configuration
   * gap, not a per-request error.
   */
  async list(input: ListLearningOutcomesInput): Promise<LearningOutcome[]> {
    const curriculumVersion = input.curriculumVersion ?? '2083';
    return this.prisma.learningOutcome.findMany({
      where: {
        classLevel: input.classLevel,
        subjectCode: input.subjectCode,
        curriculumVersion,
        ...(input.unitNumber !== undefined
          ? { unitNumber: input.unitNumber }
          : {}),
      },
      orderBy: [{ unitNumber: 'asc' }, { sortOrder: 'asc' }],
    });
  }
}
