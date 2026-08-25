// plain-reader.mjs — the two-reader diff and the strict probe.
// A context-clean model restates the text clause by clause, as an engineer
// who has not read the argument. --diff restates with a weak reader and a
// strong reader and asks the strong one where the two MEANINGS differ: that
// is where a busy human will read it the wrong way. --probe asks whether any
// two statements cannot both be obeyed (calibrated to answer NONE on a clean
// text). Output is an exhibit; the verdict is the author's.
//   node tools/plain-reader.mjs <file.md> --diff
//   node tools/plain-reader.mjs <file.md> --probe
//   node tools/plain-reader.mjs <file.md> [--who]     plain restatement
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: plain-reader.mjs <standard.md> [--who] [--model m]'); process.exit(2); }
const who = args.includes('--who');
// --probe: ask for the UNCHARITABLE reading. A capable model resolves an
// ambiguous clause as the writer meant it; the ratifier, reading as a human,
// does not (29 Aug: "design change, never folded into a refactor" read as a
// contradiction; the plain restatement missed it). The probe asks outright.
const probe = args.includes('--probe') || args.includes('--probe-tension');
// --probe-tension: the ORIGINAL looser question ("appear to contradict, read
// uncharitably"). Calibrated 29 Aug: it cannot say NONE even on a plain
// rule-plus-exception, so it is NOT a gate — but it surfaced two real
// defects in rule B (first-migration vs threshold; the chain as a site vs the
// ban) that the strict probe would not necessarily name. Use it to generate
// candidates the author judges; use --probe to gate on PROBE: NONE.
const tension = args.includes('--probe-tension');
// --diff: the reviewer's idea (29 Aug) — "haiku might be a good test harness
// for testing the rules for potential misunderstandings." Measured the same
// day: haiku's restatement of rule B's first sentence reproduced the reviewer’s
// misreading twice ("the lifecycle must be expressed as a nested or parallel
// structure") where sonnet repaired it twice. A weak reader models the busy
// human; a strong reader models the writer. So: restate with BOTH, then ask
// the strong reader where the two restatements differ in MEANING. The
// disagreement is the ambiguity flag — no rubric, two strengths of reader.
const diff = args.includes('--diff');
const mi = args.indexOf('--model');
const model = mi >= 0 ? args[mi + 1] : 'sonnet';
const text = readFileSync(file, 'utf8');

const ask = [
  'You are given the text of a rule. You have no other context.',
  'For EACH numbered clause (and any parenthetical carve-out), reply with:',
  '(1) the clause number, (2) ONE sentence in your own words saying what it requires' +
    (who ? ', (3) WHO it binds - the writer of a document, the reader of a document, or unclear' : '') + '.',
  'If you cannot restate a clause, write UNCLEAR and say which words stopped you.',
  // The probe's criterion is CONTRADICTION, not tension: the first wording
  // ("appear to contradict ... not charitably") could not say NONE even on a
  // plain rule-plus-exception (calibrated 29 Aug). A rule and its exception,
  // or a rule and its fallback, can both be obeyed; two clauses a reader
  // cannot obey at once cannot.
  ...(tension ? ['Then, on a final line starting PROBE:, say whether any two statements in this text appear to contradict each other on a plain first reading — name the two statements and the tension in one sentence, or write PROBE: NONE. Read as a busy human would, not charitably.']
    : probe ? ['Then, on a final line starting PROBE:, answer this and only this: is there any pair of statements in this text that a reader could not obey at the same time — where doing what one says necessarily breaks the other? A rule with an exception, a fallback, or a threshold is NOT such a pair. If such a pair exists, name both statements and say in one sentence why they cannot both be obeyed; otherwise write exactly PROBE: NONE.'] : []),
  'Do not evaluate the rule; only restate it.',
  '',
  'TEXT:',
  text,
].join('\n');

const cwd = join(tmpdir(), 'plain-reader-empty');
mkdirSync(cwd, { recursive: true });
// No shell: an empty argument survives only when nothing re-quotes it. The
// prompt goes over stdin so a long standard never meets the command-line cap.
function run(m, input) {
  const r = spawnSync('claude', ['-p', '--model', m, '--setting-sources', ''], {
    cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 240_000,
  });
  if (r.status !== 0) { console.error(r.stderr || `claude exited ${r.status}`); process.exit(1); }
  return r.stdout.trim();
}

if (diff) {
  const weak = run('haiku', ask);
  const strong = run(model === 'haiku' ? 'sonnet' : model, ask);
  const judge = [
    'Two readers restated the same rule, clause by clause. Compare the two restatements for DIFFERENCES IN MEANING — a clause one reader took as a condition and the other as an obligation; a requirement one reader saw and the other did not; a scope one reader widened or narrowed. Ignore wording, order and detail.',
    'Reply with one line per meaningful difference in the form "DIFF <clause>: <what reader A understood> | <what reader B understood>", or exactly "DIFF: NONE" if the two restatements mean the same thing throughout.',
    '', 'THE RULE:', text, '', 'READER A (weaker model):', weak, '', 'READER B (stronger model):', strong,
  ].join('\n');
  const verdict = run(model === 'haiku' ? 'sonnet' : model, judge);
  process.stdout.write(`# plain-reader --diff · ${file} · haiku vs ${model === 'haiku' ? 'sonnet' : model} · context-clean\n\n## reader A (haiku)\n${weak}\n\n## reader B (${model === 'haiku' ? 'sonnet' : model})\n${strong}\n\n## judge\n${verdict}\n`);
  process.exit(/DIFF:\s*NONE/i.test(verdict) ? 0 : 1);
}

const out = run(model, ask);
process.stdout.write(`# plain-reader · ${file} · model ${model} · context-clean · who=${who}\n\n${out}\n`);
