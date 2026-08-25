# Reader Hygiene — a playbook for catching insider prose in rules, specs and standards

**What this is.** A way to review text that a stranger must understand. The
stranger was not in the conversation that produced the text. The text may
be a standard, a policy, a spec, an onboarding page, or an AI agent's brief.
The pattern pairs a free prose linter with two cheap model calls and one
calibration step. It came from a week of engineering standards drafted by
AI agents and returned by a human reviewer as unreadable to anyone outside
the argument.

**How to run it.** Give this file to a coding agent that can run a shell and
call a model. Say: *"Set up the reader-hygiene lane from this playbook and
run it on `<file.md>`."* You can also follow every step by hand. Nothing here
needs the team that wrote it. There are no private tools and no internal
names.

**The claim.** Two lanes catch two different classes of defect.

- The **deterministic lane** (Vale plus regex lists) catches *form*: sentence
  length, readability grade, semicolons, em dash density. It also catches
  every phrase already on a list.
- The **model lane** (a weak reader compared with a stronger reader) catches
  *meaning*: a new coined phrase, an ambiguity a busy reader resolves the
  wrong way, a clause read as a condition when it was an obligation.

Neither lane blocks a document. Both produce flags that the author rewrites
or defends. Every phrase the model lane finds becomes a regex, so the free
lane grows.

---

## 0. Prerequisites

- **Vale** version 3 or later, the open-source prose linter. Install with
  `brew install vale`, with `winget install errata-ai.Vale`, or from the
  release binaries at `github.com/errata-ai/vale/releases`.
- **A model CLI or API with two tiers**: a cheap tier (Claude Haiku class)
  and a stronger tier (Claude Sonnet class). The examples use the Claude Code
  CLI in print mode: `claude -p --model <m> --setting-sources ""`. The empty
  `--setting-sources` keeps the reader clean: no project instructions, no
  memory. Any equivalent works. The reader must hold **only the text**.
- **Node** version 18 or later for the small scripts. Each is about 60 lines
  and easy to port.

## 1. The deterministic lane: Vale

Create `.vale.ini`:

```ini
StylesPath = styles
MinAlertLevel = suggestion
# Public packs: sentence length, passive voice, weasel words, wordiness, readability indices
Packages = Microsoft, write-good, proselint, Readability
[*.md]
BasedOnStyles = Vale, Microsoft, write-good, proselint, Readability, Team
# Rule text is not consumer documentation. Switch off the rules that fire on every definition.
Microsoft.Contractions = NO
Microsoft.FirstPerson = NO
Microsoft.We = NO
Microsoft.Headings = NO
Microsoft.Ellipses = NO
Microsoft.Dashes = NO
Microsoft.Vocab = NO
Microsoft.OxfordComma = NO
Microsoft.Terms = NO
Microsoft.Semicolon = NO
write-good.E-Prime = NO
write-good.TooWordy = NO
write-good.Passive = NO
Microsoft.Passive = suggestion
Vale.Spelling = NO
```

Run `vale sync` once. It downloads the packs. Then create three rules of your
own under `styles/Team/`.

`styles/Team/Semicolon.yml`
```yaml
extends: existence
message: "A semicolon in a rule sentence joins two sentences. Split it."
level: warning
scope: sentence
nonword: true
tokens:
  - ';'
```

`styles/Team/Justification.yml`
```yaml
extends: existence
message: "'%s': a rule says what to do or what will be refused. Put the reason beside the rule, not inside it."
level: suggestion
scope: sentence
ignorecase: true
tokens:
  - because
  - which is why
  - this is why
  - the point is
  - the reason is
  - exists to
```

`styles/Team/Insider.yml`. **Start it almost empty and grow it by finding**
(see step 4). Seed it with phrases your own reviewer has sent back. Ours
began with these:
```yaml
extends: existence
message: "'%s' is insider prose, a phrase from the argument rather than from the rule. Say it plainly."
level: error
scope: sentence
ignorecase: true
tokens:
  - evidence of (?:a|its) moment
  - the tell
  - forcing function
  - wearing (?:a |its |an )?\w+'?s? clothes
  - load-bearing (?:sentence|clause|word|phrase|rule|assumption)
```

