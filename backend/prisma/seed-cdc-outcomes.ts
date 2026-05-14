import { PrismaClient, type Prisma } from '@prisma/client';
import { englishClass4OutcomesV2083 } from './seeds/cdc-outcomes-english-class-4-v2083';
import { englishClass5OutcomesV2083 } from './seeds/cdc-outcomes-english-class-5-v2083';

// Nepali Class 4 / Class 5 seeds: NOT seeded this session. The CDC source
// PDF uses non-Unicode Devanagari fonts (FontasyHimali / Kalimati) whose
// ToUnicode tables corrupt key conjuncts under every PyMuPDF extraction
// mode tested (text / blocks / dict / rawdict / html / xhtml). Sample
// failures: "मूल्याङ्कन" → "मूल्याङ कन" (virama dropped), "क्षेत्र" →
// "क्षेर" (त् conjunct lost), "कथा" → "कर्था" (spurious र् inserted),
// ":" → "M". Persisting that as canonical curriculum text would breach
// the explicit safety rule against fabricating outcome data. A later
// session should re-extract via a Devanagari-aware OCR (e.g. Tesseract
// with `nep` traineddata against page rasterizations) and add the seed
// files alongside this English Class 5 import.

// ============================================================================
// CDC Learning Outcomes seed runner.
//
// Idempotent — running twice does not duplicate rows. Each outcome is
// upserted against the composite unique key
// (classLevel, subjectCode, unitNumber, sortOrder, curriculumVersion);
// re-runs update the text fields (in case CDC issues a clarification)
// without recreating ids or shifting createdAt timestamps.
//
// Adding a new subject / grade in a future session:
//   1. Create `prisma/seeds/cdc-outcomes-<subject>-class-<n>-v<bs>.ts`
//      exporting an array of `Prisma.LearningOutcomeCreateInput`.
//   2. Import it here and spread into `all`.
//   3. Re-run `npm run seed:cdc-outcomes`.
//
// Tenant scope: NONE. The LearningOutcome table is platform-global
// reference data (same CDC curriculum for every school in Nepal).
// The seed is safe to run against any environment.
// ============================================================================

const prisma = new PrismaClient();

async function main() {
  const all: Prisma.LearningOutcomeCreateInput[] = [
    ...englishClass4OutcomesV2083,
    ...englishClass5OutcomesV2083,
    // Future seed files will be added here (Nepali Class 4 / 5 pending
    // a working Devanagari extraction — see import block above).
  ];

  console.log(`Seeding ${all.length} learning outcomes...`);

  let upserted = 0;
  for (const outcome of all) {
    await prisma.learningOutcome.upsert({
      where: {
        classLevel_subjectCode_unitNumber_sortOrder_curriculumVersion: {
          classLevel: outcome.classLevel,
          subjectCode: outcome.subjectCode,
          unitNumber: outcome.unitNumber,
          sortOrder: outcome.sortOrder,
          curriculumVersion: outcome.curriculumVersion ?? '2083',
        },
      },
      // Re-run safe: text fields may be corrected by a future CDC
      // clarification, but the unique tuple (class/subject/unit/order/
      // version) stays stable. We deliberately do NOT touch `id` or
      // `createdAt` on update — those are immutable from the row's
      // perspective.
      update: {
        unitTitleEn: outcome.unitTitleEn,
        unitTitleNp: outcome.unitTitleNp,
        skillArea: outcome.skillArea,
        descriptionEn: outcome.descriptionEn,
        descriptionNp: outcome.descriptionNp,
      },
      create: outcome,
    });
    upserted++;
  }

  console.log(`Done. ${upserted} outcomes upserted.`);

  // Quick sanity dump per-subject so the operator can verify counts
  // against the extraction report without leaving the terminal.
  const totals = await prisma.learningOutcome.groupBy({
    by: ['classLevel', 'subjectCode', 'curriculumVersion'],
    _count: { _all: true },
    orderBy: [
      { classLevel: 'asc' },
      { subjectCode: 'asc' },
      { curriculumVersion: 'asc' },
    ],
  });
  for (const row of totals) {
    console.log(
      `  Grade ${row.classLevel} / ${row.subjectCode} / v${row.curriculumVersion}: ${row._count._all} outcomes`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Seed failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
