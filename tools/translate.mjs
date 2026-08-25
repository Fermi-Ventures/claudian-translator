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
import { analyzeText, analyzeParagraph } from './paragraphs.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FIND = opt('--find', 'haiku');
const REWRITE = opt('--rewrite', 'sonnet');
const JOBS = Math.max(1, +opt('--jobs', 8));
const ALL = args.includes('--all');
const CHECK = !args.includes('--no-check');
const ESTIMATE = args.includes('--estimate');
const RATE = +opt('--rate', 0.3);
// --by sentence | paragraph: the unit for the REWRITE and the TARGET CHECK.
// Paragraph mode sends one Sonnet call per paragraph with every flagged
// sentence numbered, and one check call per paragraph with every pair: the
// rules are paid once per paragraph, the rewrites see each other, and the
// CLI starts once per paragraph. The gate is per sentence in both modes.
// The FINDER stays per sentence unless --find-by paragraph is passed: batched,
// Haiku dropped from recall 0.83 to 0.67 on the labelled set and the four it
// stopped flagging were the reviewer's own send-backs, at chunks of five and
// of three alike (--calibrate-find --by paragraph [--chunk n] reproduces it).
const BY = opt('--by', 'sentence');
const FIND_BY = opt('--find-by', 'sentence');
// Phase 1, paragraph structure (--no-structure skips it): every paragraph the
// counters flag goes to Sonnet once, with the flags as evidence, and comes
// back restructured; the paragraph passes the same gate as a sentence plus
// the target check, then the sentence phases run on the restructured text.
const STRUCTURE = !args.includes('--no-structure');
// Rate: at most RPM calls started per minute across the whole run, JOBS in
// flight, retries with backoff, and a pause when a call looks rate-limited.
const RPM = Math.max(1, +opt('--rpm', 40));
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--find', '--rewrite', '--jobs', '--rate'].includes(args[i - 1])));
if (!file && !args.includes('--calibrate-check') && !args.includes('--calibrate-find')) { console.error('usage: translate.mjs <file.md> [--find m] [--rewrite m] [--jobs n] [--all] [--no-check] | <file.md> --estimate [--rate r] [--secs f,r,c] | --calibrate-check'); process.exit(2); }
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

// ---------- the target check: one narrow question a model answers reliably ----------
// A broad "does the rewrite mean the same" question scored near chance on the
// labelled pairs in two framings (4/12 · 2/6, 5/12 · 1/6) and was dropped.
// This narrow question — did WHO, WHAT or WHERE change — scored 12 of 14 on
// first calibration, catching every swap (children→adults, bathtub→near a
// bathtub, out of reach→within reach, false→true, validator→parser,
// database→cache) with two false alarms on good rewrites. A false alarm is a
// held proposal; a missed swap is the toaster in the bathtub. So it is part
// of the gate: target_changed refuses. The counters could not see any of
// these swaps; that is why the model is asked at all.
const CHECKER = [
  'Two versions of one sentence. Answer ONE narrow question and nothing else: does AFTER apply to a different WHO, WHAT, or WHERE than BEFORE? That is: a different person or group the sentence is about, a different object it acts on, a different place or condition it holds in, or a different value it names (true/false, on/off, before/after, reach/not reach).',
  'Do NOT judge style, length, tone, whether a metaphor was explained, whether a reason was moved, or whether the sentence was split. A synonym for the same thing (hit/strike, use/operate) is the SAME target. A metaphor replaced by the plain thing it stood for is the SAME target. A person named in place of an abstraction that stood for them is the SAME target.',
  'Reply with one JSON object and nothing else: {"target_changed": true|false, "what": "<the swap, e.g. children → adults, or empty>"}',
];

