// hygiene-sweep.mjs — the counters, no lists, no model.
// Flags a sentence for length (LONG > 40 words), several conditions (CONDS),
// several obligations (OBLIGS), an obligation welded to a condition (WELD),
// a semicolon, a run of fragments (STACCATO), a sentence with no verb
// (NO-VERB) and an abstraction in a person's role (ROLE). Vale covers the
// same ground with better indices; keep this as the zero-dependency fallback.
//   node tools/hygiene-sweep.mjs <file.md>
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--max', '--llm'].includes(args[i - 1])));
if (!file) { console.error('usage: hygiene-sweep.mjs <standard.md> [--max N] [--llm [model]]'); process.exit(2); }
const mi = args.indexOf('--max');
const MAX = mi >= 0 ? +args[mi + 1] : 40;
// --llm [model]: the reviewer's ideation (29 Aug) — "hygiene-sweep might
// cover more hygiene cases if we used cheap haiku calls." The regex floor
// counts; a small model can JUDGE the per-sentence questions the writing
// rules actually ask: two obligations or one stated twice? an obligation
// with no named agent? a justification wearing a rule's clothes (rule 2)? a
// pronoun with two antecedents? a term used before it is defined (rule 3)?
// metaphor (rule 4)? One call per sentence, the whole block as context,
// JSON back, context-clean. Still an exhibit generator, never a gate.
// CALIBRATED 29 Aug on the v4.2/v4.1 pair: --llm haiku flagged 12 of 13 on
// the should-pass text and 5 of 5 on the should-fail — it cannot separate
// them (NO-AGENT on nearly every sentence: the text's passive voice is a
// document-level property, not a per-sentence defect; TERMS on ordinary
// words). What it finds that regex cannot: JUSTIFICATION + METAPHOR on "the
// chain counts as a site because it is the tell" — a rule-2 sentence in a
// rule's clothes. Use --llm as a rule 2/3/4 FINDER whose output the author
// reads; never count its flags toward a verdict. The two-reader diff in
// plain-reader.mjs (--diff) is the better use of the cheap model.
const li = args.indexOf('--llm');
const LLM = li >= 0 ? (args[li + 1] && !args[li + 1].startsWith('--') ? args[li + 1] : 'haiku') : null;

