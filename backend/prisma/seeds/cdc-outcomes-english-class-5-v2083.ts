import type { Prisma } from '@prisma/client';

// ============================================================================
// CDC English — Grade 5 — Curriculum Version 2083 (BS).
//
// Source: CDC विद्यार्थी मूल्याङ्कन मार्गदर्शन २०८३
//         Section: अनुसूची ३ (ख) : अङ्ग्रजी विषयको सिकाइ उपलब्धि मूल्याङ्कन अभिलेख
//         Subsection: Grade: 5 Subject: English  (PDF pages 63–79)
//
// Total outcomes seeded: 83 across 17 units.
//
// Extraction conventions (identical to the Class 4 seed):
//   • `sortOrder` = the indicator number printed in the CDC table's
//     "Learning outcome indicators" column (1., 2., 3., …). The S.N.
//     column (1-4) only enumerates skill rows.
//   • Skill mapping follows the row each indicator sits in.
//   • PDF text extraction (`pdftotext -layout`) jumbled the textual
//     order of indicators in MOST units (the Achievement-formula text
//     interleaves with indicator lines). Reconstruction is by
//     indicator number, not by position in the extracted text.
//     The user should cross-check Units 2, 4, 6, 8, 9, 11, 12, 14,
//     15, 16, 17 against the PDF — these are the units where the
//     extraction was most heavily reconstructed. Units 3, 5, 7, 10,
//     13 came out reasonably linear and need a lighter check.
//   • British/CDC spellings preserved verbatim ("Recognise",
//     "Participate", "Initiate", "rephrasing", "Apologizing", etc.).
//   • Two PDF-extraction artifacts restored:
//       Unit 16 indicator #4: text came through as "rite paragraph
//         expressing argument." — the leading "W" was lost in
//         extraction. Restored to "Write paragraph expressing
//         argument." (single-character whitespace-class fix, same
//         pattern as the lost-space restorations in the Class 4 seed).
//       Various units: words lost their internal spaces (e.g.
//         "Totalobtainedmarks" in formula text — not in indicators).
//         Spaces restored only inside indicator descriptions where
//         the lost-space pattern is unambiguous.
//   • Unit 2 indicator #1 source reads "from a short and simple
//     conversation" but pdftotext rendered "form a short and simple
//     conversation". The preceding word "retrieve specific information
//     form" is preserved verbatim — this MAY be a CDC typo. The user
//     should compare against the source PDF; if the PDF reads "from",
//     fix to match.
//   • `unitTitleNp` and `descriptionNp` are intentionally null — the
//     CDC document presents English-subject content in English only.
// ============================================================================

