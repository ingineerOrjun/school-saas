import type { Prisma } from '@prisma/client';

// ============================================================================
// CDC English — Grade 4 — Curriculum Version 2083 (BS).
//
// Source: CDC विद्यार्थी मूल्याङ्कन मार्गदर्शन २०८३
//         Section: अनुसूची ३ (ख) : अङ्ग्रजी विषयको सिकाइ उपलब्धि मूल्याङ्कन अभिलेख
//         Subsection: Grade: 4 Subject: English  (PDF pages 46–62)
//
// Total outcomes seeded: 73 across 16 units.
//
// Extraction notes (transparency for cross-checks):
//   • `sortOrder` is the indicator number as printed in the CDC table's
//     "Learning outcome indicators" column (1., 2., 3., …). It is NOT
//     the S.N. row number — that column only enumerates the four
//     skill rows (1=Listening, 2=Speaking, 3=Reading, 4=Writing) which
//     do not always align 1:1 with indicators (a single skill row can
//     contain multiple sub-indicators). Using the indicator number
//     keeps `sortOrder` unique within the (unit, classLevel, subject,
//     version) tuple and matches the order a teacher reads the page.
//   • Skill mapping was taken from the row each indicator sits in within
//     the CDC table — not inferred from the indicator's verb.
//     Notably, Unit 2 indicator #4 ("Recite a short and simple poem…")
//     sits in the Reading row in the source document; that placement is
//     preserved here verbatim.
//   • PDF text extraction (`pdftotext -layout`) jumbled the textual
//     order of indicators in a few units (10, 11, 13, 14, 15). The
//     reconstruction below is by indicator number, not by position in
//     the extracted text. Cross-check against the CDC PDF if any
//     wording looks off.
//   • British/CDC spellings are preserved verbatim ("Recognise",
//     "Participate", "Initiate", "rephrasing", etc.).
//   • A handful of words in the extracted text lost their spaces
//     (e.g. "useofpunctuationmarksand", "Totalobtainedmarks"). Spaces
//     have been restored ONLY where the lost-space pattern is
//     unambiguous; no other text was rewritten.
//   • `unitTitleNp` and `descriptionNp` are intentionally null — the
//     CDC document presents English-subject content in English only.
// ============================================================================

