// paragraphs.mjs — paragraph hygiene: the tells of AI-shaped prose that no
// sentence check can see, all countable, no model.
//   node tools/paragraphs.mjs <file.md> [--json]
// Also a module: import { analyzeText } from './paragraphs.mjs'.
// What it counts (sources: Wikipedia "Signs of AI writing"; the Economist's
// 2026 stylometry; the burstiness metric every detector uses; and two from
// reading our own drafts, KICKER and LEADIN):
//   UNIFORM    sentence lengths in the paragraph vary little (coefficient of
//              variation under 0.35): the flat rhythm of generated prose
//   TRIAD      a list of exactly three ("X, Y, and Z"); counted per paragraph
//   CLOSER     the last sentence wraps the paragraph up ("In short", "Overall",
//              "That is why", "So …", "The result is …")
//   SIGNPOST   an opener that announces structure ("First,", "Two things.",
//              "There are three …", "Here is what …")
//   PIVOT      negative parallelism ("not X but Y", "not just X, Y")
//   HEDGE-TAIL a paragraph that ends on a qualification ("…, though")
//   KICKER     a short aphoristic last sentence after longer ones
//   LEADIN     a bold-label opener ("What it costs.") starting the paragraph
// Document level: paragraph lengths that vary little (UNIFORM-DOC), closers or
// kickers on most paragraphs, lead-ins on three or more, triads per hundred
// words, signposts. Thresholds from tests/paragraphs.calibration.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const split = p => p.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/).map(s => s.trim()).filter(Boolean);
const words = s => s.split(/\s+/).filter(Boolean).length;
const cv = xs => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length; return Math.sqrt(v) / m; };

const TRIAD = /\b[^,.;:]{2,40}, [^,.;:]{2,40},? (?:and|or) [^,.;:]{2,40}[.;:]?/g;
const TRIAD_STRICT = /(^|[.;:] )[^,.;:]{2,60}, [^,.;:]{2,60},? (?:and|or) [^,.;:]{2,60}[.!?]$/;
const CLOSER = /^(?:in short|in sum|in summary|in other words|in the end|overall|ultimately|all in all|that is why|that is what|that is the|this is why|this is what|the result is|the point is|the upshot|so,? |so the |so that is|put simply|simply put|the lesson|the takeaway|what this means|which is why|hence|thus|therefore)\b/i;
const SIGNPOST = /^(?:first(?:ly)?,|second(?:ly)?,|third(?:ly)?,|finally,|two things|three things|there are (?:two|three|four|several)|here(?:'s| is) (?:what|how|why|the)|the (?:first|second|third) (?:is|thing|reason)|let(?:'s| us) )/i;
const PIVOT = /\bnot (?:just |only |simply |merely )?[^,.;]{1,50}(?:, but| but rather| but| — |, [^,.;]{1,50}\.)/i;
const HEDGE_TAIL = /,\s*(?:though|however|at least for now|but not always|for now|in most cases|mostly|to a point|up to a point|more or less)\.?$/i;

// Paragraphs of the body text: code fences, tables, headings and front matter
// dropped; list items are paragraphs of their own; fewer than 12 words is
// not a paragraph. Each carries its raw text so a caller can replace it.
export function paragraphsOf(raw) {
  const text = raw.replace(/\r/g, '');
  const noCode = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '');
  const chunks = noCode.split(/\n\n+/).flatMap(p => p.split(/\n(?=\s*(?:[-*•]|\d+\.)\s)/));
  return chunks.map(rawPara => {
    const plain = rawPara.replace(/^\|.*$/gm, '').replace(/^#+ .*$/gm, '').replace(/[*_`>]/g, '').replace(/^\s*(?:[-*•]|\d+\.)\s+/, '').replace(/\n/g, ' ').trim();
    return { raw: rawPara.trim(), plain };
  }).filter(p => p.plain && words(p.plain) >= 12 && !/^\|/.test(p.raw.trim()));
}

export function analyzeParagraph(plain, raw = plain) {
  const ss = split(plain); const lens = ss.map(words); const c = cv(lens);
  const flags = [];
  if (ss.length >= 3 && c !== null && c < 0.35) flags.push(`UNIFORM (cv ${c.toFixed(2)}, lengths ${lens.join('/')})`);
  const triads = ss.filter(s => TRIAD_STRICT.test(s) || (s.match(TRIAD) || []).length).length;
  if (triads) flags.push(`TRIAD x${triads}`);
  if (ss.length >= 2 && CLOSER.test(ss[ss.length - 1])) flags.push(`CLOSER "${ss[ss.length - 1].slice(0, 40)}…"`);
  if (SIGNPOST.test(ss[0])) flags.push(`SIGNPOST "${ss[0].slice(0, 40)}…"`);
  const pivots = ss.filter(s => PIVOT.test(s)).length;
  if (pivots) flags.push(`PIVOT x${pivots}`);
  if (HEDGE_TAIL.test(ss[ss.length - 1])) flags.push('HEDGE-TAIL');
  const last = ss[ss.length - 1];
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  if (ss.length >= 3 && words(last) <= 8 && mean >= 14) flags.push(`KICKER "${last}"`);
  // A list item that opens with a bold phrase is a labelled step, not a
  // lead-in; the tell is the label on a running paragraph.
  const isListItem = /^\s*(?:[-*•]|\d+\.)\s/.test(raw);
  if (!isListItem && (/^\s*\*\*[^*\n]{2,40}\.\*\*\s/.test(raw) || (/^[A-Z][^.!?]{2,40}\.\s+[A-Z]/.test(plain) && words(plain.split(/[.!?]\s/)[0]) <= 6))) flags.push('LEADIN');
  return { sentences: ss.length, words: words(plain), cv: c, flags };
}