export const englishClass5OutcomesV2083: Prisma.LearningOutcomeCreateInput[] = [
  // --------------------------------------------------------------------------
  // Unit 1 — Introducing and Leave Taking (7)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Respond to simple questions in areas of immediate needs or on familiar topics.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and answer questions to introduce oneself and other people.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Get ideas of the content of simple informational text with the help of visual support.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Recite a short and simple poem.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Copy out a short text considering the use of capital letters and punctuation marks.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 6, skillArea: 'WRITING', descriptionEn: 'Write a simple paragraph about themselves.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 1, unitTitleEn: 'Introducing and Leave Taking', unitTitleNp: null, sortOrder: 7, skillArea: 'WRITING', descriptionEn: 'Write a short and simple email giving introduction.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 2 — Expressing Possession (6)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Listen and retrieve specific information form a short and simple conversation.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: "Ask and answer questions about each other's possessions.", descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract specific information about possession from a short simple text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Recite a short and simple poem.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 5, skillArea: 'READING', descriptionEn: 'Guess the meaning of unfamiliar words from contexts.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 2, unitTitleEn: 'Expressing Possession', unitTitleNp: null, sortOrder: 6, skillArea: 'WRITING', descriptionEn: 'Write a short and simple message expressing possession.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 3 — Asking for Information (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 3, unitTitleEn: 'Asking for Information', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract specific information from a slow and carefully spoken English.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 3, unitTitleEn: 'Asking for Information', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Use numbers, quantities, cost and time for asking information.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 3, unitTitleEn: 'Asking for Information', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read and extract information from short texts with the help of pictures.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 3, unitTitleEn: 'Asking for Information', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Get ideas of the content of simple informational texts.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 3, unitTitleEn: 'Asking for Information', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a simple letter.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 4 — Requesting and Apologizing (6)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract specific information from a slow and carefully spoken English.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Communicate in a simple way that involves repetition, rephrasing and repair.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read a text aloud with appropriate pauses, tempo, intonation, pronunciation, and expression.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Read and extract information from a simple story and letter.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a request and apology letter to a friend.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 4, unitTitleEn: 'Requesting and Apologizing', unitTitleNp: null, sortOrder: 6, skillArea: 'WRITING', descriptionEn: 'Change declarative/assertive sentences into negative.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 5 — Thanking and Congratulating (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 5, unitTitleEn: 'Thanking and Congratulating', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Respond to simple questions on a familiar topic.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 5, unitTitleEn: 'Thanking and Congratulating', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Participate in a simple conversation for congratulating and thanking.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 5, unitTitleEn: 'Thanking and Congratulating', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract specific information from short and simple texts.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 5, unitTitleEn: 'Thanking and Congratulating', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write a message of congratulations using full stops, questions marks and/or exclamation marks correctly.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 6 — Expressing Quantity (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 6, unitTitleEn: 'Expressing Quantity', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract specific information like numbers, quantities, cost, and time.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 6, unitTitleEn: 'Expressing Quantity', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and respond to questions using quantifiers.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 6, unitTitleEn: 'Expressing Quantity', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract required information like numbers, cost, quantities, etc. from a short and simple text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 6, unitTitleEn: 'Expressing Quantity', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Read and understand simple poem.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 6, unitTitleEn: 'Expressing Quantity', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a simple paragraph describing the quantity of objects.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 7 — Making Comparisons (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 7, unitTitleEn: 'Making Comparisons', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract specific information from a simple audio file related to comparison.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 7, unitTitleEn: 'Making Comparisons', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and respond to the questions using the expressions of comparison.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 7, unitTitleEn: 'Making Comparisons', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read and extract information from a short factual text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 7, unitTitleEn: 'Making Comparisons', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write a paragraph using comparative adjectives.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 8 — Describing Location (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 8, unitTitleEn: 'Describing Location', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Understand and respond to simple spoken descriptions about people, places and objects.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 8, unitTitleEn: 'Describing Location', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Give simple description of people, places, objects, pictures, and actions.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 8, unitTitleEn: 'Describing Location', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract specific information like location, size, status, etc. from a short and simple text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 8, unitTitleEn: 'Describing Location', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write simple paragraph describing people, places, things, etc. using prepositions of location.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 9 — Stating Facts and Truths (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 9, unitTitleEn: 'Stating Facts and Truths', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract factual information from an audio file.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 9, unitTitleEn: 'Stating Facts and Truths', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Express simple facts using present simple tense.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 9, unitTitleEn: 'Stating Facts and Truths', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Retrieve specific information from a short and simple factual text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 9, unitTitleEn: 'Stating Facts and Truths', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Read and understand simple poem.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 9, unitTitleEn: 'Stating Facts and Truths', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a fact-based paragraph (describing people, places and animals) using appropriate punctuation marks (full stops, commas, question marks, etc.).', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 10 — Giving Instructions and Directions (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 10, unitTitleEn: 'Giving Instructions and Directions', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Follow short and simple instructions and directions.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 10, unitTitleEn: 'Giving Instructions and Directions', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Give simple instructions and directions and follow them.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 10, unitTitleEn: 'Giving Instructions and Directions', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Get ideas of the content given in the text with the help of visual support.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 10, unitTitleEn: 'Giving Instructions and Directions', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write a set of instructions and directions.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 11 — Narrating Past Events (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 11, unitTitleEn: 'Narrating Past Events', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Respond to a narrative containing an event.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 11, unitTitleEn: 'Narrating Past Events', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Narrate a short and simple story and an event.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 11, unitTitleEn: 'Narrating Past Events', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read and understand a short and simple story.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 11, unitTitleEn: 'Narrating Past Events', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Make simple inferences from reading materials like stories and poems.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 11, unitTitleEn: 'Narrating Past Events', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a short and creative story by ordering and completing information.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 12 — Asking for and Giving Reasons (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 12, unitTitleEn: 'Asking for and Giving Reasons', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Respond to a simple spoken description that gives reasons for something.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 12, unitTitleEn: 'Asking for and Giving Reasons', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Give reasons in the given conditions.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 12, unitTitleEn: 'Asking for and Giving Reasons', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract specific information from a short and simple text like a story and an email.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 12, unitTitleEn: 'Asking for and Giving Reasons', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write a short and simple email using connectives like and, but, because, so.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 13 — Describing People, Places and Things (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 13, unitTitleEn: 'Describing People, Places and Things', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Get specific information from simple spoken descriptions about people, places and objects.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 13, unitTitleEn: 'Describing People, Places and Things', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Describe people, places, objects, pictures, and actions.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 13, unitTitleEn: 'Describing People, Places and Things', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read and extract specific information from a short descriptive text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 13, unitTitleEn: 'Describing People, Places and Things', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Make simple inferences from reading materials.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 13, unitTitleEn: 'Describing People, Places and Things', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a short description on a person/place/thing.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 14 — Expressing Likes and Dislikes (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 14, unitTitleEn: 'Expressing Likes and Dislikes', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Recognise the expressions expressing likes and dislikes.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 14, unitTitleEn: 'Expressing Likes and Dislikes', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Participate in a short and simple conversation to express likes and dislikes.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 14, unitTitleEn: 'Expressing Likes and Dislikes', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read a text to find the specific information and make inferences.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 14, unitTitleEn: 'Expressing Likes and Dislikes', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write short and simple sentences expressing likes and dislikes.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 14, unitTitleEn: 'Expressing Likes and Dislikes', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Compose a simple poem.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 15 — Expressing Ability (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 15, unitTitleEn: 'Expressing Ability', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Extract specific information from audio text related to expressing ability.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 15, unitTitleEn: 'Expressing Ability', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and answer simple questions about ability.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 15, unitTitleEn: 'Expressing Ability', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Extract the required information from factual text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 15, unitTitleEn: 'Expressing Ability', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Recite, read and understand a short and simple poem.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 15, unitTitleEn: 'Expressing Ability', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write a short paragraph expressing ability.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 16 — Agreeing and Disagreeing (4)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 16, unitTitleEn: 'Agreeing and Disagreeing', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Understand and respond to a slow and carefully spoken audio text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 16, unitTitleEn: 'Agreeing and Disagreeing', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and answer questions expressing agreement and disagreement.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 16, unitTitleEn: 'Agreeing and Disagreeing', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read, understand and respond to a simple reading text.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 16, unitTitleEn: 'Agreeing and Disagreeing', unitTitleNp: null, sortOrder: 4, skillArea: 'WRITING', descriptionEn: 'Write paragraph expressing argument.', descriptionNp: null },

  // --------------------------------------------------------------------------
  // Unit 17 — Talking about Future Plans (5)
  // --------------------------------------------------------------------------
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 17, unitTitleEn: 'Talking about Future Plans', unitTitleNp: null, sortOrder: 1, skillArea: 'LISTENING', descriptionEn: 'Respond to the rhymes and the songs having simple structures and rhyming patterns.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 17, unitTitleEn: 'Talking about Future Plans', unitTitleNp: null, sortOrder: 2, skillArea: 'SPEAKING', descriptionEn: 'Ask and answer simple questions to talk about future plans.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 17, unitTitleEn: 'Talking about Future Plans', unitTitleNp: null, sortOrder: 3, skillArea: 'READING', descriptionEn: 'Read the text with acceptable pronunciation at an appropriate speed.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 17, unitTitleEn: 'Talking about Future Plans', unitTitleNp: null, sortOrder: 4, skillArea: 'READING', descriptionEn: 'Read the text and do the comprehension tasks.', descriptionNp: null },
  { classLevel: 5, subjectCode: 'ENGLISH', curriculumVersion: '2083', unitNumber: 17, unitTitleEn: 'Talking about Future Plans', unitTitleNp: null, sortOrder: 5, skillArea: 'WRITING', descriptionEn: 'Write letter/message to a friend expressing future plans.', descriptionNp: null },
];
