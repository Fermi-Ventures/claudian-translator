// claudian.mjs — the insider-prose finder.
// One cheap model call per sentence, eight in flight, asks: is this sentence
// written for someone who was in the conversation that produced it?
// Signs: a coined phrase used as if defined; a metaphor that carries the
// meaning; a reason where an instruction should be; a fragment in a run of
// fragments; an abstraction in a person's role. Output is an exhibit the
// author rewrites or defends, never a gate.
//   node tools/claudian.mjs <file.md> [--model haiku|sonnet] [--jobs 8]
//   node tools/claudian.mjs --calibrate [--model haiku]   confusion matrix on tests/claudian.calibration.json
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const calibrate = args.includes('--calibrate');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('--model', 'haiku');
const JOBS = Math.max(1, +opt('--jobs', 8));
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--model', '--jobs'].includes(args[i - 1])));
const here = dirname(fileURLToPath(import.meta.url));
const cwd = join(tmpdir(), 'claudian-empty');
mkdirSync(cwd, { recursive: true });

const RUBRIC = [
  'You are a senior engineer at a company you have never heard of, reading ONE sentence from an engineering standard. You have no other context.',
  'A sentence is "insider prose" when it is written for someone who was in the conversation that produced it. Signs: a coined phrase used as if it were defined; a metaphor or figure of speech that carries the meaning (the sentence collapses without it); an abstract noun where a concrete instruction should be; a sentence that argues or explains instead of telling you what to do or what will be refused; a term of art you would have to ask a colleague about.',
  'A second sign, of FORM rather than vocabulary: a fragment in a run of fragments — a sentence with no verb or no object that reads as a bullet point rendered horizontally in a paragraph ("Two lanes and one loop. The linter counts and remembers. The reviewer decides."). Mark such a fragment as insider prose too, and name the missing part.',
  'A third sign: an abstraction put in a person\'s role — a noun that cannot do what the sentence has it do ("readable only to that conversation": a conversation does not read; "the diff decides"; "the ledger remembers"). The sentence is grammatical and a fluent reader repairs it, but the reader has to ask who the object is. Mark it, and name the person the noun stands for. Documents may "say", "show" or "prove"; that is ordinary English and NOT this sign.',
  'A sentence is NOT insider prose merely because it is technical, terse, or uses ordinary engineering words (schema, cache, migration, executor, threshold). A word that has a metaphorical use elsewhere (class, function, application, load-bearing, amnesty) used LITERALLY is not insider prose. A short sentence that has a subject, a verb and its object is fine.',
  'Reply with one JSON object and nothing else: {"insider": true|false, "phrase": "<the words that make it insider, or empty>", "why": "<one sentence>"}',
];

// Context: the surrounding paragraph, so ordinary cohesion ("them", "One was
// …", "the ten") is not mistaken for insider prose. Calibrated 29 Aug: with no
// neighbours the finder flagged 55 of 77 sentences of a plain page, most of
// them anaphora; the rubric still judges the ONE sentence.
function classify(sentence, context = '') {
  return new Promise((resolve) => {
    const prompt = [...RUBRIC, '', ...(context ? ['THE PARAGRAPH IT SITS IN (context only — judge the sentence, and use this to resolve pronouns and back-references):', context, ''] : []), 'THE SENTENCE:', sentence].join('\n');
    const p = spawn('claude', ['-p', '--model', MODEL, '--setting-sources', ''], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 120_000);
    p.stdout.on('data', d => { out += d; });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return resolve(null);
      try { resolve(JSON.parse(m[0])); } catch { resolve(null); }
    });
    p.stdin.end(prompt);
  });
}

// A small pool: at most JOBS classifications in flight; results in input order.
async function classifyAll(sentences) {
  const results = new Array(sentences.length);
  let next = 0;
  async function worker() {
    while (next < sentences.length) { const i = next++; results[i] = await classify(sentences[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, sentences.length) }, worker));
  return results;
}

if (calibrate) {
  const set = JSON.parse(readFileSync(join(here, '..', 'tests', 'claudian.calibration.json'), 'utf8'));
  const t0 = Date.now();
  const res = await classifyAll(set.map(s => s.text));
  let tp = 0, fp = 0, tn = 0, fn = 0;
  console.log(`# claudian --calibrate · model ${MODEL} · ${set.length} labelled sentences · ${JOBS} in flight\n`);
  set.forEach((s, i) => {
    const j = res[i];
    const got = j ? (j.insider ? 1 : 0) : null;
    const mark = got === null ? '??' : got === s.label ? 'ok' : (s.label ? 'MISS' : 'FALSE+');
    if (got === 1 && s.label === 1) tp++; else if (got === 1 && s.label === 0) fp++; else if (got === 0 && s.label === 0) tn++; else if (got === 0 && s.label === 1) fn++;
    console.log(`${mark.padEnd(6)} label ${s.label} got ${got ?? '?'}  ${JSON.stringify(s.text)}\n       ${j ? `${j.phrase ? `[${j.phrase}] ` : ''}${j.why}` : 'unparsed'}`);
  });
  const prec = tp / (tp + fp || 1), rec = tp / (tp + fn || 1);
  console.log(`\n## result · TP ${tp} · FP ${fp} · TN ${tn} · FN ${fn} · precision ${prec.toFixed(2)} · recall ${rec.toFixed(2)} · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  process.exit(0);
}

if (!file) { console.error('usage: claudian.mjs --calibrate | <standard.md> [--model m] [--jobs n]'); process.exit(2); }
const raw = readFileSync(file, 'utf8').replace(/\r/g, '').replace(/^#+ .*$/gm, '').replace(/[*_`>]/g, '');
// Keep each sentence's paragraph as its context, and prepend the document's
// opening paragraph (where a page defines its terms) — a coined term defined
// once in the lede should not be flagged in every later paragraph. Table rows
// are not prose and are skipped.
const paras = raw.split(/\n\n+/).flatMap(p => p.split(/\n(?=\s*[-*•]\s)/)).map(p => p.replace(/^\s*[-*•]\s+/, '').replace(/\n/g, ' ').trim()).filter(p => p && !/^\|/.test(p) && !/^\s*\|/.test(p));
const opening = paras[0] || '';
const items = paras.flatMap((para, pi) => para.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/).map(s => ({ s: s.trim(), para: pi === 0 ? para : `${opening}\n\n[…]\n\n${para}` })))
  .filter(x => x.s.split(/\s+/).length >= 3 && !/\|/.test(x.s));
const sentences = items.map(x => x.s);
const t0 = Date.now();
const res = await (async () => {
  const out = new Array(items.length); let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await classify(items[i].s, items[i].para); } }
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, worker));
  return out;
})();
let flagged = 0;
console.log(`# claudian · ${file} · model ${MODEL} · ${sentences.length} sentences · ${JOBS} in flight\n`);
sentences.forEach((s, i) => { const j = res[i]; if (j && j.insider) { flagged++; console.log(`## INSIDER${j.phrase ? ` [${j.phrase}]` : ''}\n    ${s}\n    ${j.why}\n`); } });
console.log(`## result: ${flagged} of ${sentences.length} sentences flagged · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
process.exit(flagged ? 1 : 0);
