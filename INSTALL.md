# Installing the Claudian Translator into a project

This file is written for a coding agent. A person can follow it too.

## What "implement it here" means

1. **Review before you run anything.** Read `README.md`, `tools/*.mjs`, `vale/.vale.ini`, `vale/styles/Team/*.yml` and `.claude/skills/no-claudian/SKILL.md`. The tools do three things and nothing else: split a markdown file into sentences, call the model CLI (`claude -p`) with a prompt built from the file, and write two files next to the input (`<file>.translation.md`, `<file>.translated.md`). There is no network access except the model CLI and `vale sync`, which downloads four public Vale style packs from their GitHub releases. Nothing reads outside the file it is given. Nothing writes outside the repo and the temp directory. Say what you found before continuing.
2. **Place the repo** inside the project, for example at `tools/claudian-translator/` (a git submodule or a plain clone).
3. **Install Vale** if it is missing: `brew install vale`, `winget install errata-ai.Vale`, or a release binary. Then run `vale sync` inside `tools/claudian-translator/vale/`.
4. **Confirm the model CLI** answers: `claude -p --model haiku --setting-sources "" <<< "reply with the word ok"`. Any CLI that reads a prompt on stdin and prints the reply will do; change the `spawn` line in `tools/translate.mjs` if yours differs.
5. **Register the skill** so "No Claudian" means something: copy `.claude/skills/no-claudian/` into the project's `.claude/skills/`, and replace `<translator>` in the skill with the real path.
6. **Prove it works** with no model spend: `node tools/claudian-translator/tools/translate.mjs tools/claudian-translator/README.md --estimate`. Then, with model spend, run the regression: `node tools/claudian-translator/tools/translate.mjs tools/claudian-translator/tests/before.md` and compare the table to the README's before/after table.
7. Celebrate.

## What to tell the user

The path where it was installed, the Vale version, which model CLI it will call, the estimate from step 6, and any sentence from the regression run that came out differently from the README's table.
