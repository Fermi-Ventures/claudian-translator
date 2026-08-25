// translate.mjs — the converter.
// Three model steps, two tiers. (1) FIND: the cheap tier reads every sentence
// with its paragraph and flags insider prose; counters flag form (length,
// welded obligations, semicolons, an abstraction in a person's role).
// (2) REWRITE: the strong tier rewrites each flagged sentence by shape under
// the writing rules, or says KEEP and names what the author must supply.
// (3) CHECK: the strong tier compares BEFORE and AFTER and says whether the
// rewrite requires, permits or drops anything the original did not. Only a
// rewrite that passes the check is applied; the rest are proposed in the table
// with the change named. Output: a before/after table by shape, and the
// document with the passing rewrites applied. The author accepts or reverts.
//   node tools/translate.mjs <file.md> [--find haiku] [--rewrite sonnet] [--jobs 8] [--all] [--no-check]
//   node tools/translate.mjs <file.md> --estimate [--rate 0.3]     no model calls: sentences, tokens, dollars
//   --all       skip the finder; send every sentence to the strong tier
//   --no-check  apply every rewrite without the fidelity check (not advised)
// Writes <file>.translation.md (the table) and <file>.translated.md (the document).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FIND = opt('--find', 'haiku');
const REWRITE = opt('--rewrite', 'sonnet');
const JOBS = Math.max(1, +opt('--jobs', 8));
const ALL = args.includes('--all');
const CHECK = !args.includes('--no-check');
const ESTIMATE = args.includes('--estimate');
const RATE = +opt('--rate', 0.3);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--find', '--rewrite', '--jobs', '--rate'].includes(args[i - 1])));
if (!file && !args.includes('--calibrate-check')) { console.error('usage: translate.mjs <file.md> [--find m] [--rewrite m] [--jobs n] [--all] [--no-check] | <file.md> --estimate [--rate r] [--secs f,r,c] | --calibrate-check'); process.exit(2); }
const cwd = join(tmpdir(), 'claudian-empty');
mkdirSync(cwd, { recursive: true });

// Prices, US dollars per million tokens, for --estimate only. Edit to match
// your account. Set 29 Aug 2026 from the public list; they change.
const PRICES = { haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 }, opus: { in: 15, out: 75 } };

// ---------- the finder's rubric (kept identical to claudian.mjs) ----------
const RUBRIC = [
  'You are a senior engineer at a company you have never heard of, reading ONE sentence from an engineering standard. You have no other context.',
  'A sentence is "insider prose" when it is written for someone who was in the conversation that produced it. Signs: a coined phrase used as if it were defined; a metaphor or figure of speech that carries the meaning (the sentence collapses without it); an abstract noun where a concrete instruction should be; a sentence that argues or explains instead of telling you what to do or what will be refused; a term of art you would have to ask a colleague about.',
  'A second sign, of FORM rather than vocabulary: a fragment in a run of fragments — a sentence with no verb or no object that reads as a bullet point rendered horizontally in a paragraph ("Two lanes and one loop. The linter counts and remembers. The reviewer decides."). Mark such a fragment as insider prose too, and name the missing part.',
  'A third sign: an abstraction put in a person\'s role — a noun that cannot do what the sentence has it do ("readable only to that conversation": a conversation does not read; "the diff decides"; "the ledger remembers"). The sentence is grammatical and a fluent reader repairs it, but the reader has to ask who the object is. Mark it, and name the person the noun stands for. Documents may "say", "show" or "prove"; that is ordinary English and NOT this sign.',
  'A sentence is NOT insider prose merely because it is technical, terse, or uses ordinary engineering words (schema, cache, migration, executor, threshold). A word that has a metaphorical use elsewhere (class, function, application, load-bearing, amnesty) used LITERALLY is not insider prose. A short sentence that has a subject, a verb and its object is fine.',
  'Reply with one JSON object and nothing else: {"insider": true|false, "phrase": "<the words that make it insider, or empty>", "why": "<one sentence>"}',
];