**Admission rule for the list.** A token is a phrase quoted from a
send-back, long enough to have no literal sense anywhere else. A bare
ordinary word never goes in at `error`: *class*, *function*,
*application*, *load-bearing* and *amnesty* each have a literal use that a
rule in your domain will need, and a regex cannot tell the metaphor from
the literal. If a single word must be listed, list it in a second rule at
`suggestion` with its literal uses as `exceptions`, and let the model
finder (step 3) judge the context. Keep a control file of one literal use
per listed word and run Vale on it whenever the list grows. It must report
zero hits from the `error` rule. Ours is nine lines long and it caught
three bad tokens the day it was written.

Optional: `styles/Team/AITells.yml` for the generic chatbot register that the
public packs miss. **Quote every token.** An unquoted regex with a comma
in it parses as a YAML mapping and disables the whole style without an
error. The symptom is a run that returns zero alerts on text you know has
hits. The block below uses double quotes, so its backslashes are doubled.
```yaml
extends: existence
message: "'%s' is a chatbot tell: a hedge, a filler opener, or correspondence pasted into a rule."
level: warning
scope: sentence
ignorecase: true
tokens:
  - "it(?:'s| is) worth (?:noting|mentioning)"
  - "it(?:'s| is) important to (?:note|remember)"
  - "at its core"
  - "the real question is"
  - "here(?:'s| is) the thing"
  - "when it comes to"
  - "\\bultimately,"
  - "\\bgenuinely\\b"
  - "\\bnuanced\\b"
  - "you(?:'re| are) absolutely right"
  - "great question"
  - "i hope this helps"
  - "let me know if"
  - "not (?:just|only) \\w+(?: \\w+){0,4}, but (?:also )?"
```

Optional: `styles/Team/Personified.yml` for the shape where an abstraction
is put in a person's role: *readable only to that conversation*, *the diff
decides*, *the ledger remembers*. A conversation does not read. The reader
stalls on the last preposition, asks who the object is, and then repairs
the sentence into the one you should have written. Name the person.
```yaml
extends: existence
message: "'%s' puts an abstraction in a person's role. Name the person who reads, decides or remembers."
level: warning
scope: sentence
ignorecase: true
tokens:
  - "(?:readable|legible|visible|clear|obvious|intelligible|meaningful|opaque|known|familiar)(?: only)? to (?:that|the|this|a|an|its|our|one) (?:conversation|thread|session|transcript|chat|context|argument|diff|ledger|census|codebase|repo|repository|record|pipeline)s?\\b"
  - "\\b(?:conversation|thread|session|transcript|ledger|diff|census|codebase|repo|repository|pipeline|standard|rule|charter)s? (?:knows|reads|remembers|forgets|decides|understands|believes|wants|expects|thinks|assumes|cares)\\b"
```

Quote every token, and prefer single quotes: inside them a backslash is
literal. In a double-quoted YAML string a bare `\b` is the backspace
character, so the token never matches and nothing tells you. A bare `\w`
is an unknown escape, so Vale aborts the run and prints nothing on the
alerts channel, so a filtered count reads as zero hits. Both happened to
us in one hour and both looked like a clean pass. After every
edit to a style, run Vale once unfiltered on a file you know has hits, and
keep that file: the calibration positives are the regression test for the
list. Use `nonword: true` and write the boundaries yourself when a token
must end on the character after the phrase. Vale's regex engine has no
lookahead. Apostrophes in your text may be curly. Match both: `[''’]`.

Run `vale --output=line <file.md>`. Strip YAML front matter first if the
file has any. Vale fails without an error on a `subject:` line that is not
valid YAML. Treat the output as a list of flags. **Rewrite or defend each
flag.** A defence is a legitimate answer and goes on the record.

On a before-and-after pair (one rule, before and after the reviewer's
send-back), the Flesch-Kincaid grade went from **16 to no alert**, the
Gunning Fog index went from **18 to no alert**, and the count of sentences
over 30 words went from **4 to 0**.

