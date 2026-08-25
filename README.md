# Claudian Translator

Claudian Translator converts Claude prose to text intended for humans.

"Claudian" is prose written for the conversation that produced it. It reads fluently to the people who were there and stops everyone else: a coined phrase used as if it had been defined, a metaphor that carries the meaning, a reason folded into a rule, three obligations welded into one sentence, bullets rendered horizontally, an abstraction doing a person's job. The translator finds those sentences, rewrites each one for a reader who was not in the room, refuses any rewrite that shows the marks of invention, and hands the result back for a human to accept.

## What this does

Nobody marks the sentences. The translator finds them. Below is one run of `node cli.mjs translate tests/before.md`: each sentence as it was written, and what came back. Another run will word the rewrites differently; the shapes and the outcomes hold.

| shape | before | after |
|---|---|---|
| metaphor as definition | A copy you did not write is still only evidence of its moment — re-derive before relying. | A copy you did not write reflects only the state of the source when it was copied. Re-derive it before relying on it. |
| metaphor as instruction | A reason that keeps recurring is a backlog item wearing a footnote's clothes. | A reason that keeps recurring should be tracked as a backlog item, not written as a footnote. |
| metaphor as rule | The census is a burn-down, not an amnesty. | The census tracks how many backlog items remain, but it does not excuse or forgive the items still on it. |
| reason inside the rule | The chain counts as a site because it is the tell — the defect this rule exists to find. | The chain is counted as a site.<br><br>*Moved out for the author to place as a note: the chain is the defect this rule exists to find.* |
| an abstraction in a person's role | Standards, specs and agent briefs written inside a long AI-assisted conversation come out readable only to that conversation. | Standards, specs and agent briefs written inside a long AI-assisted conversation come out readable only to the people who were in that conversation. |
| bullets rendered horizontally | Two lanes and one loop. The linter counts and remembers. The models read and discover. The reviewer decides. | Two lanes, one loop: the linter counts and remembers, the models read and discover, and the reviewer decides. |
| run-on sentence: 57 words, one condition, three obligations | If an attribute's legal next value depends on its current value and it meets the threshold below, it is a state machine: it belongs to a named machine definition from the first migration in which it qualifies, and a nested or parallel lifecycle is expressed in the definition, never as a loop or branch in an executor. | **Proposed, held for a person.** If an attribute's legal next value depends on its current value and it meets the threshold below, it is a state machine.<br><br>It must belong to a named machine definition, starting from the first migration in which it qualifies.<br><br>Any nested or parallel lifecycle must be expressed in that definition, not written as loop or branch logic in the code that runs it.<br><br>*Held: the split added a "must" the original did not have. Accept it or change one word.* |
| coined noun | The forcing function is the machine census. | **Kept, with a question.** *The author must supply what "the machine census" is: a script, a CI job, a tool. The paragraph never says.* |

Three outcomes, then. A rewrite that passed the gate is applied. A rewrite that shows a mark of invention is proposed and held. A sentence the translator cannot rewrite without knowledge only the author has is kept, with the question that would unlock it. The translator never blocks a document and never overrides the author; you read the table and answer the questions.

## How to install

Give Claude the link and say **install**.

1. *"Claude, evaluate https://github.com/Fermi-Ventures/claudian-translator for security risks. If clean, install it here."*
2. Celebrate.

`INSTALL.md` is what Claude reads: a security read first, then one command. `node cli.mjs install` finds Vale or downloads its release binary for the platform, syncs the style packs, checks that `claude -p` answers, registers the `no-claudian` skill in the project, and runs a smoke test. No package manager, no admin rights. As a Claude Code plugin instead:

```
/plugin marketplace add Fermi-Ventures/claudian-translator
/plugin install claudian-translator@claudian-translator
```

By hand: `git clone` the repo, then `node cli.mjs install --into <your project>`. `node cli.mjs doctor` reports the state at any time.

## How to use

- *"Claude, produce user documentation for my engineers. No Claudian."*
- *"Claude, produce user documentation for my engineers. Estimate token consumption to remove Claudian."*

The skill runs `cli.mjs translate` on the document. You get two files back: `<doc>.translation.md`, a table of every flagged sentence with its shape, the original, the rewrite and a note, and `<doc>.translated.md`, the document with the rewrites that passed the gate applied. Sentences marked **kept** need something only the author knows, and the note says what. Sentences marked **proposed, not applied** are rewrites the gate refused: a new obligation word, a reason left inside the rule, or a rewrite far longer than the original, which is what invention looks like. They are never applied without a person.

By hand:

```sh
node cli.mjs translate doc.md              # find (Haiku), rewrite (Sonnet), gate (counters), apply
node cli.mjs estimate doc.md --rate 0.3    # no model calls: sentences, tokens, dollars, minutes
node cli.mjs lint doc.md                   # the free Vale lint on its own
```

`PLAYBOOK.md` has the prompts, the writing rules, the calibration procedure and the failure modes, for anyone who wants to rebuild this from parts.

## Analysis