// ---------- the rewriter's rules ----------
const RULES = [
  'You are rewriting ONE sentence from a document so that a reader who was not in the conversation that produced it gets exactly the meaning the writer intended. You have the sentence, the paragraph it sits in, and the reason it was flagged.',
  'Rules for the rewrite:',
  '1. One condition and at most one obligation per sentence. Past about 40 words, split into sentences.',
  '2. The reason lives beside the rule, not inside it. "X because Y" becomes "X." Return Y separately as dropped_reason so the author can place it as a note; never delete a reason silently, and never keep "because" in the rewrite.',
  '3. A rule with an exception labels the exception ("The one exception:").',
  '4. Say when the rule starts, in the rule, if the sentence points at a threshold elsewhere.',
  '5. Label examples as examples. Two examples are not a closed list: add "among others" or say "for example".',
  '6. Do not render bullets horizontally, and do not expand them either. A run of fragments ("Two lanes and one loop. The linter counts and remembers. The reviewer decides.") is a hook; keep it a hook. Fold the fragments into ONE sentence of about the same length, giving each its verb and its object ("Two lanes, one loop: the linter counts sentences, the models read for meaning, and the reviewer decides."). Never turn a hook into an explanation.',
  '7. Name the person. An abstraction in a person\'s role ("readable only to that conversation", "the diff decides") becomes the people it stands for.',
  '8. Replace a coined phrase, a slogan or a metaphor with the plain statement of what it means IN THIS CONTEXT. Use only meaning recoverable from the sentence and its paragraph. Do not invent facts, mechanisms or definitions. Do not add a requirement, a permission or a hedge. Do not change what is required or refused. A rewrite that says less than the original but nothing false is better than one that says more.',
  '9. If the sentence is a legitimate literal use, or cannot be rewritten without knowledge you do not have, set keep to true and say in note what the author must supply.',
  'Shape vocabulary (pick the closest): metaphor as definition · metaphor · metaphor as instruction · slogan · coined noun · reason inside the rule · ordinary words with insider meaning · an abstraction in a person\'s role · welded obligations · closed list · read as a contradiction · bullets rendered horizontally · long sentence · semicolon.',
  'Examples of the standard expected:',
  'BEFORE: A copy you did not write is still only evidence of its moment — re-derive before relying.  AFTER: A copied fact in a document you did not write was true when it was copied, not necessarily now. Check the source before you act on it.  (metaphor as definition)',
  'BEFORE: The chain counts as a site because it is the tell — the defect this rule exists to find.  AFTER: The chain is counted as evidence of the defect, not as permission for it.  dropped_reason: the chain is the defect this rule exists to find.  (reason inside the rule)',
  'BEFORE: Standards written inside a long AI-assisted conversation come out readable only to that conversation.  AFTER: Standards written inside a long AI-assisted conversation come out readable only to the people who were in that conversation.  (an abstraction in a person\'s role)',
  'Reply with one JSON object and nothing else: {"shape": "<from the vocabulary>", "after": "<the rewritten sentence or sentences>", "dropped_reason": "<a reason moved out of the rule, or empty>", "keep": true|false, "note": "<one sentence: what changed, or what the author must supply>"}',
];

// ---------- the fidelity check ----------
const CHECKER = [
  'Two versions of one sentence from a document. BEFORE was written by an author inside a long conversation; AFTER is a translation for a reader who was not in it. You are the author. Read AFTER and answer one question: is this what I meant? SAME means you would sign it. CHANGED means you would say "I did not say that".',
  'A translation MUST say things BEFORE only implied. That is its job. So the following are SAME: a metaphor or coined phrase replaced by the plain claim it stood for, when the paragraph and the sentence support that reading; an implied instruction made explicit ("X is a backlog item in disguise" becomes "file X as a backlog item"); a person named in place of an abstraction; a long sentence split; a reason moved out and listed under DROPPED REASON; a general word in place of a jargon word with the same reach ("change" for "migration" when the paragraph does not depend on the difference); fewer words with nothing false added.',
  'CHANGED means a reader following AFTER would do something different from a reader who understood BEFORE: a new obligation or prohibition on someone (BEFORE described, AFTER commands something BEFORE never asked for); an actor, mechanism, cause, frequency or object that the author could not have meant from the sentence and its paragraph; scope narrowed or widened; a hedge or a "typically" added; a stronger or weaker duty; a reason deleted without being listed under DROPPED REASON.',
  'Do not refuse a translation for being more concrete than the original. Refuse it for being concrete about the WRONG thing. If you are unsure, ask which reading the paragraph supports; if the paragraph supports AFTER, answer SAME.',
  'Reply with one JSON object and nothing else: {"same": true|false, "changed": "<what a reader of AFTER would do or believe that a reader of BEFORE would not, or empty>"}',
];