export const englishClass4OutcomesV2083: Prisma.LearningOutcomeCreateInput[] = [
  // --------------------------------------------------------------------------
  // Unit 1 — Greeting, Introducing and Leave Taking (7 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Recognise familiar words and basic phrases, and expressions related to themselves.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Use appropriate phrases and sentences to introduce themselves.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read exponents and sentences used for greeting, introducing and leave taking.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn:
      'Read and extract specific information from a personal profile.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn:
      'Write date, name, nationality, address, age and date of birth in a registration form.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 6,
    skillArea: 'WRITING',
    descriptionEn:
      'Copy out short texts presented in standard printed format considering the use of punctuation marks and capitalisation.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 1,
    unitTitleEn: 'Greeting, Introducing and Leave Taking',
    unitTitleNp: null,
    sortOrder: 7,
    skillArea: 'WRITING',
    descriptionEn: 'Write simple sentences describing a friend.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 2 — Expression Possession (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 2,
    unitTitleEn: 'Expression Possession',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Respond to rhymes and songs having simple structures and rhyming patterns.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 2,
    unitTitleEn: 'Expression Possession',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Participate in a short and simple conversation for expressing possession.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 2,
    unitTitleEn: 'Expression Possession',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Extract specific information (names and possession) from short and simple texts.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 2,
    unitTitleEn: 'Expression Possession',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn:
      'Recite a short and simple poem and guess the meaning of unfamiliar words.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 2,
    unitTitleEn: 'Expression Possession',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short simple thank you note/message to a friend.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 3 — Asking for Information (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 3,
    unitTitleEn: 'Asking for Information',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Listen and extract specific information from a short and simple conversation.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 3,
    unitTitleEn: 'Asking for Information',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Ask and answer simple questions in areas of immediate needs.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 3,
    unitTitleEn: 'Asking for Information',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Extract ideas from reading texts with the help of visual support.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 3,
    unitTitleEn: 'Asking for Information',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn: 'Write simple classroom rules and regulations.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 4 — Requesting and Responding (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 4,
    unitTitleEn: 'Requesting and Responding',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Recognise familiar expressions related to requesting and responding.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 4,
    unitTitleEn: 'Requesting and Responding',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Participate in a conversation to request and respond.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 4,
    unitTitleEn: 'Requesting and Responding',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Extract information (date, person, time and place) from a personal letter.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 4,
    unitTitleEn: 'Requesting and Responding',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn: 'Read and understand a short and simple story.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 4,
    unitTitleEn: 'Requesting and Responding',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn: 'Write a short and simple letter to a friend.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 5 — Expressing Quantity (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 5,
    unitTitleEn: 'Expressing Quantity',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Extract specific information from a slow and carefully spoken conversation.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 5,
    unitTitleEn: 'Expressing Quantity',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Use numbers, quantities, cost and time while speaking.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 5,
    unitTitleEn: 'Expressing Quantity',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Extract specific information (number, quantity, cost and time) from reading text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 5,
    unitTitleEn: 'Expressing Quantity',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn: 'Read and understand a short and simple story.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 5,
    unitTitleEn: 'Expressing Quantity',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn: 'Prepare a shopping list.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 6 — Making Comparison (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 6,
    unitTitleEn: 'Making Comparison',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Understand and respond to a slow and carefully spoken audio related to comparison.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 6,
    unitTitleEn: 'Making Comparison',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Use numbers, quantities, cost and time, etc., to make comparison.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 6,
    unitTitleEn: 'Making Comparison',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read, locate and pick up specific information from a short factual text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 6,
    unitTitleEn: 'Making Comparison',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short and simple paragraph comparing people, places and things.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 7 — Describing Location (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 7,
    unitTitleEn: 'Describing Location',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Get information about the location of places and objects from a simple spoken description/conversation.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 7,
    unitTitleEn: 'Describing Location',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Give a simple description of location with the help of pictures.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 7,
    unitTitleEn: 'Describing Location',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read a story and guess the meanings of unfamiliar words from the contexts.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 7,
    unitTitleEn: 'Describing Location',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn:
      'Find out specific information (location) from a short and simple text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 7,
    unitTitleEn: 'Describing Location',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short and simple paragraph describing location of a person/place/thing.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 8 — Stating Truth and Facts (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 8,
    unitTitleEn: 'Stating Truth and Facts',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Identify specific information (e.g., time, place, person and date) from the texts on familiar topics of everyday life.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 8,
    unitTitleEn: 'Stating Truth and Facts',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Initiate and respond to simple statements to state truths and facts.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 8,
    unitTitleEn: 'Stating Truth and Facts',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read and find out information from a short factual text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 8,
    unitTitleEn: 'Stating Truth and Facts',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a simple factual paragraph on a familiar topic.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 9 — Giving Direction (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 9,
    unitTitleEn: 'Giving Direction',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn: 'Follow short and simple directions.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 9,
    unitTitleEn: 'Giving Direction',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Ask and answer simple questions in areas of immediate needs.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 9,
    unitTitleEn: 'Giving Direction',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read and follow short and simple written directions to get from one place to another.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 9,
    unitTitleEn: 'Giving Direction',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short letter or an e-mail giving directions.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 10 — Narrating Past Events (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 10,
    unitTitleEn: 'Narrating Past Events',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Listen to a description and respond appropriately.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 10,
    unitTitleEn: 'Narrating Past Events',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn: 'Narrate/tell a short and simple story.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 10,
    unitTitleEn: 'Narrating Past Events',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn: 'Use dictionary to look for the meanings.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 10,
    unitTitleEn: 'Narrating Past Events',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn:
      'Read and understand a short simple story and biography.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 10,
    unitTitleEn: 'Narrating Past Events',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short and simple story using basic punctuation marks correctly.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 11 — Giving Reasons (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 11,
    unitTitleEn: 'Giving Reasons',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Identify specific information (e.g., time, place, person and date) from a familiar topic of everyday life.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 11,
    unitTitleEn: 'Giving Reasons',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Communicate in a simple way that involves repetition and rephrasing.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 11,
    unitTitleEn: 'Giving Reasons',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn: 'Make simple inferences from reading materials.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 11,
    unitTitleEn: 'Giving Reasons',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a paragraph on a familiar topic linking words or sentences with basic connectors (and, but, because).',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 12 — Describing People and Places (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 12,
    unitTitleEn: 'Describing People and Places',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Retrieve required information from a simple description about a person/a place/an object.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 12,
    unitTitleEn: 'Describing People and Places',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Give simple description of a person/ a place/ an object/ a picture.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 12,
    unitTitleEn: 'Describing People and Places',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read and retrieve information from a short factual text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 12,
    unitTitleEn: 'Describing People and Places',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Describe a person/place/thing in simple sentences using adjectives.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 13 — Expressing Likes and Dislikes (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 13,
    unitTitleEn: 'Expressing Likes and Dislikes',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Recognise basic expressions that express likes and dislikes.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 13,
    unitTitleEn: 'Expressing Likes and Dislikes',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Participate in a short and simple conversation to express likes and dislikes.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 13,
    unitTitleEn: 'Expressing Likes and Dislikes',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Read and retrieve information from short factual text related to hobbies and interests.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 13,
    unitTitleEn: 'Expressing Likes and Dislikes',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short and simple paragraph expressing likes and dislikes.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 14 — Expressing Ability (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 14,
    unitTitleEn: 'Expressing Ability',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Extract specific information from audio text related to expressing ability.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 14,
    unitTitleEn: 'Expressing Ability',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn: 'Ask and answer simple questions about ability.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 14,
    unitTitleEn: 'Expressing Ability',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Retrieve the required information from a short and simple text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 14,
    unitTitleEn: 'Expressing Ability',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short paragraph expressing ability using modal verbs.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 15 — Agreeing and Disagreeing (5 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 15,
    unitTitleEn: 'Agreeing and Disagreeing',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Recognise expressions related to agreeing and disagreeing.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 15,
    unitTitleEn: 'Agreeing and Disagreeing',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Express agreement and disagreement using short and simple phrases.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 15,
    unitTitleEn: 'Agreeing and Disagreeing',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn: 'Read and understand a short and simple poem.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 15,
    unitTitleEn: 'Agreeing and Disagreeing',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'READING',
    descriptionEn:
      'Read and make simple inferences from a simple story.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 15,
    unitTitleEn: 'Agreeing and Disagreeing',
    unitTitleNp: null,
    sortOrder: 5,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a short paragraph expressing agreement and disagreement.',
    descriptionNp: null,
  },

  // --------------------------------------------------------------------------
  // Unit 16 — Talking about Future Plan (4 outcomes)
  // --------------------------------------------------------------------------
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 16,
    unitTitleEn: 'Talking about Future Plan',
    unitTitleNp: null,
    sortOrder: 1,
    skillArea: 'LISTENING',
    descriptionEn:
      'Respond to a slow and carefully articulated text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 16,
    unitTitleEn: 'Talking about Future Plan',
    unitTitleNp: null,
    sortOrder: 2,
    skillArea: 'SPEAKING',
    descriptionEn:
      'Participate in a short and simple conversation about future plan.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 16,
    unitTitleEn: 'Talking about Future Plan',
    unitTitleNp: null,
    sortOrder: 3,
    skillArea: 'READING',
    descriptionEn:
      'Get ideas of the content of simple informational text.',
    descriptionNp: null,
  },
  {
    classLevel: 4,
    subjectCode: 'ENGLISH',
    curriculumVersion: '2083',
    unitNumber: 16,
    unitTitleEn: 'Talking about Future Plan',
    unitTitleNp: null,
    sortOrder: 4,
    skillArea: 'WRITING',
    descriptionEn:
      'Write a letter to a friend sharing the list of planned activities for upcoming vacation.',
    descriptionNp: null,
  },
];
