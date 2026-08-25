# Installing the Claudian Translator

Written for a coding agent that was handed this repo's link and the word "install". A person can follow it too.

## 1. Read before you run

Read `README.md`, `cli.mjs`, `tools/*.mjs`, `vale/.vale.ini`, `vale/styles/Team/*.yml` and `skills/no-claudian/SKILL.md`. What the code does, in full: split a markdown file into sentences, call the model CLI (`claude -p`) with a prompt built from the file, run Vale on a file, and write two files next to the input (`<file>.translation.md`, `<file>.translated.md`). Network access: `cli.mjs install` downloads the Vale binary for this platform from `github.com/vale-cli/vale/releases` into `.bin/` if Vale is not already on the PATH, and `vale sync` downloads four public style packs into `vale/styles/`. Nothing else reaches the network. Nothing reads outside the file it is given. Nothing writes outside this repo, the project's `.claude/skills/`, and the temp directory. Tell the user what you found before continuing.

## 2. Install

```sh
git clone https://github.com/Fermi-Ventures/claudian-translator.git tools/claudian-translator
node tools/claudian-translator/cli.mjs install --into .
```

`install` finds Vale or fetches it, syncs the packs, checks that `claude -p` answers, registers the `no-claudian` skill in the project's `.claude/skills/` with the real path filled in, and runs one estimate as a smoke test. It prints each result. `node cli.mjs doctor` repeats the checks at any time.

Or install it as a Claude Code plugin, which registers the skill without a copy:

Two separate prompts; pasting both into one fails:

```
/plugin marketplace add Fermi-Ventures/claudian-translator
```

```
/plugin install claudian-translator@claudian-translator
```

Then run `node ${CLAUDE_PLUGIN_ROOT}/cli.mjs install` once for Vale and the packs.

## 3. Prove it

```sh
node tools/claudian-translator/cli.mjs estimate README.md          # no model spend
node tools/claudian-translator/cli.mjs translate tools/claudian-translator/tests/before.md
```

Compare the second run's table with the README's before/after table. Report to the user: where it was installed, the Vale version, whether the model CLI answered, the estimate, and any regression row that came out differently from the README.

## 4. Celebrate.