// ---------- fidelity counters: the gate on a rewrite ----------
// Calibrated on tests/fidelity.calibration.json (18 pairs): the rewrites that
// invented meaning carried a new obligation word, kept a "because", or ran
// past 2.5x the original's length; the reviewer-accepted rewrites did none of
// these. The model check (CHECKER below) was near chance on the same pairs in
// two framings, so it is ADVISORY: its verdict goes in the note, never the gate.
const OBWORDS = /\b(must|shall|required|never|always|only|mandatory|prohibited)\b/gi;
const REASON = /\b(because|which is why|this is why|the reason is|exists to|in order to)\b/i;
// Negation: a rewrite that changes the NUMBER of negations flips or doubles a
// meaning ("Do not operate in a bathtub" → "Operate in a bathtub"). Counted,
// not matched, so "never" → "do not" passes and a dropped "not" does not.
const NEG = /\b(not|never|no|none|nothing|neither|nor|without|unless|don't|doesn't|didn't|won't|can't|cannot|shouldn't|mustn't|isn't|aren't|wasn't|weren't)\b/gi;
// Polarity pairs: a rewrite that keeps the negation count but swaps an
// antonym flips the meaning with no negation mark ("Never return false" →
// "Do not return true"). A finite list; it catches the swaps it names and
// nothing else, which the README says.
const PAIRS = [['true', 'false'], ['always', 'never'], ['on', 'off'], ['enable', 'disable'], ['enabled', 'disabled'], ['open', 'closed'], ['allow', 'deny'], ['allowed', 'denied'], ['before', 'after'], ['above', 'below'], ['inside', 'outside'], ['include', 'exclude'], ['accept', 'reject'], ['start', 'stop'], ['more', 'less'], ['minimum', 'maximum'], ['increase', 'decrease'], ['add', 'remove'], ['connect', 'disconnect'], ['lock', 'unlock'], ['valid', 'invalid'], ['safe', 'unsafe'], ['required', 'optional'], ['permitted', 'forbidden'], ['wet', 'dry'], ['hot', 'cold'], ['up', 'down'], ['first', 'last']];
function fidelityCounters(before, after) {
  const f = [];
  const ob = s => new Set((s.match(OBWORDS) || []).map(w => w.toLowerCase()));
  const nb = ob(before), na = ob(after);
  const added = [...na].filter(w => !nb.has(w));
  if (added.length) f.push(`new obligation word: ${added.join(', ')}`);
  const negB = (before.match(NEG) || []).length, negA = (after.match(NEG) || []).length;
  if (negB !== negA) f.push(`negation count changed: ${negB} → ${negA}`);
  const words = s => new Set(s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/));
  const wb = words(before), wa = words(after);
  for (const [x, y] of PAIRS) {
    if (wb.has(x) && !wb.has(y) && wa.has(y) && !wa.has(x)) f.push(`polarity swapped: ${x} → ${y}`);
    if (wb.has(y) && !wb.has(x) && wa.has(x) && !wa.has(y)) f.push(`polarity swapped: ${y} → ${x}`);
  }
  if (REASON.test(after)) f.push('reason kept inside the rule');
  const ratio = after.split(/\s+/).length / Math.max(1, before.split(/\s+/).length);
  if (ratio > 2.5) f.push(`rewrite is ${ratio.toFixed(1)}x the original's length`);
  return f;
}