const raw = readFileSync(file, 'utf8')
  .replace(/\r/g, '')
  .replace(/^#+ .*$/gm, '')          // headings out
  .replace(/[*_`>]/g, '')            // emphasis, code, quote marks out
  .replace(/\(([^()]*)\)/g, ' ($1) ') // keep parentheticals, space them
  .replace(/\n{2,}/g, '\n\n');

// Sentence split: end punctuation followed by space+capital, or a blank line.
// Parenthetical asides are kept inside their sentence (they are read inside it).
const sentences = raw
  .split(/\n\n+/)
  .flatMap(p => p.split(/\n(?=\s*[-*•]\s)/))   // each bullet is its own sentence
  .flatMap(p => p.replace(/^\s*[-*•]\s+/, '').replace(/\n/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z(“"'])/))
  .map(s => s.trim())
  .filter(s => s.split(/\s+/).length >= 4);

const COND = /\b(if|when|whenever|where|wherever|once|unless|until|provided that|as long as|in case|only if|so long as)\b/gi;
const OBLIG = /\b(must|must not|never|always|shall|may not|is required to|is forbidden|do not|does not|belongs to|carries|declares|is announced|is declared|is expressed|check the source|read it from|compute it)\b/gi;

const cwd = join(tmpdir(), 'hygiene-empty');
mkdirSync(cwd, { recursive: true });
function judge(sentence) {
  const prompt = [
    'You are checking ONE sentence of a rule for reader hygiene. You have the whole rule for context; judge only the sentence.',
    'Reply with a single JSON object and nothing else, with exactly these keys:',
    '{"conditions": <integer: distinct conditions the sentence sets, e.g. "if/when/where/unless" clauses>,',
    ' "obligations": <integer: distinct things the sentence requires or forbids; a duty stated positively and then negatively ("do X, never Y" where Y is the opposite of X) counts ONCE>,',
    ' "agent": "named" | "missing" | "n/a" (missing = the sentence obliges someone but never says who),',
    ' "justification": <true if the sentence explains WHY rather than saying what to do or what will be refused>,',
    ' "ambiguous_pronoun": <true if an it/this/that/they could refer to two different nouns in the rule>,',
    ' "undefined_terms": [<terms the sentence uses that the rule never defines and an engineer outside this organisation would not know>],',
    ' "metaphor": <true if the sentence relies on a figure of speech to carry its meaning>,',
    ' "run_on": <true if the sentence should be two or more sentences>}',
    '',
    'WHOLE RULE (context):',
    raw,
    '',
    'THE SENTENCE:',
    sentence,
  ].join('\n');
  const r = spawnSync('claude', ['-p', '--model', LLM, '--setting-sources', '', '--tools', ''], {
    cwd, encoding: 'utf8', input: prompt, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000,
  });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// STACCATO (reviewer, 29 Aug): "bullet points rendered horizontally in a
// paragraph" — a run of very short sentences, several without a verb or an
// object: "Two lanes and one loop. The linter counts and remembers. The models
// read and discover. The reviewer decides." The readability indices and the
// sentence-length rule REWARD this shape, so a text optimised to them drifts
// into it. Flag a run of three or more consecutive sentences of at most
// SHORT words, and any sentence with no verb-like token. Heuristic, exhibit.
const SHORT = 7;
const VERBISH = /\b(is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would|\w+(?:s|es|ed|ing))\b/i;
// A bare imperative has a verb too ("Run vale sync once." / "Rewrite or defend each flag.").
const IMPERATIVE = /^(?:then |and |or |also |first |now )?(run|use|set|write|hand|give|say|check|read|treat|rewrite|defend|calibrate|record|build|create|install|follow|put|split|name|label|seed|start|strip|send|compute|verify|keep|make|add|remove|delete|drop|move|open|close|ask|tell|show|list|count|compare|restate|reply|flag|mark|treat|declare|derive|do|let|assume|note|see|go|look|copy|paste)\b/i;
// ROLE (reviewer, 29 Aug): an abstraction in a person's role — "readable only
// to that conversation" (conversations do not read), "the diff decides", "the
// ledger remembers". Grammatical, so no other flag fires; the reader stalls at
// the last preposition and repairs it. Documents may say/show/prove (not flagged).
const ROLE = /(?:readable|legible|visible|clear|obvious|intelligible|meaningful|opaque|known|familiar)(?: only)? to (?:that|the|this|a|an|its|our|one) (?:conversation|thread|session|transcript|chat|context|argument|diff|ledger|census|codebase|repo|repository|record|pipeline)s?\b|\b(?:conversation|thread|session|transcript|ledger|diff|census|codebase|repo|repository|pipeline|standard|rule|charter)s? (?:knows|reads|remembers|forgets|decides|understands|believes|wants|expects|thinks|assumes|cares)\b/i;
const staccato = new Set();
{
  let run = [];
  sentences.forEach((s, i) => {
    const w = s.split(/\s+/).length;
    if (w <= SHORT) run.push(i); else { if (run.length >= 3) run.forEach(k => staccato.add(k)); run = []; }
  });
  if (run.length >= 3) run.forEach(k => staccato.add(k));
}

let flagged = 0;
console.log(`# hygiene-sweep · ${file} · max ${MAX} words${LLM ? ` · llm ${LLM}` : ''}\n`);
sentences.forEach((s, i) => {
  const words = s.split(/\s+/).length;
  const conds = (s.match(COND) || []).length;
  // "X, never Y" is ONE obligation stated positively and negatively (the
  // rule idiom "expressed in the definition, never as a loop"); a "never"
  // that follows a comma restates, it does not add. Calibrated on v4.2.
  const obligs = (s.replace(/,\s+never\b/gi, ', ').match(OBLIG) || []).length;
  const flags = [];
  if (words > MAX) flags.push(`LONG ${words}w`);
  if (conds >= 2) flags.push(`CONDS ${conds}`);
  if (obligs >= 2) flags.push(`OBLIGS ${obligs}`);
  // WELD: an obligation marker, then a chaining token, then another obligation or condition
  const firstOb = s.search(OBLIG);
  if (firstOb >= 0) {
    const tail = s.slice(firstOb);
    if (/(\s—\s|:\s|,?\s+and\s+)/.test(tail) && ((tail.match(OBLIG) || []).length >= 2 || (tail.match(COND) || []).length >= 1)) {
      if (!flags.some(f => f.startsWith('OBLIGS') || f.startsWith('CONDS'))) flags.push('WELD');
    }
  }
  if (/;/.test(s)) flags.push('SEMICOLON');
  if (staccato.has(i)) flags.push('STACCATO');
  if (ROLE.test(s)) flags.push('ROLE');
  if (!VERBISH.test(s) && !IMPERATIVE.test(s)) flags.push('NO-VERB');
  if (LLM) {
    const j = judge(s);
    if (j) {
      if (j.obligations >= 2) flags.push(`LLM:OBLIGS ${j.obligations}`);
      if (j.conditions >= 2) flags.push(`LLM:CONDS ${j.conditions}`);
      if (j.obligations >= 1 && j.agent === 'missing') flags.push('LLM:NO-AGENT');
      if (j.justification) flags.push('LLM:JUSTIFICATION');
      if (j.ambiguous_pronoun) flags.push('LLM:PRONOUN');
      if (j.undefined_terms && j.undefined_terms.length) flags.push(`LLM:TERMS ${j.undefined_terms.join('/')}`);
      if (j.metaphor) flags.push('LLM:METAPHOR');
      if (j.run_on) flags.push('LLM:RUN-ON');
      // The regex floor over-counts "X, never Y"; if the model says one obligation, drop the regex OBLIGS flag.
      if (j.obligations <= 1) { const k = flags.findIndex(f => /^OBLIGS/.test(f)); if (k >= 0) flags.splice(k, 1); }
    } else flags.push('LLM:unparsed');
  }
  if (flags.length) {
    flagged++;
    console.log(`## s${i + 1} [${flags.join(' · ')}]\n    ${s}\n`);
  }
});
console.log(`## result: ${flagged} of ${sentences.length} sentences flagged — ${flagged ? 'REWRITE OR DEFEND' : 'CLEAN'}`);
process.exit(flagged ? 1 : 0);
