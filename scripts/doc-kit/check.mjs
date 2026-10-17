// Structural documentation check. Fails on drift that misleads AI agents:
// dead links, missing bridges, routing that points at nothing, duplicate IDs,
// decision index/domain mismatch. Configuration: docs/governance/doc-kit.json.
// Zero dependencies (Node >= 18). Runs outside the model, so it costs no
// request context.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'docs/governance/doc-kit.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const errors = [];
const warnings = [];
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

// --- Markdown inventory -------------------------------------------------------
// excludeDirs: a bare name ("vendor") is skipped at any depth; an entry with a
// slash ("docs/third-party/") is a path prefix from the repository root.
// Build outputs that are also common words ("out", "release") are only skipped
// at the root, so docs/release/ is still checked.
const excludeEntries = config.excludeDirs ?? [];
const excludedNames = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', '.venv', 'target', ...excludeEntries.filter((e) => !e.includes('/'))]);
const excludedRootNames = new Set(['out', 'release', '.next', '.nuxt', '.turbo']);
const excludedPrefixes = excludeEntries.filter((e) => e.includes('/')).map((e) => (e.endsWith('/') ? e : `${e}/`));
const linkExempt = (config.linkCheckExempt ?? ['docs/_history/']);
const markdown = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    if (directory === root && excludedRootNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedPrefixes.some((prefix) => `${rel(absolute)}/`.startsWith(prefix))) walk(absolute);
    } else if (entry.name.endsWith('.md')) markdown.push(absolute);
  }
})(root);