// ---------- phase 1: the paragraph restructurer's rules ----------
const STRUCTURE_RULES = [
  'You are restructuring ONE paragraph so that it reads as written by a person, keeping every claim it makes. You have the paragraph and the counts that flagged it. Change the SHAPE, not the content.',
  'Rules:',
  '1. Keep every claim, every number, every name, every obligation and every negation. Add nothing. Drop nothing except the devices named below.',
  '2. A bold or short label that opens the paragraph ("What it costs.") is a device: fold it into the first sentence or drop it.',
  '3. A short aphoristic last sentence ("The human stays last.") is a device: fold its content into the sentence before it, or drop it if the paragraph already said it.',
  '4. Sentence lengths that are all alike are a device: let one sentence run and one sentence stop short, without padding either.',
  '5. A list of exactly three that is padding (one item restates another) becomes two; a list of three real things stays three, untouched. Do not regroup a real list with "along with" or "plus" to break its rhythm; that is a worse device than the list.',
  '6. A closer that restates the paragraph ("In short, …") is dropped. A signpost that announces structure ("There are three reasons.") is dropped if the structure is visible without it.',
  '7. Do not change the order of claims unless a device forced an order. Do not change who, what or where any sentence applies to. Do not change the register. Do not make it longer.',
  '8. Never join sentences with a semicolon, a dash, or ", and" to vary length; a joined sentence is a new tell and will be flagged by the next check. Vary length by moving a clause into its own short sentence, or by letting one sentence carry two related claims in plain syntax. If the counters flagged nothing you can fix without a join, return the paragraph unchanged and say so.',
  '9. The paragraph is given exactly as it sits in its file, formatting included. Keep every mark on the words it marks: links, code spans, bold, italics, footnote references. Never add a heading, a list, a label or any new formatting; you are changing sentences, not the document\'s structure or its author\'s conventions. Return the paragraph in the same syntax it arrived in.',
  'Reply with one JSON object and nothing else: {"after": "<the restructured paragraph, same syntax>", "note": "<one sentence: which devices went and how>"}',
];
// Formatting is not content, but losing it is a change: the counts of links,
// code spans, bold and italic runs and footnote marks must match before and
// after, or the paragraph is refused.
function markupCounters(before, after) {
  const count = (s, re) => (s.match(re) || []).length;
  const marks = [['links', /\]\(/g], ['code spans', /`/g], ['bold runs', /\*\*/g], ['footnote marks', /\[\^/g], ['headings', /^#+ /gm], ['list markers', /^\s*(?:[-*•]|\d+\.)\s/gm]];
  const f = [];
  for (const [name, re] of marks) { const b = count(before, re), a = count(after, re); if (a !== b) f.push(`${name} changed: ${b} → ${a}`); }
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

// ---------- model plumbing: a rate-limited pool with retries ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const starts = []; let pausedUntil = 0; const stats = { calls: 0, retries: 0, limited: 0 };
async function take() {
  for (;;) {
    const now = Date.now();
    if (now < pausedUntil) { await sleep(pausedUntil - now); continue; }
    while (starts.length && now - starts[0] > 60_000) starts.shift();
    if (starts.length < RPM) { starts.push(now); stats.calls++; return; }
    await sleep(250);
  }
}
function askOnce(model, prompt, array) {
  return new Promise((resolve) => {
    const p = spawn('claude', ['-p', '--model', model, '--setting-sources', ''], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); resolve({ ok: false, why: 'timeout' }); }, 180_000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      clearTimeout(timer);
      const limited = /rate.?limit|429|overloaded|too many requests|capacity/i.test(err + out);
      if (code !== 0) return resolve({ ok: false, why: limited ? 'limited' : `exit ${code}`, limited });
      const m = out.match(array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
      if (!m) return resolve({ ok: false, why: 'no json' });
      try { resolve({ ok: true, value: JSON.parse(m[0]) }); } catch { resolve({ ok: false, why: 'bad json' }); }
    });
    p.stdin.end(prompt);
  });
}
async function ask(model, prompt, array = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await take();
    const r = await askOnce(model, prompt, array);
    if (r.ok) return r.value;
    if (r.limited) { stats.limited++; pausedUntil = Date.now() + 15_000 * (attempt + 1); }
    if (attempt < 2) { stats.retries++; await sleep(1500 * 2 ** attempt); }
  }
  return null;
}
// Paragraph mode: numbered sentences in, an array of objects with "n" out.
const numbered = ss => ss.map((s, i) => `${i + 1}. ${s}`).join('\n');
const byN = (arr, len) => { const m = new Array(len).fill(null); if (Array.isArray(arr)) for (const o of arr) { if (o && Number.isInteger(o.n) && o.n >= 1 && o.n <= len) m[o.n - 1] = o; } return m; };
async function findByParagraph(groups) {
  const res = await pool(groups, g => ask(FIND, [...RUBRIC.slice(0, -1),
    'You will read ONE PARAGRAPH, sentences numbered. Judge EACH sentence on its own, using the paragraph only to resolve pronouns and back-references. A sentence is not insider prose because its neighbours are.',
    'Reply with one JSON array and nothing else, one object per numbered sentence, in order: [{"n": 1, "insider": true|false, "phrase": "<the words that make it insider, or empty>", "why": "<one sentence>"}, ...]', '',
    ...(g.opening ? ['THE DOCUMENT\'S OPENING (context only):', g.opening, ''] : []),
    'THE PARAGRAPH, sentences numbered:', numbered(g.ss)].join('\n'), true));
  return res.map((r, i) => byN(r, groups[i].ss.length));
}
async function rewriteByParagraph(groups) {
  const res = await pool(groups, g => ask(REWRITE, [...RULES.slice(0, -1),
    'You will rewrite SEVERAL sentences of one paragraph, each numbered and each with the reason it was flagged. Rewrite each on its own; the rest of the paragraph is context. Reply with one JSON array and nothing else, one object per flagged sentence: [{"n": <number>, "shape": "<from the vocabulary>", "after": "<the rewrite>", "dropped_reason": "<or empty>", "keep": true|false, "note": "<one sentence>"}, ...]', '',
    'THE PARAGRAPH, sentences numbered:', numbered(g.ss), '',
    'REWRITE THESE:', g.targets.map(t => `${t.n}. flagged: ${t.why}`).join('\n')].join('\n'), true));
  return res.map((r, i) => byN(r, groups[i].ss.length));
}
async function checkByParagraph(groups) {
  const res = await pool(groups, g => ask(REWRITE, [...CHECKER.slice(0, -1),
    'You will judge SEVERAL before/after pairs from one paragraph, numbered. Reply with one JSON array and nothing else: [{"n": <number>, "target_changed": true|false, "what": "<the swap, or empty>"}, ...]', '',
    'THE PARAGRAPH:', g.ss.join(' '), '',
    'THE PAIRS:', g.pairs.map(p => `${p.n}. BEFORE: ${p.before}\n   AFTER: ${p.after}\n   DROPPED REASON: ${p.dropped || '(none)'}`).join('\n')].join('\n'), true));
  return res.map((r, i) => byN(r, groups[i].ss.length));
}
async function pool(items, fn) {
  const out = new Array(items.length); let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, worker));
  return out;
}

// ---------- --calibrate-find: the finder in paragraph mode against the labelled sentences ----------
// The per-sentence numbers live in claudian.mjs --calibrate. This groups the
// same labelled sentences into pseudo-paragraphs of five, in file order, and
// asks for one verdict per sentence, so batched and per-sentence recall and
// precision are compared on the same rows.
if (args.includes('--calibrate-find')) {
  const set = JSON.parse(readFileSync(new URL('../tests/claudian.calibration.json', import.meta.url), 'utf8'));
  const size = +opt('--chunk', 5);
  const gs = []; for (let i = 0; i < set.length; i += size) gs.push({ ss: set.slice(i, i + size).map(r => r.text), opening: '' });
  const t0 = Date.now();
  const per = await findByParagraph(gs);
  const got = gs.flatMap((g, gi) => per[gi]);
  let tp = 0, fp = 0, tn = 0, fn = 0, un = 0;
  console.log(`# translate --calibrate-find · ${FIND} · by paragraph (chunks of ${size}) · ${set.length} labelled sentences · ${gs.length} calls\n`);
  set.forEach((s, i) => { const j = got[i]; if (!j) { un++; console.log(`??     label ${s.label}  ${JSON.stringify(s.text.slice(0, 80))}`); return; } const g = j.insider ? 1 : 0; const mark = g === s.label ? 'ok' : (s.label ? 'MISS' : 'FALSE+'); if (g && s.label) tp++; else if (g && !s.label) fp++; else if (!g && !s.label) tn++; else fn++; console.log(`${mark.padEnd(6)} label ${s.label} got ${g}  ${JSON.stringify(s.text.slice(0, 80))}${j.phrase ? `  [${j.phrase}]` : ''}`); });
  console.log(`\n## result · TP ${tp} · FP ${fp} · TN ${tn} · FN ${fn} · unparsed ${un} · precision ${(tp / (tp + fp || 1)).toFixed(2)} · recall ${(tp / (tp + fn || 1)).toFixed(2)} · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  process.exit(0);
}

// ---------- --calibrate-check: the checker against labelled pairs ----------
if (args.includes('--calibrate-check')) {
  const set = JSON.parse(readFileSync(new URL('../tests/fidelity.calibration.json', import.meta.url), 'utf8'));
  // The paragraph each BEFORE sits in, from the regression text, so the checker
  // sees what the real run sees.
  const regParas = readFileSync(new URL('../tests/before.md', import.meta.url), 'utf8').replace(/\r/g, '').replace(/^#+ .*$/gm, '').split(/\n\n+/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  const paraOf = s => regParas.find(p => p.includes(s.slice(0, 40))) || '(not available)';
  const t0 = Date.now();
  // --no-check: counters only, no model calls (seconds, free).
  const res = CHECK ? await pool(set, c => ask(REWRITE, [...CHECKER, '', 'THE PARAGRAPH:', paraOf(c.before), '', 'BEFORE:', c.before, '', 'AFTER:', c.after, '', 'DROPPED REASON:', c.dropped || '(none)'].join('\n'))) : set.map(() => null);
  let tp = 0, fp = 0, tn = 0, fn = 0, ctp = 0, cfp = 0, ctn = 0, cfn = 0, gtp = 0, gfp = 0, gtn = 0, gfn = 0;
  console.log(`# translate --calibrate-check · target check: ${CHECK ? REWRITE : 'off'} · counters · gate = counters OR target check · ${set.length} labelled pairs\n`);
  set.forEach((c, i) => {
    const r = res[i]; const got = r ? !r.target_changed : null;
    const mark = got === null ? '??' : got === c.same ? 'ok' : (c.same ? 'REFUSED-GOOD' : 'PASSED-BAD');
    if (got === true && c.same) tp++; else if (got === true && !c.same) fp++; else if (got === false && !c.same) tn++; else if (got === false && c.same) fn++;
    const fc = fidelityCounters(c.before, c.after); const cgot = fc.length === 0;
    const cmark = cgot === c.same ? 'ok' : (c.same ? 'REFUSED-GOOD' : 'PASSED-BAD');
    if (cgot && c.same) ctp++; else if (cgot && !c.same) cfp++; else if (!cgot && !c.same) ctn++; else cfn++;
    const ggot = cgot && (got === null ? true : got);
    if (ggot && c.same) gtp++; else if (ggot && !c.same) gfp++; else if (!ggot && !c.same) gtn++; else gfn++;
    console.log(`target ${mark.padEnd(13)} counters ${cmark.padEnd(13)} same=${c.same}  ${JSON.stringify(c.after.slice(0, 80))}\n              target: ${r ? (r.what || '(same)') : (CHECK ? 'unparsed' : 'off')}\n              counters: ${fc.join('; ') || '(same)'}`);
  });
  if (CHECK) console.log(`\n## target check (${REWRITE}) · accepted-good ${tp} · refused-good ${fn} · refused-bad ${tn} · passed-bad ${fp}`);
  console.log(`## counters · accepted-good ${ctp} · refused-good ${cfn} · refused-bad ${ctn} · passed-bad ${cfp}`);
  console.log(`## gate (either refuses) · accepted-good ${gtp} · refused-good ${gfn} · refused-bad ${gtn} · passed-bad ${gfp} · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  process.exit(0);
}

// ---------- phase 0: paragraph breaks only ----------
// Uniform paragraph length is a document-level tell that no per-paragraph
// call can fix. One Sonnet call per document may move paragraph breaks —
// merge two short neighbours, split one long paragraph at a sentence — and
// nothing else. The gate is exact: the sequence of words after must equal
// the sequence before. A model cannot invent inside that gate.
const original = readFileSync(file, 'utf8');
let working = original;
const paraRows = [];
const tS0 = Date.now();
let rebreak = null;
if (STRUCTURE && !ESTIMATE) {
  const { doc } = analyzeText(original);
  if (doc.paragraphs >= 4 && doc.paragraph_length_cv !== null && doc.paragraph_length_cv < 0.35) {
    const bodyParas = original.replace(/\r/g, '').split(/\n\n+/);
    const prose = bodyParas.map((p, i) => ({ i, p })).filter(x => !/^\s*(#|\||```|-|\*|\d+\.|>)/.test(x.p) && x.p.split(/\s+/).length >= 12);
    const wordsOf = s => s.replace(/[*_`]/g, '').split(/\s+/).filter(Boolean).join(' ');
    const before = prose.map(x => x.p).join('\n\n');
    const r = await ask(REWRITE, [
      'The paragraphs below are all about the same length, which reads as generated prose. Move paragraph breaks and nothing else: merge two short neighbouring paragraphs when they continue one thought, split a long paragraph at a sentence boundary when it changes subject. Aim for paragraphs of clearly different lengths.',
      'You may not change, add, remove or reorder a single word. Only the blank lines between paragraphs may change. Reply with one JSON object and nothing else: {"text": "<the same text with paragraph breaks moved, paragraphs separated by a blank line>", "note": "<what you merged or split>"}', '',
      'THE TEXT:', before].join('\n'));
    if (r && typeof r.text === 'string' && wordsOf(r.text) === wordsOf(before)) {
      const newParas = r.text.replace(/\r/g, '').split(/\n\n+/).map(s => s.trim()).filter(Boolean);
      const cvBefore = doc.paragraph_length_cv, cvAfter = analyzeText(newParas.join('\n\n')).doc.paragraph_length_cv;
      if (cvAfter !== null && cvAfter > cvBefore) {
        // Splice: replace the run of prose paragraphs, in place, keeping headings and tables where they were.
        const out = []; let k = 0;
        bodyParas.forEach((p, i) => { const isProse = prose.some(x => x.i === i); if (!isProse) out.push(p); else if (k === 0) { out.push(...newParas); k = 1; } });
        working = out.join('\n\n');
        rebreak = { cvBefore, cvAfter, before: prose.length, after: newParas.length, note: r.note || '' };
      } else rebreak = { refused: `paragraph-length cv did not rise (${cvBefore.toFixed(2)} → ${cvAfter === null ? '-' : cvAfter.toFixed(2)})` };
    } else rebreak = { refused: r && r.text ? 'the words changed; only breaks may move' : 'no answer' };
    console.error(`# rebreak · ${rebreak.refused ? 'REFUSED: ' + rebreak.refused : `${rebreak.before} → ${rebreak.after} paragraphs · cv ${rebreak.cvBefore.toFixed(2)} → ${rebreak.cvAfter.toFixed(2)}`}`);
  }
}

// ---------- phase 1: paragraph structure ----------
if (STRUCTURE && !ESTIMATE) {
  const { rows } = analyzeText(working);
  const flaggedParas = rows.filter(r => r.flags.length && r.sentences >= 2);
  console.error(`# structure · ${rows.length} paragraphs · ${flaggedParas.length} flagged by the counters`);
  const outs = await pool(flaggedParas, r => ask(REWRITE, [...STRUCTURE_RULES, '', 'WHAT THE COUNTERS FOUND:', r.flags.join('; '), '', 'THE PARAGRAPH, exactly as it sits in the file:', r.raw].join('\n')));
  const checks = await pool(flaggedParas, (r, i) => (outs[i] && outs[i].after) ? ask(REWRITE, [...CHECKER, '', 'BEFORE:', r.plain, '', 'AFTER:', outs[i].after, '', 'DROPPED REASON:', '(none)'].join('\n')) : null);
  flaggedParas.forEach((r, i) => {
    const o = outs[i];
    if (!o || !o.after) { paraRows.push([r.i, r.flags.join('; '), r.plain, '', 'no answer from the model', r.raw]); return; }
    // A lead-in label is itself a bold run; dropping it is the fix, so it is
    // taken off the "before" before the marks are counted.
    const rawForMarks = r.flags.includes('LEADIN') ? r.raw.replace(/^\s*\*\*[^*\n]{2,40}\.\*\*\s*/, '') : r.raw;
    const gate = [...fidelityCounters(r.plain, o.after.replace(/[*_`>]/g, '')), ...markupCounters(rawForMarks, o.after)];
    const ratio = o.after.split(/\s+/).length / Math.max(1, r.words);
    if (ratio > 1.25) gate.push(`longer than the original (${ratio.toFixed(2)}x)`);
    if (ratio < 0.6) gate.push(`much shorter than the original (${ratio.toFixed(2)}x)`);
    const c = checks[i];
    if (!c) gate.push('target check returned nothing'); else if (c.target_changed) gate.push(`target changed: ${c.what || 'unnamed'}`);
    const after = analyzeParagraph(o.after);
    if (gate.length) { paraRows.push([r.i, r.flags.join('; '), r.plain, `(proposed, not applied) ${o.after}`, `REFUSED: ${gate.join('; ')}`, r.raw]); return; }
    // Replace the paragraph in the working text: exact, then whitespace-tolerant on the plain text.
    let done = false;
    if (working.includes(r.raw)) { working = working.replace(r.raw, o.after); done = true; }
    else { const re = new RegExp(r.plain.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')); if (re.test(working)) { working = working.replace(re, o.after); done = true; } }
    paraRows.push([r.i, r.flags.join('; '), r.plain, o.after, (done ? '' : 'NOT APPLIED (paragraph not found verbatim) · ') + (o.note || '') + (after.flags.length ? ` · still flagged: ${after.flags.map(f => f.split(' ')[0]).join(', ')}` : ' · counters clean'), r.raw]);
  });
  console.error(`# structure · ${paraRows.filter(r => !/^\(proposed|^$/.test(r[3]) && r[3]).length} applied · ${paraRows.filter(r => /^\(proposed/.test(r[3])).length} refused · ${((Date.now() - tS0) / 1000).toFixed(0)}s`);
}

// ---------- split (identical to claudian.mjs), on the restructured text ----------
const raw = working.replace(/\r/g, '').replace(/^#+ .*$/gm, '').replace(/[*_`>]/g, '');
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
  const flush = () => { if (run.length >= 3) out.push({ s: run.join(' '), para: ctx, pi, staccato: run.length }); else run.forEach(s => out.push({ s, para: ctx, pi })); run = []; };
  for (const s of ss) { if (s.split(/\s+/).length <= 5) run.push(s); else { flush(); out.push({ s, para: ctx, pi }); } }
  flush();
  return out;
}).filter(x => x.s.split(/\s+/).length >= 3);

// ---------- --estimate: no model calls ----------
const tok = s => Math.ceil(s.length / 4);
if (ESTIMATE) {
  const rubric = tok(RUBRIC.join('\n')), rules = tok(RULES.join('\n')), checker = tok(CHECKER.join('\n'));
  const nParas = new Set(items.map(x => x.pi)).size;
  const n = Math.round(items.length * RATE);
  const avgPara = items.reduce((a, x) => a + tok(x.para), 0) / (items.length || 1), avgS = items.reduce((a, x) => a + tok(x.s), 0) / (items.length || 1);
  const byPara = BY === 'paragraph', findPara = FIND_BY === 'paragraph';
  // Paragraph mode: the rubric once per paragraph, the paragraph once; one
  // rewrite call and one check call per paragraph that has a flagged sentence.
  const findCalls = findPara ? nParas : items.length;
  const findIn = findPara ? Math.round(nParas * (rubric + 60) + items.reduce((a, x) => a + tok(x.s), 0) + (opening ? nParas * tok(opening) : 0)) : items.reduce((a, x) => a + rubric + tok(x.para) + tok(x.s) + 40, 0);
  const findOut = items.length * 60;
  const rwCalls = byPara ? Math.min(n, nParas) : n, ckCalls = rwCalls;
  const rwIn = byPara ? Math.round(rwCalls * (rules + avgPara + 80) + n * (avgS + 30)) : Math.round(n * (rules + avgPara + avgS + 80)), rwOut = n * 200;
  const ckIn = byPara ? Math.round(ckCalls * (checker + avgPara + 40) + n * 2 * avgS) : Math.round(n * (checker + 3 * avgS + 40)), ckOut = n * 60;
  const price = (m, i, o) => ((PRICES[m] || PRICES.sonnet).in * i + (PRICES[m] || PRICES.sonnet).out * o) / 1e6;
  const find$ = ALL ? 0 : price(FIND, findIn, findOut), rw$ = price(REWRITE, rwIn, rwOut), ck$ = CHECK ? price(REWRITE, ckIn, ckOut) : 0;
  const sRows = STRUCTURE ? analyzeText(original).rows.filter(r => r.flags.length && r.sentences >= 2) : [];
  const sIn = sRows.reduce((a, r) => a + tok(STRUCTURE_RULES.join('\n')) + 2 * tok(r.plain) + checker + 60, 0), sOut = sRows.reduce((a, r) => a + tok(r.plain) + 80, 0);
  const s$ = price(REWRITE, sIn, sOut);
  if (STRUCTURE) console.log(`| structure (phase 1) | ${REWRITE} | ${2 * sRows.length} | ${sIn} | ${sOut} | $${s$.toFixed(3)} | — | — |`);
  // Seconds a call, find/rewrite/check. CLI start-up dominates and varies by
  // machine and hour (we have measured 2 s and 30 s for the same call on
  // different days). Pass --secs f,r,c from a real run.
  const [SF, SR, SC] = opt('--secs', '5,10,6').split(',').map(Number);
  const secs = (calls, per) => Math.ceil(calls * per / JOBS);
  console.log(`# estimate · ${file} · ${items.length} sentences · assumed flag rate ${RATE} → ${n} rewrites · prices per Mtok: ${FIND} $${PRICES[FIND]?.in}/$${PRICES[FIND]?.out}, ${REWRITE} $${PRICES[REWRITE]?.in}/$${PRICES[REWRITE]?.out}\n`);
  console.log('| step | model | calls | tokens in | tokens out | dollars | wall, 1 at a time | wall, ' + JOBS + ' at a time |');
  console.log('|---|---|---|---|---|---|---|---|');
  if (!ALL) console.log(`| find | ${FIND} | ${findCalls} | ${findIn} | ${findOut} | $${find$.toFixed(3)} | ${secs(findCalls, SF) * JOBS}s | ${secs(findCalls, SF)}s |`);
  console.log(`| rewrite | ${REWRITE} | ${rwCalls} | ${rwIn} | ${rwOut} | $${rw$.toFixed(3)} | ${secs(rwCalls, SR) * JOBS}s | ${secs(rwCalls, SR)}s |`);
  if (CHECK) console.log(`| check | ${REWRITE} | ${ckCalls} | ${ckIn} | ${ckOut} | $${ck$.toFixed(3)} | ${secs(ckCalls, SC) * JOBS}s | ${secs(ckCalls, SC)}s |`);
  console.log(`| **total** | | ${(ALL ? 0 : findCalls) + rwCalls + (CHECK ? ckCalls : 0) + 2 * sRows.length} | ${(ALL ? 0 : findIn) + rwIn + (CHECK ? ckIn : 0) + sIn} | ${(ALL ? 0 : findOut) + rwOut + (CHECK ? ckOut : 0) + sOut} | **$${(find$ + rw$ + ck$ + s$).toFixed(2)}** | | |`);
  console.log(`\nAssumptions: 4 characters a token; 60 output tokens a finder call, 200 a rewrite, 60 a check; ${SF}, ${SR} and ${SC} seconds a call (pass --secs f,r,c from a measured run; CLI start-up varies by machine and hour). The flag rate is the one number you must supply: 0.1 for ordinary prose, 0.3 for a first draft, 0.7 for text a reviewer has already sent back. Measure it once with a real run and pass --rate.`);
  process.exit(0);
}

// ---------- stage 1: find ----------
const t0 = Date.now();
console.error(`# translate · ${file} · ${items.length} sentences · find ${ALL ? 'all' : FIND} by ${FIND_BY} · rewrite ${REWRITE} by ${BY} · check ${CHECK ? REWRITE : 'off'} · ${JOBS} in flight`);
// Paragraph groups: items in file order, grouped by paragraph index.
const groups = [];
items.forEach((x, i) => { let g = groups[groups.length - 1]; if (!g || g.pi !== x.pi) { g = { pi: x.pi, idx: [], ss: [], opening: x.pi === 0 ? '' : opening }; groups.push(g); } g.idx.push(i); g.ss.push(x.s); });
const whyOf = x => [x.find && x.find.insider ? `insider prose${x.find.phrase ? ` [${x.find.phrase}]` : ''}: ${x.find.why}` : '', ...x.form].filter(Boolean).join('; ');

let found;
if (ALL) found = items.map(() => ({ insider: true, phrase: '', why: '--all' }));
else if (FIND_BY === 'paragraph') { found = new Array(items.length).fill(null); const per = await findByParagraph(groups); groups.forEach((g, gi) => g.idx.forEach((i, k) => { found[i] = per[gi][k]; })); }
else found = await pool(items, x => ask(FIND, [...RUBRIC, '', 'THE PARAGRAPH IT SITS IN (context only — judge the sentence, and use this to resolve pronouns and back-references):', x.para, '', 'THE SENTENCE:', x.s].join('\n')));
const t1 = Date.now();
const flagged = items.map((x, i) => ({ ...x, i, find: found[i], form: counters(x.s, x) })).filter(x => (x.find && x.find.insider) || x.form.length);
console.error(`# found ${flagged.length} of ${items.length} · ${((t1 - t0) / 1000).toFixed(0)}s`);

// ---------- stage 2: rewrite ----------
let rewritten;
if (BY === 'paragraph') {
  const rg = groups.map(g => ({ ...g, targets: g.idx.map((i, k) => { const f = flagged.find(x => x.i === i); return f ? { n: k + 1, why: whyOf(f) } : null; }).filter(Boolean) })).filter(g => g.targets.length);
  const per = await rewriteByParagraph(rg);
  const byItem = new Map(); rg.forEach((g, gi) => g.idx.forEach((i, k) => { if (per[gi][k]) byItem.set(i, per[gi][k]); }));
  rewritten = flagged.map(x => byItem.get(x.i) || null);
} else {
  rewritten = await pool(flagged, x => ask(REWRITE, [...RULES, '', 'WHY IT WAS FLAGGED:', whyOf(x), '', 'THE PARAGRAPH IT SITS IN:', x.para, '', 'THE SENTENCE:', x.s].join('\n')));
}
const t2 = Date.now();

// ---------- stage 3: check ----------
const toCheck = flagged.map((x, k) => ({ x, r: rewritten[k], k })).filter(c => CHECK && c.r && !c.r.keep && c.r.after);
let checkOf;
if (BY === 'paragraph') {
  const cg = groups.map(g => ({ ...g, pairs: g.idx.map((i, k) => { const c = toCheck.find(c => c.x.i === i); return c ? { n: k + 1, before: c.x.s, after: c.r.after, dropped: c.r.dropped_reason, k: c.k } : null; }).filter(Boolean) })).filter(g => g.pairs.length);
  const per = await checkByParagraph(cg);
  checkOf = new Map(); cg.forEach((g, gi) => g.pairs.forEach(p => { checkOf.set(p.k, per[gi][p.n - 1]); }));
} else {
  const checks = await pool(toCheck, c => ask(REWRITE, [...CHECKER, '', 'THE PARAGRAPH:', c.x.para, '', 'BEFORE:', c.x.s, '', 'AFTER:', c.r.after, '', 'DROPPED REASON:', c.r.dropped_reason || '(none)'].join('\n')));
  checkOf = new Map(toCheck.map((c, j) => [c.k, checks[j]]));
}
const t3 = Date.now();

// ---------- outputs ----------
const esc = s => String(s || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const rows = []; let translated = working; let applied = 0, kept = 0, proposed = 0, unparsed = 0;
flagged.forEach((x, k) => {
  const r = rewritten[k];
  if (!r) { unparsed++; rows.push(['(unparsed)', x.s, '', 'the rewriter returned nothing; run again']); return; }
  if (r.keep || !r.after) { kept++; rows.push([r.shape || 'kept', x.s, '(kept)', r.note || '']); return; }
  const c = checkOf.get(k);
  const after = r.after + (r.dropped_reason ? ` *(reason for the note: ${r.dropped_reason})*` : '');
  const gate = fidelityCounters(x.s, r.after);
  if (CHECK) { if (!c) gate.push('target check returned nothing'); else if (c.target_changed) gate.push(`target changed: ${c.what || 'unnamed'}`); }
  const advisory = CHECK && c && !c.target_changed ? 'target check: same' : '';
  if (gate.length) {
    proposed++;
    rows.push([r.shape || '', x.s, `(proposed, not applied) ${after}`, `REFUSED: ${gate.join('; ')}`]);
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
const rebreakNote = rebreak ? `\n## Paragraph breaks (phase 0)\n\n${rebreak.refused ? `Refused: ${rebreak.refused}.` : `${rebreak.before} paragraphs became ${rebreak.after}; paragraph-length cv ${rebreak.cvBefore.toFixed(2)} → ${rebreak.cvAfter.toFixed(2)}. Words unchanged (checked). ${rebreak.note}`}\n` : '';
const paraTable = paraRows.length ? ['\n## Paragraphs (phase 1: structure)\n', '| ¶ | counters | before | after | note |', '|---|---|---|---|---|', ...paraRows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n' : '';
const pApplied = paraRows.filter(r => r[3] && !/^\(proposed/.test(r[3])).length, pRefused = paraRows.filter(r => /^\(proposed/.test(r[3])).length;
const summary = `${STRUCTURE ? `paragraphs: ${paraRows.length} flagged · ${pApplied} restructured · ${pRefused} refused · ${((t0 - tS0) / 1000).toFixed(0)}s — then ` : ''}${items.length} sentences · ${flagged.length} flagged · ${applied} rewritten and applied · ${proposed} proposed only (refused by the gate) · ${kept} kept · ${unparsed} unparsed · find ${((t1 - t0) / 1000).toFixed(0)}s · rewrite ${((t2 - t1) / 1000).toFixed(0)}s · check ${((t3 - t2) / 1000).toFixed(0)}s · ${JOBS} in flight · ${stats.calls} calls, ${stats.retries} retries, ${stats.limited} rate-limited · cap ${RPM}/min`;
const out = `# Translation of ${file}\n\n${summary}\n${rebreakNote}\n## Sentences (phase 2)\n\n${table}\n${paraTable}`;
writeFileSync(`${file}.translation.md`, out);
writeFileSync(`${file}.translated.md`, translated);
// Machine-readable pairs, so a session can patch them into whatever container
// the text came out of (Word, HTML, JSX, a resource file) without parsing the
// table. "before" is the text exactly as it sat in the file (marks included,
// for a verbatim match); "after" is null for kept and refused rows; "status"
// says which; "diff" is a word-level diff in [-old-]{+new+} notation, so the
// patching session knows which words kept their place (carry their marks
// over) and which are new (a mark there is a decision).
function wdiff(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0, del = [], ins = [];
  const flush = () => { if (del.length) out.push(`[-${del.join(' ')}-]`); if (ins.length) out.push(`{+${ins.join(' ')}+}`); del = []; ins = []; };
  while (i < n && j < m) { if (A[i] === B[j]) { flush(); out.push(A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) del.push(A[i++]); else ins.push(B[j++]); }
  while (i < n) del.push(A[i++]); while (j < m) ins.push(B[j++]); flush();
  return out.join(' ');
}
const pairs = [
  ...paraRows.map(r => { const after = !r[3] || /^\(proposed/.test(r[3]) ? null : r[3]; return { level: 'paragraph', status: !r[3] ? 'unanswered' : after === null ? 'refused' : 'applied', before: r[5] || r[2], before_plain: r[2], after, diff: after === null ? null : wdiff(r[5] || r[2], after), note: r[4] }; }),
  ...rows.map(r => { const after = r[2] === '(kept)' || /^\(proposed/.test(r[2]) || r[2] === '' ? null : r[2].replace(/ \*\(reason for the note: .*\)\*$/, ''); return { level: 'sentence', shape: r[0], status: r[2] === '(kept)' ? 'kept' : /^\(proposed/.test(r[2]) ? 'refused' : r[2] === '' ? 'unanswered' : 'applied', before: r[1], after, diff: after === null ? null : wdiff(r[1], after), note: r[3] }; }),
];
writeFileSync(`${file}.translation.json`, JSON.stringify({ file, summary, rebreak, pairs }, null, 1));
console.log(out);
console.error(`# wrote ${file}.translation.md and ${file}.translated.md · ${summary}`);
process.exit(0);