## 2. The model lane, part one: the two-reader diff (ambiguity)

A capable model repairs an ambiguous sentence the way the writer meant it,
while a weaker model reads it the way a busy human does. So restate the
text with both, and let their **disagreement** be the flag.

Send this prompt to BOTH the weak model and the strong model. The reader
must be clean, holding the text only.

```
You are given the text of a rule. You have no other context.
For EACH numbered clause (and any parenthetical carve-out), reply with:
(1) the clause number, (2) ONE sentence in your own words saying what it
requires, (3) WHO it binds: the writer of a document, the reader of a
document, or unclear.
If you cannot restate a clause, write UNCLEAR and say which words stopped you.
Do not evaluate the rule. Only restate it.

TEXT:
<the rule>
```

Then send this judge prompt to the strong model:

```
Two readers restated the same rule, clause by clause. Compare the two
restatements for DIFFERENCES IN MEANING: a clause one reader took as a
condition and the other as an obligation, a requirement one reader saw and
the other did not, a scope one reader widened or narrowed. Ignore wording,
order and detail.
Reply with one line per meaningful difference in the form
"DIFF <clause>: <what reader A understood> | <what reader B understood>",
or exactly "DIFF: NONE".

THE RULE:
<the rule>

READER A (weaker model):
<restatement A>

READER B (stronger model):
<restatement B>
```

What it found for us on its first run: the weak reader took *"a nested or
parallel lifecycle is expressed in the definition"* as a **requirement that
lifecycles be nested**. That was the exact question the human reviewer had
asked an hour earlier. Repeat runs surface different plausible seams. Treat
each one as a candidate for the author to judge.

## 3. The model lane, part two: the insider-prose finder

One call per sentence, cheap model, clean reader:

```
You are a senior engineer at a company you have never heard of, reading ONE
sentence from an engineering standard. You have no other context.
A sentence is "insider prose" when it is written for someone who was in the
conversation that produced it. Signs: a coined phrase used as if it were
defined; a metaphor or figure of speech that carries the meaning (the
sentence collapses without it); an abstract noun where a concrete
instruction should be; a sentence that argues or explains instead of
telling you what to do or what will be refused; a term of art you would have
to ask a colleague about.
A sentence is NOT insider prose merely because it is technical, terse, or
uses ordinary engineering words (schema, cache, migration, executor,
threshold).
Reply with one JSON object and nothing else:
{"insider": true|false, "phrase": "<the words that make it insider, or empty>", "why": "<one sentence>"}

THE SENTENCE:
<sentence>
```

**Calibrate before you trust it.** Build twenty labelled sentences. Ten are
sentences your reviewer actually sent back (positives). Ten are sentences
they accepted, or that a blind reader restated cleanly (negatives). Run the
finder over all twenty and compute precision and recall. Our numbers were
**recall 0.90 and precision 0.69** for the Haiku class, and **recall 1.00
and precision 0.77** for the Sonnet class. Record where each label came
from, since a positive the reviewer named is stronger evidence than one an
instrument flagged.

Optional strict check, strong model, appended to the restatement prompt:
*"Is there any pair of statements in this text that a reader could not obey
at the same time, where doing what one says necessarily breaks the other? A
rule with an exception, a fallback, or a threshold is NOT such a pair. If
such a pair exists, name both and say why. Otherwise write exactly PROBE:
NONE."* Calibrate it on a plainly consistent two-clause text. It must say
NONE there. The looser wording *"appear to contradict, read uncharitably"*
never said NONE on anything. It generates candidates. It cannot gate.

## 4. The loop: models discover, the linter enforces

Every phrase the finder, the diff, or the reviewer names goes into
`styles/Team/Insider.yml`. From then on it is a free, zero-variance regex
hit for everyone. After one week ours held about 15 phrases and matched 9
of the 10 sentences that seeded it. That is a regression test, not
detection. Detection stays with the model lane.

