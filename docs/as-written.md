# The Reader Hygiene Lane

Standards, specs and agent briefs written inside a long AI-assisted conversation come out readable only to the people who were in that conversation. This page describes a review lane, a fixed sequence of checks that a document passes through before a human reviewer reads it. The lane catches the problem first. It uses a free prose linter for form and known phrases, and two cheap model calls for meaning. One loop joins them: every phrase the models find is added to the linter's list, so the free check grows. The page shows how the lane runs, what it found in its first week, what it cost, and it ends with a playbook any team can hand to an agent.

## How it runs

The lane has two halves and a loop between them. The linter counts sentence length, readability grade and semicolons, and it matches every phrase it has been taught. The models read for meaning and discover the phrases the linter has not been taught yet. The human reviewer makes the final call. No step in the lane blocks a document. Each flag is a note that the author either rewrites or defends on the record. Every phrase a model or the reviewer names goes back into the linter’s list.

## The problem, the defect, and the cost

Two engineering standards were drafted by AI agents during a week of design conversation. The human reviewer returned them five times in 48 hours. Each time the meaning was intact, and each time the reviewer could not follow the text. One return objected to a word that only the drafting conversation had defined. One objected to a sentence that made two separate demands. One objected to a reason placed where a rule should have been. After thirteen revisions, both standards were still awaiting his approval.

How much defect the originals carried? The shortest of the returned texts had five sentences. A regex script that counts sentence length and clause markers flagged four of them. Vale scored it at Flesch-Kincaid grade 16 with four sentences over thirty words. A longer standard of 24 sentences had six flagged. Two process chapters that went through the lane next carried 118 semicolons and 43 sentences over thirty words in 5,300 words. The author of this page averaged 18 semicolons per letter. The defect was not a few bad sentences but the way the text was written.

How much the lane resolved? On the shortest standard, the checks found ten defects between the returned version and the current one: four defects of form, two ambiguities that a busy reader would resolve the wrong way, two insider phrases or reasons placed inside a rule, one candidate contradiction, and one clause that failed to reach the reader it was written for. All ten are resolved in the current text. The regex script now flags none of its fourteen sentences where it had flagged four of five. The readability alerts fell from three to none. The reach test, which asks a model reader in a specific role whether the rule binds it, rose from four personas reached in six to eight in eight. Whether the reviewer accepts the current text is not yet known, because he has not read it.

What did it cost, and who paid? The deterministic checks cost nothing and ran in milliseconds. They found about four of the ten defects, all of them defects of form, and two of those four had passed every model reader. The model checks cost about eight cents per iteration on a 300-word rule: the insider-prose finder cost half a cent, the two-reader diff three cents, the strict probe one cent, and the reach personas three cents. Four iterations came to about thirty cents and twenty minutes of machine time when the calls ran one after another, or about five minutes when they ran eight at a time. The model checks found the other six defects, the ones about meaning. The human cost was the largest. One person read the flags for about ten minutes per iteration, and the rule's owner rewrote the text. Across four iterations, the human cost came to about an hour of two people's time for one rule.

## Extrapolated to 100 pages of end-user documentation written by Claude

Assume 400 words a page: 40,000 words, about 2,700 sentences. The per-sentence and per-page calls are independent of each other, so they run in parallel. The machine times below give both figures, one call at a time and eight at a time. The API rate limit is the only ceiling. Our measured rates come from rule text, not end-user prose. End-user documentation written by Claude will carry more of the generic chatbot register, which the deterministic lane catches well, and fewer coined phrases. So the deterministic share of catches should rise. The figures below use our measured costs and state the assumptions.

| step | what it catches | model spend, 100 pages | machine time | human time | share of catches (rule text, measured) |
|---|---|---|---|---|---|
| Vale with the team lists | form: long sentences, semicolons, grade, and every known phrase | $0 | about 2 seconds either way | reading flags, about 2 minutes a page | about 40 percent, rising for end-user prose |
| insider-prose finder (cheap model, one call a sentence) | new coined phrases and metaphors | about $1.50 | about 70 minutes one call at a time, about 10 minutes eight at a time | reading flags, folded into the above | part of the model 60 percent |
| two-reader diff (one cheap call, two strong calls a page) | ambiguities a busy reader resolves the wrong way | about $2.00 | about 35 minutes one page at a time, about 5 minutes eight at a time | one judgment a page | part of the model 60 percent |
| strict probe (one strong call a page) | two clauses that cannot both be obeyed | about $1.00 | about 15 minutes one page at a time, about 2 minutes eight at a time | rare | part of the model 60 percent |
| reach personas | does the rule bind the reader it was written for | not applicable to end-user prose | none | none | none |
| rewriting | the defects the flags name | $0 | none | about a minute a flagged sentence. At a 10 percent flag rate, about 4.5 hours | all of it |
| **total** | | **about $4.50** | **about 2 hours one call at a time, about 17 minutes eight at a time** | **about 8 hours of editor time** | deterministic: none of the dollars, about 40 percent of the catches. Model: all of the dollars, about 60 percent |

The dollars are small and almost entirely model spend. The machine time is short once the calls run in parallel. The hours are the real cost, and they are human hours spent reading the flags (the notes each check produces) and rewriting. The deterministic lane earns its place twice. It spends none of the dollars. It also produces the flags a human can act on fastest, since a sentence count and a phrase match need no judgment. The model lane earns its place by finding the defects that no list can hold, at a price below one lunch for a hundred pages. The human reviewer remains the last step. In our first week, no check caught two of the five send-backs.

## What insider prose looks like, and what landed instead

Every left-hand sentence was sent back by the reviewer or flagged by the lane. Every right-hand sentence is the text that replaced it. Four shapes recur: a metaphor that carries a definition, a coined noun used as if it had been defined, a reason welded into the rule, and an abstraction put in a person's role.

## Who catches what

The deterministic checks (Vale and the phrase lists) read form and known phrases. The model checks (the finder, the diff and the probe) read meaning and new phrases. In the table above, only the deterministic checks caught three things: the 57-word sentence that a fluent reader repairs without noticing, the reason placed inside a rule that two reviewers had cleared, and the 29 semicolons in one letter. Only the model checks caught four: the clause that a weak reader took as a condition, the two-item list that a weak reader took as closed, the coined phrase that was not yet on any list, and the ordinary words that carried an insider meaning.

## The playbook

The playbook below is self-contained. It carries the prerequisites, the Vale config, the three prompts, the calibration step, the loop and the costs. It also carries the five writing rules that make text pass, and the rewrites above. Hand it to an agent and say: set up the reader-hygiene lane from this playbook and run it on this file. You can also follow it by hand.
