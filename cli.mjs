#!/usr/bin/env node
// cli.mjs — one command for everything, so "install" is one word.
//   node cli.mjs install [--into <project>] [--download]   fetch Vale if missing, sync packs, check the model CLI, register the skill
//   node cli.mjs doctor                                     report what is installed and what is not
//   node cli.mjs lint <file.md>                             Vale with this repo's config
//   node cli.mjs translate <file.md> [translate.mjs flags]  find → rewrite → gate → apply
//   node cli.mjs estimate <file.md> [--rate r]              no model calls: sentences, tokens, dollars, minutes
//   node cli.mjs paragraphs <file.md>                       paragraph hygiene: uniform rhythm, lead-in labels, kickers, triads, closers (free)
//   node cli.mjs calibrate [--check]                        the finder's or the gate's confusion matrix
// Also reachable as `npx github:Fermi-Ventures/claudian-translator <command>` for anyone with git access to the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BIN = join(ROOT, '.bin');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes(k);
const log = (...a) => console.log(...a);
const run = (exe, a, o = {}) => spawnSync(exe, a, { encoding: 'utf8', stdio: 'pipe', shell: false, ...o });

// ---------- Vale: find it, or fetch the release binary for this platform ----------
function valePath() {
  const local = join(BIN, process.platform === 'win32' ? 'vale.exe' : 'vale');
  if (existsSync(local)) return local;
  const r = run(process.platform === 'win32' ? 'where' : 'which', ['vale']);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  return null;
}
function valeVersion(p) { const r = run(p, ['--version']); return r.status === 0 ? r.stdout.trim() : null; }
async function fetchVale() {
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];
  const arch = { x64: '64-bit', arm64: 'arm64' }[process.arch];
  if (!os || !arch) throw new Error(`no Vale release for ${process.platform}/${process.arch}; install Vale by hand from https://github.com/vale-cli/vale/releases`);
  const rel = await (await fetch('https://api.github.com/repos/vale-cli/vale/releases/latest', { headers: { 'user-agent': 'claudian-translator' } })).json();
  const ext = os === 'Windows' ? '.zip' : '.tar.gz';
  const asset = (rel.assets || []).find(a => a.name.endsWith(`_${os}_${arch}${ext}`));
  if (!asset) throw new Error(`no asset for ${os} ${arch} in ${rel.tag_name}`);
  log(`  downloading ${asset.name} (${rel.tag_name})`);
  const buf = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer());
  mkdirSync(BIN, { recursive: true });
  // The archive goes into .bin/ and tar runs there with a relative name: on
  // Windows, bsdtar reads an absolute "C:\..." path as a remote host.
  const archive = join(BIN, asset.name);
  writeFileSync(archive, buf);
  // bsdtar reads both .tar.gz and .zip; it is the system tar on Windows 10+,
  // macOS and most Linux. On Windows the PATH may find GNU tar (Git Bash)
  // first, which cannot read zip, so the system binary is named outright and
  // PowerShell's Expand-Archive is the fallback.
  const sysTar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  let x = run(existsSync(sysTar) ? sysTar : 'tar', ['-xf', asset.name], { cwd: BIN });
  if (x.status !== 0 && process.platform === 'win32') x = run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${BIN}' -Force`]);
  rmSync(archive, { force: true });
  if (x.status !== 0) throw new Error(`extract failed: ${x.stderr}`);
  const p = join(BIN, os === 'Windows' ? 'vale.exe' : 'vale');
  if (!existsSync(p)) throw new Error(`extracted, but ${p} is missing`);
  if (os !== 'Windows') chmodSync(p, 0o755);
  return p;
}
function valeSync(p) {
  const r = run(p, ['sync'], { cwd: join(ROOT, 'vale') });
  return r.status === 0;
}
function packsPresent() {
  const d = join(ROOT, 'vale', 'styles');
  return ['Microsoft', 'write-good', 'proselint', 'Readability'].every(s => existsSync(join(d, s)));
}