export function analyzeText(raw) {
  const paras = paragraphsOf(raw);
  const rows = paras.map((p, i) => ({ i: i + 1, raw: p.raw, plain: p.plain, head: split(p.plain)[0].slice(0, 70), ...analyzeParagraph(p.plain, p.raw) }));
  const pw = rows.map(r => r.words);
  const has = (r, k) => r.flags.some(f => f.startsWith(k));
  const doc = {
    paragraphs: rows.length, words: pw.reduce((a, b) => a + b, 0), paragraph_length_cv: cv(pw),
    closers: rows.filter(r => has(r, 'CLOSER')).length,
    triads_per_100_words: +(rows.reduce((a, r) => a + (r.flags.find(f => f.startsWith('TRIAD')) ? +r.flags.find(f => f.startsWith('TRIAD')).slice(7) : 0), 0) * 100 / Math.max(1, pw.reduce((a, b) => a + b, 0))).toFixed(2),
    signposts: rows.filter(r => has(r, 'SIGNPOST')).length, uniform: rows.filter(r => has(r, 'UNIFORM')).length,
    pivots: rows.filter(r => has(r, 'PIVOT')).length, kickers: rows.filter(r => has(r, 'KICKER')).length, leadins: rows.filter(r => has(r, 'LEADIN')).length,
  };
  const docFlags = [];
  if (doc.paragraphs >= 4 && doc.paragraph_length_cv !== null && doc.paragraph_length_cv < 0.35) docFlags.push(`UNIFORM-DOC (paragraph lengths cv ${doc.paragraph_length_cv.toFixed(2)})`);
  if (doc.paragraphs >= 3 && doc.closers / doc.paragraphs >= 0.5) docFlags.push(`CLOSERS on ${doc.closers} of ${doc.paragraphs} paragraphs`);
  if (doc.triads_per_100_words >= 1) docFlags.push(`TRIADS ${doc.triads_per_100_words} per 100 words`);
  if (doc.paragraphs >= 3 && doc.uniform / doc.paragraphs >= 0.5) docFlags.push(`UNIFORM rhythm in ${doc.uniform} of ${doc.paragraphs} paragraphs`);
  if (doc.signposts >= 2) docFlags.push(`SIGNPOSTS ${doc.signposts}`);
  if (doc.paragraphs >= 3 && doc.kickers / doc.paragraphs >= 0.4) docFlags.push(`KICKERS on ${doc.kickers} of ${doc.paragraphs} paragraphs`);
  if (doc.leadins >= 3) docFlags.push(`LEADINS on ${doc.leadins} paragraphs`);
  return { rows, doc, docFlags };
}

// ---------- CLI ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m, d) => d.toUpperCase() + ':') || (process.argv[1] && process.argv[1].endsWith('paragraphs.mjs'))) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: paragraphs.mjs <file.md> [--json]'); process.exit(2); }
  const { rows, doc, docFlags } = analyzeText(readFileSync(file, 'utf8'));
  if (args.includes('--json')) { console.log(JSON.stringify({ file, doc, docFlags, rows: rows.map(({ raw, plain, ...r }) => r) }, null, 1)); process.exit(0); }
  console.log(`# paragraphs · ${file} · ${doc.paragraphs} paragraphs · ${doc.words} words · paragraph-length cv ${doc.paragraph_length_cv === null ? '-' : doc.paragraph_length_cv.toFixed(2)} · closers ${doc.closers} · triads/100w ${doc.triads_per_100_words} · signposts ${doc.signposts} · uniform ${doc.uniform} · pivots ${doc.pivots} · kickers ${doc.kickers} · leadins ${doc.leadins}`);
  console.log(docFlags.length ? `## document: ${docFlags.join(' · ')}` : '## document: no document-level flag');
  for (const r of rows) if (r.flags.length) console.log(`\n## ¶${r.i} (${r.sentences} sentences, ${r.words} words) [${r.flags.join(' · ')}]\n    ${r.head}…`);
  console.log(`\n## result: ${rows.filter(r => r.flags.length).length} of ${rows.length} paragraphs flagged — REWRITE OR DEFEND`);
}