The list grows by phrase, never by word. The finder names *the words that
make the sentence insider*, and those words go in as one token, quoted.
When the finder names a single ordinary word, the word does not go on the
list. The finder keeps catching it in context, and the list stays free of
false hits on literal use. Run the literal-use control file after every
addition (step 1).

## 5. The order, and what each step costs

```
Vale                 free, first: counts and known phrases
  -> finder          cheap model, per sentence: new phrases. A human reads the flags.
    -> diff          weak reader vs strong reader: meaning disagreements
      -> strict probe   strong model: contradiction. The one gate.
        -> the human reviewer   the LAST fresh reader, not the first
```

| step | per 300-word rule | per 2,800-word chapter | per 100 pages (40,000 words) |
|---|---|---|---|
| Vale | about 50 ms, $0 | about 100 ms, $0 | about 2 s, $0 |
| finder (cheap model, one call a sentence) | about 15 calls: 20 s one at a time, 4 s eight at a time, about $0.005 | about 150 calls: 4 min one at a time, 35 s eight at a time, about $0.05 | about 2,700 calls: 70 min one at a time, 10 min eight at a time, about $1.50 |
| diff (1 weak call plus 2 strong calls, per page or rule) | about 60 s, about $0.03 | about 2 min, about $0.10 | 100 pages: 35 min one at a time, 5 min eight at a time, about $2.00 |
| strict probe (1 strong call per page or rule) | about 15 s, about $0.01 | about 20 s, about $0.01 | 15 min one at a time, 2 min eight at a time, about $1.00 |

**Run the model calls in parallel.** Every per-sentence call and every
per-page call is independent of the others, so the wall-clock time is set by
how many you run at once, and the API rate limit is the only ceiling. The
scripts in this playbook run eight calls at a time by default (`--jobs 8`).
The "one at a time" figures above are what you get if you forget.

List prices at the time of writing: cheap tier about $1 per million input
tokens, strong tier about $3. A rubric plus one sentence is about 400
tokens. Verify before budgeting. The dollars stay small at any scale. The
hours are the real cost, and they are the hours a person spends reading the
flags and rewriting: budget about two minutes a page for reading and about
a minute for each flagged sentence. One send-back from a busy executive
costs more than a year of the model spend.

## 6. Writing rules the lane will pass: the seven that mattered

1. **One condition and at most one obligation per sentence.** Two
   obligations joined by "and" or a colon is where the second reads as a
   condition. Past about 40 words, split or defend.
2. **The reason lives beside the rule, not inside it.** "X because Y" in a
   rule becomes "X." Put Y in the exhibit.
3. **A rule with an exception labels the exception.** Write "The one
   exception to clause 1:". Otherwise a blind reader hears a contradiction.
4. **Say when the rule starts, in the rule.** A threshold pointed at from
   another page is invisible to a reader holding one page.
5. **Label examples as examples.** A weak reader turns an anti-example into
   a new obligation unless the heading says *what happened, not what is
   required*. Two examples in a list read as a closed list. "Among others"
   opens it.
6. **Do not render bullets horizontally.** A run of short fragments in a
   paragraph, several without a verb or an object, is a bullet list
   without the bullets: *"Two lanes and one loop. The linter counts and
   remembers. The reviewer decides."* The readability indices and the
   sentence-length rule reward this shape, so text edited to satisfy them
   drifts into it. Do not expand it either: the run of fragments is a
   hook, and a rewrite that turns it into a paragraph loses the hook. Fold
   the fragments into one sentence of about the same length, giving each
   its verb and its object: *"Two lanes, one loop: the linter counts
   sentences, the models read for meaning, and the reviewer decides."* The
   sweep flags three or more consecutive sentences of seven words or fewer.
7. **Name the person.** *"…readable only to that conversation"* puts an
   abstraction where a reader belongs. The sentence is grammatical, so no
   form check fires, and a fluent reader repairs it. A careful reader
   stalls at the last preposition and asks who the object is. Write the
   person: *"…readable only to the people who were in that conversation."*
   The same shape appears as *the diff decides*, *the ledger remembers*,
   *the census forgives*. Documents may *say* and *show*. Only people
   read, decide and remember.