// ---------- the model CLI ----------
function claudeAnswers() {
  const r = spawnSync('claude', ['-p', '--model', 'haiku', '--setting-sources', ''], { input: 'Reply with exactly the word ok and nothing else.', encoding: 'utf8', timeout: 90_000, cwd: tmpdir() });
  return r.status === 0 && /\bok\b/i.test(r.stdout || '');
}

// ---------- the skill ----------
function registerSkill(project) {
  const src = join(ROOT, 'skills', 'no-claudian');
  const dst = join(project, '.claude', 'skills', 'no-claudian');
  mkdirSync(dst, { recursive: true });
  const body = readFileSync(join(src, 'SKILL.md'), 'utf8').split('${CLAUDE_PLUGIN_ROOT}').join(ROOT.replace(/\\/g, '/'));
  writeFileSync(join(dst, 'SKILL.md'), body);
  return dst;
}

// ---------- commands ----------
async function install() {
  log('# claudian-translator install');
  let vale = has('--download') ? null : valePath();
  if (vale) log(`  Vale: ${vale} (${valeVersion(vale)})`);
  else { vale = await fetchVale(); log(`  Vale: ${vale} (${valeVersion(vale)})`); }
  if (packsPresent() && !has('--download')) log('  packs: present');
  else log(`  packs: ${valeSync(vale) ? 'synced' : 'SYNC FAILED — run `vale sync` inside vale/ and read the error'}`);
  log(`  model CLI: ${claudeAnswers() ? 'claude -p answers' : 'claude -p did NOT answer — install Claude Code, or change the spawn line in tools/translate.mjs'}`);
  const into = opt('--into', null) || (existsSync(join(process.cwd(), '.claude')) && resolve(process.cwd()) !== resolve(ROOT) ? process.cwd() : null);
  if (into) log(`  skill: ${registerSkill(into)}`);
  else log('  skill: not registered (run with --into <project>, or install as a plugin: /plugin marketplace add Fermi-Ventures/claudian-translator)');
  const est = run(process.execPath, [join(ROOT, 'tools', 'translate.mjs'), join(ROOT, 'README.md'), '--estimate']);
  log(`  smoke: ${est.status === 0 ? 'estimate ran on README.md' : 'estimate FAILED'}`);
  log('# done. Try: node cli.mjs translate <file.md>');
}
function doctor() {
  const vale = valePath();
  log(`Vale:      ${vale ? `${vale} (${valeVersion(vale)})` : 'missing — node cli.mjs install'}`);
  log(`packs:     ${packsPresent() ? 'present' : 'missing — node cli.mjs install'}`);
  log(`model CLI: ${claudeAnswers() ? 'claude -p answers' : 'no answer'}`);
  log(`node:      ${process.version}`);
  log(`repo:      ${ROOT}`);
}
function lint(file) {
  const vale = valePath();
  if (!vale) { console.error('Vale missing — node cli.mjs install'); process.exit(2); }
  const r = spawnSync(vale, ['--config', join(ROOT, 'vale', '.vale.ini'), '--no-exit', '--output=line', resolve(file)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
function passthrough(script, extra) {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', script), ...extra], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const rest = args.slice(1);
switch (cmd) {
  case 'install': await install(); break;
  case 'doctor': doctor(); break;
  case 'lint': lint(rest[0]); break;
  case 'translate': passthrough('translate.mjs', rest); break;
  case 'estimate': passthrough('translate.mjs', [rest[0], '--estimate', ...rest.slice(1)]); break;
  case 'paragraphs': passthrough('paragraphs.mjs', rest); break;
  case 'calibrate': passthrough(has('--check') ? 'translate.mjs' : 'claudian.mjs', has('--check') ? ['--calibrate-check'] : ['--calibrate', ...rest]); break;
  default:
    log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
}