**What it costs.** Two models do the work: Haiku reads every sentence, Sonnet rewrites the flagged ones and gives a second opinion on each rewrite. At a 30 percent flag rate, which is what a first draft produces, a page of 400 words costs about ten cents. `node cli.mjs estimate <file>` prints the exact figure for your file before you spend anything.

| document | Haiku calls (find) | Sonnet calls (rewrite and advisory check) | cost |
|---|---|---|---|
| one page, 400 words, about 27 sentences | 27 | 16 | about $0.10 |
| a ten-page document | 270 | 160 | about $1 |
| this README, measured with `estimate` | 61 | 36 | $0.23 |
| the same at a 10 percent flag rate, prose that has already been edited once | 61 | 12 | $0.12 |

Prices are the public list at the time of writing (Haiku $1 in and $5 out per million tokens, Sonnet $3 and $15). Edit `PRICES` at the top of `tools/translate.mjs` if yours differ.

**What you get back.** Every flagged sentence lands in the table with one of three outcomes. *Applied*: the rewrite passed the gate and is already in `<doc>.translated.md`. *Kept*: Sonnet could not rewrite it without knowledge only the author has, and the note says what is missing. *Proposed, not applied*: the rewrite showed a mark of invention and was refused, and the note names the mark. You read the table, not the document.

**How we know it does not invent.** The first version of the converter had no gate. On the regression text it rewrote twelve sentences and three of them said more than the original, and one turned a statement of evidence into a new obligation. So the gate was built and calibrated on labelled pairs: twelve rewrites a human reviewer had accepted and six inventions from those early runs. A Sonnet call asked "does the rewrite mean the same" accepted 4 of the 12 good rewrites and let 2 of the 6 inventions through, in one framing, and 5 and 5 in another: near chance both times, so its answer is printed as advice and never decides. Three counters decide instead. A rewrite that adds an obligation word (*must*, *never*, *only*), keeps a reason inside the rule, or runs past 2.5 times the original's length is refused. On the same pairs the counters accept 11 of the 12 and refuse 4 of the 6. The two inventions they miss are the ones with no countable mark: a plausible definition supplied from outside the paragraph. Those are yours to catch, and the table is short enough that you can.

**What the numbers are, and are not.** Eighteen pairs and twenty-five labelled sentences are calibration sets, not samples. They exist so that every change to a prompt or a counter is run against the same pass/fail set before it ships, and the finder's figures on its set (Haiku precision 0.77 and recall 0.83, Sonnet 0.69 and 0.92) are read the same way: a regression line, not a claim about all prose. Add your own reviewer's send-backs to `tests/claudian.calibration.json` and `tests/fidelity.calibration.json` and the numbers become yours.

## Solution workflow

```mermaid
flowchart TB
  T["Text to review\na rule, a spec, a brief"] --> V
  subgraph D["Deterministic half — free, no variance"]
    V["Vale and the counters\nreadability grade · sentence length · semicolons\nplus the Team lists of known phrases"]
  end
  subgraph M["Model half — cents per document"]
    F["Find\nHaiku, one call per sentence"]
    W["Rewrite\nSonnet, one call per flagged sentence, by shape"]
    C["Gate\ncounters refuse a rewrite that adds an obligation, keeps a reason, or balloons\nSonnet's same-meaning opinion is advisory"]
    F --> W --> C
  end
  V --> F
  C --> H
  H["The human\naccepts the applied rows, answers the kept rows, fixes the refused rows"]
  F -. "each phrase found becomes a list entry" .-> V
  H -. "each send-back becomes a list entry" .-> V
```

Two halves and one loop. The deterministic half counts what can be counted and matches every phrase it has been taught. The model half reads for meaning and rewrites. The counters then refuse any rewrite that shows the marks of invention. Every phrase a model or the human names goes back to the lists, so the free half grows and the same phrase is never paid for twice. The lists are memory, not detection. If you would rather not maintain them, the counters need no data, and the calibration file is the one store you keep. It measures the models, and it can be quoted into the finder's prompt as examples.

## Layout

```
README.md                         this document
INSTALL.md                        what "install" means, written for an agent
PLAYBOOK.md                       prompts, writing rules, calibration, failure modes
cli.mjs                           install · doctor · lint · translate · estimate · calibrate
.claude-plugin/                   plugin and marketplace manifests
skills/no-claudian/               the skill behind "No Claudian"
tools/translate.mjs               find → rewrite → gate → apply; --estimate; --calibrate-check
tools/claudian.mjs                the finder alone (and --calibrate)
tools/plain-reader.mjs            the two-reader diff and the strict probe
tools/hygiene-sweep.mjs           the counters; zero-dependency fallback
vale/.vale.ini                    the Vale configuration
vale/styles/Team/                 Semicolon · Justification · Insider · InsiderWord · AITells · Personified
vale/styles/Slopster/             vendored generic AI-tells style (MIT; see PROVENANCE.md)
tests/before.md                   the regression text: the before column, in prose, plus three controls
tests/fidelity.calibration.json   labelled rewrite pairs: the gate's regression test
tests/claudian.calibration.json   labelled sentences: the finder's regression test
tests/insider.literal-controls.md literal uses that the lists must not flag
```