## 7. Eleven insider rewrites, from the record

These are exhibits. The left column is quoted as it was written.

| insider prose (sent back or flagged) | plain (what landed) |
|---|---|
| A copy you did not write is still only evidence of its moment — re-derive before relying. | A copied fact in a document you did not write was true when it was copied, not necessarily now. Check the source before you act on it. |
| The writer's rule cannot govern documents its audience did not write. | *(deleted: it was a justification, not a rule)* |
| Render from data. | Every state machine has a rendering derived from its definition that a reviewer can reach without reading code. |
| Code-shaped architecture is invisible and therefore drifts. | Code a reviewer cannot see from outside the repository drifts. Publish a rendering. |
| The forcing function is the machine census. | The census is what finds a state written outside the machine. |
| A reason that keeps recurring is a backlog item wearing a footnote's clothes. | File a recurring reason as the backlog item it is. |
| A hand-copy is a signal — a derivation path is missing. | A hand-copy means a derivation path is missing. |
| The chain counts as a site because it is the tell — the defect this rule exists to find. | The chain is counted as evidence of the defect, not as permission for it. |
| The census is a burn-down, not an amnesty. | A census is a list of debts to pay down, not a pardon. |
| …a design change, announced at review — never folded into a refactor. | …a design change, even when it arrives inside a refactor. It is announced at review, never made quietly. |
| Standards, specs and agent briefs written inside a long AI-assisted conversation come out readable only to that conversation. | Standards, specs and agent briefs written inside a long AI-assisted conversation come out readable only to the people who were in that conversation. |

The generic register that the public lists do carry, for completeness:
*It's worth noting that X* becomes *X*. *Not just X, but Y* becomes *Y*.
*Let's delve into* becomes *Look at*. An em dash chain becomes two
sentences. A padded rule of three becomes the two items that matter.

## 8. What this does not do

It does not decide whether a rule is right. It decides whether a reader
outside the argument will get the meaning the writer intended. In our first
week, no instrument caught two of the five send-backs: one was a
contradiction a human read, and one was an ambiguity a strong model
repaired. The lane makes the human the last fresh reader instead of the
first. It does not replace them.

## 9. The converter: rewrite and check

`tools/translate.mjs` joins the parts above into one run. The cheap finder
flags a sentence, the counters flag form, the strong model rewrites each
flagged sentence under the rules in section 6, and a gate decides whether
the rewrite reaches the document. The gate is five counters: a rewrite
that adds an obligation word the original did not have, changes the
number of negations, swaps a word for its opposite from a fixed list,
keeps a reason inside the rule, or runs past 2.5 times the original's
length is refused
and appears in the table as *proposed, not applied*, with the counter
named. A rewrite the model could not make without knowledge it did not
have is *kept*, with a note saying what the author must supply.

The first run without a gate rewrote twelve
sentences and three of them said more than the original. One turned a
statement of evidence into a new obligation. A translator that invents is
worse than a linter that only flags.

A strong-model check that asks "does the rewrite mean the same as the
original" was tried first, in two framings, against labelled pairs
(`tests/fidelity.calibration.json`: rewrites a reviewer accepted,
inventions from early runs, and inversions such as a dropped *not*). On
the first 18 it scored 4 of 12 and 2 of 6, near chance, in both
framings. The counters, on all 24, refuse 8 of the 10 bad rewrites
including every inversion, and hold 4 of the 14 good ones, each of which
introduced a *not* while saying a metaphor plainly. So that question was dropped. A narrower one
works: "does AFTER apply to a different who, what or where than BEFORE?"
On first calibration it caught every swap in the set, with two false
alarms, so it is part of the gate: a changed target refuses. On 32 pairs
the gate as a whole (counters or target check) refuses 13 of 16 bad
rewrites and accepts 10 of 16 good ones. The model's answer varies
between runs; the counters do not. Keep both. Run
`node tools/translate.mjs --calibrate-check` after changing either. The
two inventions the counters miss are the ones with no tell: a plausible
definition supplied from outside the paragraph. An opposite that is not
on the polarity list is the same class. Only a person catches
those. That is what the table is for.