// ---------- fidelity counters: the gate on a rewrite ----------
// Calibrated on tests/fidelity.calibration.json (18 pairs): the rewrites that
// invented meaning carried a new obligation word, kept a "because", or ran
// past 2.5x the original's length; the reviewer-accepted rewrites did none of
// these. The model check (CHECKER below) was near chance on the same pairs in
// two framings, so it is ADVISORY: its verdict goes in the note, never the gate.
const OBWORDS = /\b(must|shall|required|never|always|only|mandatory|prohibited)\b/gi;
const REASON = /\b(because|which is why|this is why|the reason is|exists to|in order to)\b/i;
function fidelityCounters(before, after) {
  const f = [];
  const ob = s => new Set((s.match(OBWORDS) || []).map(w => w.toLowerCase()));
  const nb = ob(before), na = ob(after);
  const added = [...na].filter(w => !nb.has(w));
  if (added.length) f.push(`new obligation word: ${added.join(', ')}`);
  if (REASON.test(after)) f.push('reason kept inside the rule');
  const ratio = after.split(/\s+/).length / Math.max(1, before.split(/\s+/).length);
  if (ratio > 2.5) f.push(`rewrite is ${ratio.toFixed(1)}x the original's length`);
  return f;
}

// ---------- counters (the deterministic half, no lists) ----------
const OBLIG = /\b(must|shall|never|always|only|is required|are required|is announced|is expressed|belongs to|counts as|is counted)\b/gi;
const ROLE = /(?:readable|legible|visible|clear|obvious|intelligible|meaningful|opaque|known|familiar)(?: only)? to (?:that|the|this|a|an|its|our|one) (?:conversation|thread|session|transcript|chat|context|argument|diff|ledger|census|codebase|repo|repository|record|pipeline)s?\b|\b(?:conversation|thread|session|transcript|ledger|diff|census|codebase|repo|repository|pipeline|standard|rule|charter)s? (?:knows|reads|remembers|forgets|decides|understands|believes|wants|expects|thinks|assumes|cares)\b/i;
function counters(s, x) {
  const f = [];
  if (x && x.staccato) f.push(`bullets rendered horizontally (${x.staccato} fragments; fold into one sentence of the same length)`);
  const w = s.split(/\s+/).length;
  if (w > 40) f.push(`long sentence (${w} words)`);
  if ((s.match(OBLIG) || []).length >= 2) f.push('several obligations in one sentence');
  if (/;/.test(s)) f.push('semicolon');
  if (ROLE.test(s)) f.push('an abstraction in a person\'s role');
  return f;
}

