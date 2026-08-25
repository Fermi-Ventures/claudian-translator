# Paragraph counters: first calibration, 29 Aug

Not a statistic. One human-written document and six machine-written ones,
run through `tools/paragraphs.mjs` the day it was written, so the
thresholds have a record to be argued against.

| document | author | paragraphs | paragraph-length cv | uniform paragraphs | lead-ins | kickers | triads per 100 words | closers | signposts |
|---|---|---|---|---|---|---|---|---|---|
| Vale's README (vale-cli/vale release) | human | 14 | 0.76 | 1 | 0 | 0 | 1.3 | 0 | 0 |
| this README, first draft | Claude | 13 | 0.84 | 1 | 2 | 1 | 1.2 | 0 | 0 |
| this README, current | Claude | 14 | 1.14 | 0 | 5 | 2 | 1.22 | 0 | 0 |
| the CTO page it replaced | Claude | 11 | **0.28** | 2 | 1 | 0 | 0.96 | 0 | 0 |
| PLAYBOOK.md | Claude | 39 | 0.72 | 3 | - | - | 0.76 | 2 | 0 |
| a 3,300-word working note | Claude | 33 | 0.50 | 2 | - | - | 0.75 | 0 | 5 pivots |
| a 2,600-word team README | Claude | 62 | 0.43 | 4 | 16 | 4 | 0.72 | 2 | 0 |

What separates the human document from the machine ones in this set: no
lead-in labels, no kickers. What does not: triads (the human document has
the most), closers and signposts (none anywhere; the phrase lists in the
literature do not fire on technical prose that has been through a lint).
The flattest document is the page the reviewer said "felt like AI" before
he could say why: every paragraph about a hundred words.

Thresholds set from this run: UNIFORM-DOC at paragraph-length cv below
0.35; LEADINS at three or more; KICKERS on 40 percent of paragraphs;
UNIFORM rhythm at sentence-length cv below 0.35 inside a paragraph. Add a
document to this table whenever a reader says "this reads as AI" and the
sentence checks find nothing.