`--estimate` prints sentences, calls, tokens, dollars and minutes with no
model spend. Its one real unknown is the flag rate. Measure it once.

## 10. Batching by paragraph: measured, and where it pays

The models take an array as readily as a sentence. `--by paragraph` sends
one Sonnet call per paragraph with every flagged sentence numbered, and
one target-check call per paragraph with every pair. `--find-by
paragraph` does the same for the Haiku finder. Both were measured on the
regression text and the labelled sentences before either was allowed on
by default.

The finder loses what matters. Batched in chunks of five, Haiku went from
precision 0.77 and recall 0.83 to precision 1.00 and recall 0.67, and the
four sentences it stopped flagging were the reviewer's own send-backs,
the strongest positives in the set. Chunks of three gave the same four
misses with worse precision. The batch makes the finder conservative on
exactly the sentences the lane is for, so the finder stays per
sentence.

The rewrite and the check batch without that loss, and the saving is in
calls and wall time, not much in dollars: on the regression text the
rewrite stage went from 62 to 47 seconds and the finder from 90 to 80
with eight calls in flight, and the estimate for a two-page document
drops from about 28 to 25 cents. The rules and the paragraph are paid
once per paragraph instead of once per sentence, but at a 30 percent
flag rate nearly every paragraph has a flagged sentence, so the number of
rewrite calls barely moves. Where batching pays is when calls are the
constraint: a rate limit, a sequential run, or a CLI whose start-up
dominates. One batched rewrite on the regression text invented a meaning
that left no mark and passed the gate, which the per-sentence run had
kept. One run is not a calibration, so paragraph mode for the rewrite
is available and is not the default until a larger set says it is equal.

## 11. The paragraph level: two phases before the sentences, and a rate-limited pool

A page reads as machine-made before a word is read when its paragraphs
are all one length, each opens with a bold label and closes on a short
punchline, and every list has three items. The sentence checks see none
of that. `tools/paragraphs.mjs` counts it (section 9's calibration file
records the thresholds), and `translate.mjs` now runs two paragraph
phases before the sentence phases.

Phase 0 moves paragraph breaks and nothing else. One Sonnet call per
document, run only when the paragraph lengths are uniform (cv under
0.35), may merge two short neighbours or split a long paragraph at a
sentence. Its gate is exact: the sequence of words after must equal the
sequence before, or the answer is thrown away. A model cannot invent
inside that gate. On the flattest page we had, eleven paragraphs became
thirteen and the cv rose from 0.28 to 0.37, with the words checked
identical.

Phase 1 reshapes each paragraph the counters flagged: one Sonnet call
with the counts as evidence, then the same gate as a sentence (the
counters and the target check) plus a length band of 0.6 to 1.25 times
the original. The first version of its rules produced the wrong fix: told
UNIFORM or TRIAD, the model joined sentences with dashes and semicolons,
which is the tell the sentence lane removes, and it regrouped real
three-item lists with "along with". The rules now forbid the join and
say a real list of three stays. On the same page the second run reshaped
nine of twelve flagged paragraphs, refused three (a dropped negation, a
"because" introduced twice), left the two real lists alone, introduced
no dash and no semicolon, and the output carried no document-level flag.
Then the sentence phases ran on the reshaped text.

Phase 1 is the expensive part of the paragraph work and the slow part:
two Sonnet calls per flagged paragraph, about four minutes for twelve
paragraphs with eight calls in flight. `--no-structure` skips both
phases.

The pool that runs every call is rate-limited: at most `--rpm` calls
started per minute (default 40), `--jobs` in flight (default 8), three
attempts per call with backoff, and a fifteen-second pause for everything
when a call looks rate-limited (a 429, "overloaded", "too many
requests"). The run's summary line reports calls, retries and pauses.
Raise `--rpm` and `--jobs` together when your account's limit allows it;
the CLI hides the limit, so the summary line is how you find it.