const forbidden = new RegExp(config.forbiddenMarkers ?? '\\b(?:TODO|TBD|FIXME)\\b');
const forbiddenExempt = config.forbiddenMarkerExempt ?? ['docs/_history/'];
const placeholder = config.placeholder ?? '〔待填写';
const placeholderExempt = config.placeholderExempt ?? ['docs/templates/', 'docs/governance/playbooks/'];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
// Code samples may legitimately contain "[a](b)" or "TODO"; links and markers
// are only checked in prose. Placeholders are counted everywhere.
const prose = (text) => text
  .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  .replace(/`[^`\n]*`/g, '');
let placeholderCount = 0;
for (const file of markdown) {
  const text = fs.readFileSync(file, 'utf8');
  const name = rel(file);
  const body = prose(text);
  if (/\uFFFD/.test(text)) errors.push(`${name}: 包含 Unicode 替换字符`);
  if (!forbiddenExempt.some((prefix) => name.startsWith(prefix)) && forbidden.test(body)) {
    errors.push(`${name}: 包含未完成占位标记（${forbidden.source}）`);
  }
  if (!text.endsWith('\n')) errors.push(`${name}: 文件末尾缺少换行`);
  const holes = placeholderExempt.some((prefix) => name.startsWith(prefix)) ? 0 : text.split(placeholder).length - 1;
  if (holes) { placeholderCount += holes; warnings.push(`${name}: ${holes} 处待填写`); }
  if (linkExempt.some((prefix) => name.startsWith(prefix))) continue;
  for (const match of body.matchAll(markdownLink)) {
    const target = match[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    const decoded = decodeURIComponent(target.replace(/^<|>$/g, ''));
    if (!fs.existsSync(path.resolve(path.dirname(file), decoded))) errors.push(`${name}: 本地链接不存在 -> ${target}`);
  }
}

// --- Required files -------------------------------------------------------------
for (const file of config.requiredFiles ?? []) if (!exists(file)) errors.push(`缺少必需文件：${file}`);

// --- AGENTS.md guides: CLAUDE.md bridge and size budget -------------------------
const limits = { rootAgentsLines: 150, moduleAgentsLines: 80, ...(config.limits ?? {}) };
for (const file of markdown.filter((f) => path.basename(f) === 'AGENTS.md')) {
  const name = rel(file);
  const bridge = path.join(path.dirname(file), 'CLAUDE.md');
  if (!fs.existsSync(bridge)) errors.push(`${rel(bridge)}: 缺少 AGENTS.md 桥接文件（内容为 @AGENTS.md）`);
  else if (!/^@AGENTS\.md$/m.test(fs.readFileSync(bridge, 'utf8'))) errors.push(`${rel(bridge)}: 必须包含 @AGENTS.md 导入`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').length - 1;
  const limit = name === 'AGENTS.md' ? limits.rootAgentsLines : limits.moduleAgentsLines;
  if (lines > limit) warnings.push(`${name}: ${lines} 行，超过建议上限 ${limit} 行（每次会话都会加载，宜精简）`);
}

// --- STATUS.md freshness marker ---------------------------------------------------
if (exists('docs/STATUS.md') && !/^最后更新：\d{4}-\d{2}-\d{2}$/m.test(read('docs/STATUS.md'))) {
  errors.push('docs/STATUS.md: 缺少“最后更新：YYYY-MM-DD”行');
}

// --- Task routing: files, search scopes and verify commands must exist ------------
if (exists('docs/governance/task-routing.json')) {
  const routing = JSON.parse(read('docs/governance/task-routing.json'));
  const routed = [
    ...(routing.alwaysRead ?? []),
    ...(routing.implementationRead ?? []),
    ...Object.values(routing.impacts ?? {}).flat(),
    ...Object.values(routing.tasks ?? {}).flatMap((task) => task.read ?? []),
  ];
  for (const file of new Set(routed)) if (!exists(file)) errors.push(`任务路由引用缺失文件：${file}`);
  const makefile = exists('Makefile') ? read('Makefile') : '';
  const scripts = exists('package.json') ? JSON.parse(read('package.json')).scripts ?? {} : {};
  for (const [id, task] of Object.entries(routing.tasks ?? {})) {
    if (!(task.search ?? []).length) warnings.push(`任务路由 ${id} 未配置搜索范围（search），AI 将不知道该看哪些代码`);
    for (const scope of task.search ?? []) if (!exists(scope)) errors.push(`任务路由 ${id} 搜索范围不存在：${scope}`);
    for (const command of task.verify ?? []) {
      const target = command.match(/^make ([\w-]+)/)?.[1];
      if (target && !new RegExp(`^${target}:`, 'm').test(makefile)) errors.push(`任务路由 ${id} 引用不存在的 make 目标：${target}`);
      // "npm run x" / "pnpm run x" / "yarn run x", plus the "npm test" / "npm start" shorthands.
      const script = command.match(/^(?:npm|pnpm|yarn) run(?:-script)? ([\w:.-]+)/)?.[1]
        ?? command.match(/^(?:npm|pnpm|yarn) (test|start)\b/)?.[1];
      if (script && !scripts[script]) errors.push(`任务路由 ${id} 引用不存在的 npm 脚本：${script}`);
    }
  }
}

// --- ID registries: append-only, never reused ----------------------------------------
const registries = config.idRegistries ?? [];
for (const registry of registries) {
  if (!exists(registry.file)) continue;
  const seen = new Map();
  for (const match of read(registry.file).matchAll(new RegExp(registry.pattern, 'gm'))) {
    seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  }
  for (const [id, count] of seen) if (count > 1) errors.push(`${registry.name}编号重复：${id}（${registry.file}，${count} 次）`);
}

// --- Decision index <-> domain files ---------------------------------------------------
const decisions = config.decisions;
if (decisions && exists(decisions.index) && exists(decisions.domainsDir)) {
  const pattern = new RegExp(decisions.pattern, 'gm');
  const count = (text) => {
    const ids = new Map();
    for (const match of text.matchAll(pattern)) ids.set(match[1], (ids.get(match[1]) ?? 0) + 1);
    return ids;
  };
  const indexIds = count(read(decisions.index));
  const domainIds = count(fs.readdirSync(path.join(root, decisions.domainsDir))
    .filter((file) => file.endsWith('.md'))
    .map((file) => read(path.join(decisions.domainsDir, file)))
    .join('\n'));
  for (const id of new Set([...indexIds.keys(), ...domainIds.keys()])) {
    if ((indexIds.get(id) ?? 0) !== (domainIds.get(id) ?? 0)) {
      errors.push(`决策 ${id}：索引 ${indexIds.get(id) ?? 0} 条，领域文件 ${domainIds.get(id) ?? 0} 条，不一致`);
    }
  }
}

// --- Acceptance scenario IDs unique across files ----------------------------------------
const acceptance = config.acceptance;
if (acceptance) {
  const owners = new Map();
  const pattern = new RegExp(acceptance.pattern, 'gm');
  for (const file of markdown.map(rel).filter((name) => (acceptance.paths ?? []).some((prefix) => name.startsWith(prefix)))) {
    for (const match of read(file).matchAll(pattern)) {
      if (owners.has(match[1])) errors.push(`验收场景 ID 重复：${match[1]} -> ${owners.get(match[1])}, ${file}`);
      else owners.set(match[1], file);
    }
  }
}

// --- Glossary: unique terms; deprecated wording still in fact documents ---------------------
const glossary = config.glossary;
if (glossary && exists(glossary.file)) {
  const sections = read(glossary.file).split(/^## /m).slice(1).map((block) => {
    const [heading, ...body] = block.split('\n');
    const rows = body.filter((line) => /^\| /.test(line) && !/^\| ---/.test(line)).slice(1)
      .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    return { heading: heading.trim(), rows };
  });
  const terms = new Map();
  for (const { heading, rows } of sections) {
    if (heading === '易混淆对照' || heading === '废弃说法') continue;
    for (const [term] of rows) {
      if (!term) continue;
      if (terms.has(term)) errors.push(`术语重复：“${term}”（${terms.get(term)}、${heading}）`);
      else terms.set(term, heading);
    }
  }
  const deprecated = sections.find((section) => section.heading === '废弃说法')?.rows ?? [];
  const exempt = glossary.deprecatedExempt ?? [];
  for (const [old, current] of deprecated) {
    if (!old) continue;
    const hits = markdown.map(rel)
      .filter((name) => !exempt.some((prefix) => name.startsWith(prefix)))
      .filter((name) => read(name).includes(old));
    if (hits.length) warnings.push(`废弃说法“${old}”（现行：${current}）仍出现在：${hits.slice(0, 5).join('、')}${hits.length > 5 ? ` 等 ${hits.length} 个文件` : ''}`);
  }
}

for (const warning of warnings) console.warn(`提示：${warning}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`文档检查通过：${markdown.length} 个 Markdown 文件${placeholderCount ? `；仍有 ${placeholderCount} 处待填写` : ''}。`);
