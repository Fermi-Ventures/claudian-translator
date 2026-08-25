---
name: no-claudian
description: Use when the user says "No Claudian", asks for prose free of Claudian phrasing, or asks to estimate the token cost of removing Claudian. Runs the Claudian Translator on a document you produced or were given, applies the rewrites that pass the fidelity check, and reports what was kept and why.
---

# No Claudian

"Claudian" is prose written for the conversation that produced it: a coined phrase used as if defined, a metaphor that carries the meaning, a reason folded into a rule, obligations welded into one sentence, bullets rendered horizontally, an abstraction in a person's role. The translator finds those sentences and rewrites them for a reader who was not in the conversation.

## When the user says "No Claudian"

1. Produce the document first, as asked. Save it as a file.
2. Run the translator on it:
   `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs translate <file> --jobs 8`
   `${CLAUDE_PLUGIN_ROOT}` is the repo root: the plugin root when installed as a plugin, or the path `node cli.mjs install` printed. If Vale or the packs are missing, run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs install` first.
3. Read `<file>.translation.md`. Every row is one sentence: its shape, the original, the rewrite, and a note.
   - Rows marked applied are already in `<file>.translated.md`.
   - Rows marked **(kept)** could not be rewritten without knowledge only the author has. Supply it yourself if you have it, then rewrite the sentence by hand under the rules in PLAYBOOK.md §6; otherwise leave it and say so.
   - Rows marked **(proposed, not applied) … REFUSED** are rewrites the gate refused: they added an obligation, kept a reason inside the rule, or grew far past the original. Never apply them as they stand. Fix the sentence by hand so it says exactly what the original said.
   - Every applied row still deserves one read: the gate catches the marks of invention, not invention that leaves no mark. A rewrite that supplies a plausible definition from outside the paragraph passes the gate and is still wrong.
4. Replace the document with `<file>.translated.md` plus your hand fixes. Run the translator once more; a clean second pass has zero applied rows.
5. Report to the user in three lines: how many sentences, how many rewritten, and the kept sentences with what each needs.

## When the user asks to estimate token consumption

Run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs estimate <file> --rate <r>` and show the table it prints. Use `--rate 0.3` for a first draft and say that the rate is an assumption. If the user wants a measured number, run the translator once for real and report the actual flagged count.

## Rules that bind you here

- The translator never blocks and never overrides the author. It proposes; you and the user decide.
- Do not add a phrase to `vale/styles/Team/Insider.yml` as a bare word. Quote the phrase. Run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs lint tests/insider.literal-controls.md` afterwards; it must report zero hits.
- If a rewrite says more than the original, it is wrong even when it reads better.
