---
name: no-claudian
description: Use when the user says "No Claudian", says a passage "sounds Claudian", asks for prose free of Claudian phrasing, or asks to estimate the token cost of removing Claudian. Runs the Claudian Translator on a document you produced or were given, applies the rewrites that pass the gate, and reports what was kept and why.
---

# No Claudian

"Claudian" is prose written for the conversation that produced it: a coined phrase used as if defined, a metaphor that carries the meaning, a reason folded into a rule, obligations welded into one sentence, bullets rendered horizontally, an abstraction in a person's role. The translator finds those sentences and rewrites them for a reader who was not in the conversation.

## When the user says "that sounds Claudian"

They mean the text you just produced, or the passage they quote. Do not argue and do not rewrite it freehand.

1. Write the passage (or your whole last answer, if they did not quote) to a file.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs translate <file> --jobs 8`.
3. Show the before/after table from `<file>.translation.md`, then the translated text. If the translator flagged nothing, say so and ask which sentence they mean. Run again with `--all` on that sentence.
4. Add any phrase the user names to `vale/styles/Team/Insider.yml`, quoted, so it is caught for free next time.

## When the user says "No Claudian"

1. Produce the document first, as asked. Save it as a file.
2. Run the translator on it:
   `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs translate <file> --jobs 8`
   `${CLAUDE_PLUGIN_ROOT}` is the repo root: the plugin root when installed as a plugin, or the path `node cli.mjs install` printed. If Vale or the packs are missing, run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs install` first.
3. Read `<file>.translation.md`. Every row is one sentence: its shape, the original, the rewrite, and a note.
   - Rows marked applied are already in `<file>.translated.md`.
   - Rows marked **(kept)** could not be rewritten without knowledge only the author has. Supply it yourself if you have it, then rewrite the sentence by hand under the rules in PLAYBOOK.md §6. Otherwise leave it and say so.
   - Rows marked **(proposed, not applied) … REFUSED** are rewrites the gate refused: they added an obligation, dropped or added a negation, swapped a word for its opposite, changed who, what or where the sentence applies to, kept a reason inside the rule, or grew far past the original. Never apply them as they stand. Fix the sentence by hand so it says exactly what the original said.
   - Every applied row still deserves one read: the gate catches the marks of invention, not invention that leaves no mark. A rewrite that supplies a plausible definition from outside the paragraph passes the gate and is still wrong.
4. Replace the document with `<file>.translated.md` plus your hand fixes. Run the translator once more. A clean second pass has zero applied rows.
   Then run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs paragraphs <file>` for the shape of the whole: paragraphs of one length, a bold label opening every paragraph, a short kicker closing every paragraph, lists of three everywhere. These are what a reader senses as "this is AI" before reading a word. Vary the paragraph lengths, drop the labels, let a paragraph end on its longest sentence.
5. Report to the user in three lines: how many sentences, how many rewritten, and the kept sentences with what each needs.

## When the text lives inside something else

The translator's contract is text in, before/after pairs out. It reads markdown or plain text and nothing else, on purpose. You are the adapter for every container the text can live in. You can see the container and the tool cannot: a Word or Google document, an HTML page, a React component, a JSON resource file, a CMS field, an email. The same three steps every time.

1. **Extract the prose to a text file**, one block per paragraph, and keep the original untouched. For Word, `pandoc in.docx -t gfm --wrap=none -o in.md` (a Google document: download it as `.docx` first). For HTML, MDX or JSX/TSX, copy out the text nodes and the prose attributes (`title`, `placeholder`, `aria-label`, `alt`) and string literals of a sentence or more. Leave expressions, code and attribute names where they are. For a resource file, the string values.
2. **Run the translator** on the text file. Read `<file>.translation.md` for the story and `<file>.translation.json` for the pairs: each has `level`, `status` (applied, refused, kept), `before` exactly as it sat in the file, `after`, a word-level `diff` in `[-old-]{+new+}` notation, and `note`. The diff tells you which words kept their place, so their marks carry over, and which are new, where a mark is your decision.
3. **Patch each applied pair back** into the container at the exact place its `before` came from, verbatim match, keeping every mark, tag and attribute around it. Refused and kept rows are not patched. Show them to the user with their notes. Never touch anything that is not prose.

For Word, step 3 has a short cut: `pandoc in.md.translated.md -o out.docx --reference-doc=in.docx` rebuilds the document with the original's fonts, heading styles and spacing, and you then compare the marks on both sides (`pandoc file.docx -t gfm` on each) and re-apply anything the round trip dropped. Comments, tracked changes and complex layout do not survive pandoc. Say so if the original had them. If pandoc is missing, install it (`winget install JohnMacFarlane.Pandoc`, `brew install pandoc`) or ask the user to. Hand the user `out.docx` and the translation table. Never overwrite the original.

## When the user asks to estimate token consumption

Run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs estimate <file> --rate <r>` and show the table it prints. Use `--rate 0.3` for a first draft and say that the rate is an assumption. If the user wants a measured number, run the translator once for real and report the actual flagged count.

## Rules that bind you here

- The translator never blocks and never overrides the author. It proposes. You and the user decide.
- Do not add a phrase to `vale/styles/Team/Insider.yml` as a bare word. Quote the phrase. Run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs lint tests/insider.literal-controls.md` afterwards. It must report zero hits.
- If a rewrite says more than the original, it is wrong even when it reads better.