// ---------- model plumbing ----------
function ask(model, prompt) {
  return new Promise((resolve) => {
    const p = spawn('claude', ['-p', '--model', model, '--setting-sources', ''], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 180_000);
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
async function pool(items, fn) {
  const out = new Array(items.length); let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, worker));
  return out;
}

// ---------- --calibrate-check: the checker against labelled pairs ----------
if (args.includes('--calibrate-check')) {
  const set = JSON.parse(readFileSync(new URL('../tests/fidelity.calibration.json', import.meta.url), 'utf8'));
  // The paragraph each BEFORE sits in, from the regression text, so the checker
  // sees what the real run sees.
  const regParas = readFileSync(new URL('../tests/before.md', import.meta.url), 'utf8').replace(/\r/g, '').replace(/^#+ .*$/gm, '').split(/\n\n+/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  const paraOf = s => regParas.find(p => p.includes(s.slice(0, 40))) || '(not available)';
  const t0 = Date.now();
  const res = await pool(set, c => ask(REWRITE, [...CHECKER, '', 'THE PARAGRAPH:', paraOf(c.before), '', 'BEFORE:', c.before, '', 'AFTER:', c.after, '', 'DROPPED REASON:', c.dropped || '(none)'].join('\n')));
  let tp = 0, fp = 0, tn = 0, fn = 0, ctp = 0, cfp = 0, ctn = 0, cfn = 0;
  console.log(`# translate --calibrate-check · model ${REWRITE} (advisory) · counters (the gate) · ${set.length} labelled pairs\n`);
  set.forEach((c, i) => {
    const r = res[i]; const got = r ? !!r.same : null;
    const mark = got === null ? '??' : got === c.same ? 'ok' : (c.same ? 'REFUSED-GOOD' : 'PASSED-BAD');
    if (got === true && c.same) tp++; else if (got === true && !c.same) fp++; else if (got === false && !c.same) tn++; else if (got === false && c.same) fn++;
    const fc = fidelityCounters(c.before, c.after); const cgot = fc.length === 0;
    const cmark = cgot === c.same ? 'ok' : (c.same ? 'REFUSED-GOOD' : 'PASSED-BAD');
    if (cgot && c.same) ctp++; else if (cgot && !c.same) cfp++; else if (!cgot && !c.same) ctn++; else cfn++;
    console.log(`model ${mark.padEnd(13)} counters ${cmark.padEnd(13)} same=${c.same}  ${JSON.stringify(c.after.slice(0, 80))}\n              model: ${r ? (r.changed || '(same)') : 'unparsed'}\n              counters: ${fc.join('; ') || '(same)'}`);
  });
  console.log(`\n## model (advisory) · accepted-good ${tp} · refused-good ${fn} · refused-bad ${tn} · passed-bad ${fp}`);
  console.log(`## counters (the gate) · accepted-good ${ctp} · refused-good ${cfn} · refused-bad ${ctn} · passed-bad ${cfp} · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  process.exit(0);
}

// ---------- split (identical to claudian.mjs) ----------
const original = readFileSync(file, 'utf8');
const raw = original.replace(/\r/g, '').replace(/^#+ .*$/gm, '').replace(/[*_`>]/g, '');
const paras = raw.split(/\n\n+/).flatMap(p => p.split(/\n(?=\s*[-*•]\s)/)).map(p => p.replace(/^\s*[-*•]\s+/, '').replace(/\n/g, ' ').trim()).filter(p => p && !/^\|/.test(p) && !/^\s*\|/.test(p));
const opening = paras[0] || '';
// A run of three or more fragments (FIVE words or fewer) is "bullets rendered
// horizontally". Judged one at a time it is unrewritable — no single fragment
// can be folded into a hook — so the run is one item: the rewriter sees all
// of it and rule 6 applies to the whole. Five, not the sweep's seven: at
// seven the merge swallowed three independent seven-word claims in one
// paragraph of the regression text and rewrote them as one sentence.
const items = paras.flatMap((para, pi) => {
  const ctx = pi === 0 ? para : `${opening}\n\n[…]\n\n${para}`;
  const ss = para.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/).map(s => s.trim()).filter(s => s && !/\|/.test(s));
  const out = []; let run = [];
  const flush = () => { if (run.length >= 3) out.push({ s: run.join(' '), para: ctx, staccato: run.length }); else run.forEach(s => out.push({ s, para: ctx })); run = []; };
  for (const s of ss) { if (s.split(/\s+/).length <= 5) run.push(s); else { flush(); out.push({ s, para: ctx }); } }
  flush();
  return out;
}).filter(x => x.s.split(/\s+/).length >= 3);

// ---------- --estimate: no model calls ----------
const tok = s => Math.ceil(s.length / 4);
if (ESTIMATE) {
  const rubric = tok(RUBRIC.join('\n')), rules = tok(RULES.join('\n')), checker = tok(CHECKER.join('\n'));
  const findIn = items.reduce((a, x) => a + rubric + tok(x.para) + tok(x.s) + 40, 0), findOut = items.length * 60;
  const n = Math.round(items.length * RATE);
  const avgPara = items.reduce((a, x) => a + tok(x.para), 0) / (items.length || 1), avgS = items.reduce((a, x) => a + tok(x.s), 0) / (items.length || 1);
  const rwIn = Math.round(n * (rules + avgPara + avgS + 80)), rwOut = n * 200;
  const ckIn = Math.round(n * (checker + 3 * avgS + 40)), ckOut = n * 60;
  const price = (m, i, o) => ((PRICES[m] || PRICES.sonnet).in * i + (PRICES[m] || PRICES.sonnet).out * o) / 1e6;
  const find$ = ALL ? 0 : price(FIND, findIn, findOut), rw$ = price(REWRITE, rwIn, rwOut), ck$ = CHECK ? price(REWRITE, ckIn, ckOut) : 0;
  // Seconds a call, find/rewrite/check. CLI start-up dominates and varies by
  // machine and hour (we have measured 2 s and 30 s for the same call on
  // different days). Pass --secs f,r,c from a real run.
  const [SF, SR, SC] = opt('--secs', '5,10,6').split(',').map(Number);
  const secs = (calls, per) => Math.ceil(calls * per / JOBS);
  console.log(`# estimate · ${file} · ${items.length} sentences · assumed flag rate ${RATE} → ${n} rewrites · prices per Mtok: ${FIND} $${PRICES[FIND]?.in}/$${PRICES[FIND]?.out}, ${REWRITE} $${PRICES[REWRITE]?.in}/$${PRICES[REWRITE]?.out}\n`);
  console.log('| step | model | calls | tokens in | tokens out | dollars | wall, 1 at a time | wall, ' + JOBS + ' at a time |');
  console.log('|---|---|---|---|---|---|---|---|');
  if (!ALL) console.log(`| find | ${FIND} | ${items.length} | ${findIn} | ${findOut} | $${find$.toFixed(3)} | ${secs(items.length, SF) * JOBS}s | ${secs(items.length, SF)}s |`);
  console.log(`| rewrite | ${REWRITE} | ${n} | ${rwIn} | ${rwOut} | $${rw$.toFixed(3)} | ${secs(n, SR) * JOBS}s | ${secs(n, SR)}s |`);
  if (CHECK) console.log(`| check | ${REWRITE} | ${n} | ${ckIn} | ${ckOut} | $${ck$.toFixed(3)} | ${secs(n, SC) * JOBS}s | ${secs(n, SC)}s |`);
  console.log(`| **total** | | ${(ALL ? 0 : items.length) + 2 * n} | ${(ALL ? 0 : findIn) + rwIn + (CHECK ? ckIn : 0)} | ${(ALL ? 0 : findOut) + rwOut + (CHECK ? ckOut : 0)} | **$${(find$ + rw$ + ck$).toFixed(2)}** | | |`);
  console.log(`\nAssumptions: 4 characters a token; 60 output tokens a finder call, 200 a rewrite, 60 a check; ${SF}, ${SR} and ${SC} seconds a call (pass --secs f,r,c from a measured run; CLI start-up varies by machine and hour). The flag rate is the one number you must supply: 0.1 for ordinary prose, 0.3 for a first draft, 0.7 for text a reviewer has already sent back. Measure it once with a real run and pass --rate.`);
  process.exit(0);
}

// ---------- stage 1: find ----------
const t0 = Date.now();
console.error(`# translate · ${file} · ${items.length} sentences · find ${ALL ? 'all' : FIND} · rewrite ${REWRITE} · check ${CHECK ? REWRITE : 'off'} · ${JOBS} in flight`);
let found;
if (ALL) found = items.map(() => ({ insider: true, phrase: '', why: '--all' }));
else found = await pool(items, x => ask(FIND, [...RUBRIC, '', 'THE PARAGRAPH IT SITS IN (context only — judge the sentence, and use this to resolve pronouns and back-references):', x.para, '', 'THE SENTENCE:', x.s].join('\n')));
const t1 = Date.now();
const flagged = items.map((x, i) => ({ ...x, i, find: found[i], form: counters(x.s, x) })).filter(x => (x.find && x.find.insider) || x.form.length);
console.error(`# found ${flagged.length} of ${items.length} · ${((t1 - t0) / 1000).toFixed(0)}s`);

// ---------- stage 2: rewrite ----------
const rewritten = await pool(flagged, x => ask(REWRITE, [...RULES, '',
  'WHY IT WAS FLAGGED:', [x.find && x.find.insider ? `insider prose${x.find.phrase ? ` [${x.find.phrase}]` : ''}: ${x.find.why}` : '', ...x.form].filter(Boolean).join('; '), '',
  'THE PARAGRAPH IT SITS IN:', x.para, '',
  'THE SENTENCE:', x.s].join('\n')));
const t2 = Date.now();

// ---------- stage 3: check ----------
const toCheck = flagged.map((x, k) => ({ x, r: rewritten[k], k })).filter(c => CHECK && c.r && !c.r.keep && c.r.after);
const checks = await pool(toCheck, c => ask(REWRITE, [...CHECKER, '', 'THE PARAGRAPH:', c.x.para, '', 'BEFORE:', c.x.s, '', 'AFTER:', c.r.after, '', 'DROPPED REASON:', c.r.dropped_reason || '(none)'].join('\n')));
const checkOf = new Map(toCheck.map((c, j) => [c.k, checks[j]]));
const t3 = Date.now();

// ---------- outputs ----------
const esc = s => String(s || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const rows = []; let translated = original; let applied = 0, kept = 0, proposed = 0, unparsed = 0;
flagged.forEach((x, k) => {
  const r = rewritten[k];
  if (!r) { unparsed++; rows.push(['(unparsed)', x.s, '', 'the rewriter returned nothing; run again']); return; }
  if (r.keep || !r.after) { kept++; rows.push([r.shape || 'kept', x.s, '(kept)', r.note || '']); return; }
  const c = checkOf.get(k);
  const after = r.after + (r.dropped_reason ? ` *(reason for the note: ${r.dropped_reason})*` : '');
  const gate = fidelityCounters(x.s, r.after);
  const advisory = CHECK ? (c ? (c.same ? 'model check: same' : `model check (advisory): ${c.changed}`) : 'model check: no answer') : '';
  if (gate.length) {
    proposed++;
    rows.push([r.shape || '', x.s, `(proposed, not applied) ${after}`, `REFUSED: ${gate.join('; ')} · ${advisory}`]);
    return;
  }
  let done = false;
  if (translated.includes(x.s)) { translated = translated.replace(x.s, r.after); done = true; }
  else {
    const re = new RegExp(x.s.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
    if (re.test(translated)) { translated = translated.replace(re, r.after); done = true; }
  }
  if (done) applied++;
  rows.push([r.shape || '', x.s, after, (done ? '' : 'NOT APPLIED (sentence not found verbatim) · ') + (r.note || '') + (advisory ? ` · ${advisory}` : '')]);
});
const table = ['| shape | before | after | note |', '|---|---|---|---|', ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const summary = `${items.length} sentences · ${flagged.length} flagged · ${applied} rewritten and applied · ${proposed} proposed only (refused by the gate) · ${kept} kept · ${unparsed} unparsed · find ${((t1 - t0) / 1000).toFixed(0)}s · rewrite ${((t2 - t1) / 1000).toFixed(0)}s · check ${((t3 - t2) / 1000).toFixed(0)}s · ${JOBS} in flight`;
const out = `# Translation of ${file}\n\n${summary}\n\n${table}\n`;
writeFileSync(`${file}.translation.md`, out);
writeFileSync(`${file}.translated.md`, translated);
console.log(out);
console.error(`# wrote ${file}.translation.md and ${file}.translated.md · ${summary}`);
process.exit(0);
