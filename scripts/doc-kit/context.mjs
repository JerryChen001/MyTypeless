// Task router: prints the minimal document set, module guides, search scope
// and verification commands for one task. Routing lives in
// docs/governance/task-routing.json. Zero dependencies (Node >= 18).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routingPath = path.join(root, 'docs/governance/task-routing.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(routingPath)) fail('缺少 docs/governance/task-routing.json，请在仓库根目录运行。');
const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log('任务 ID：');
  for (const [id, item] of Object.entries(routing.tasks ?? {})) console.log(`- ${id}: ${item.description}`);
  console.log('\n影响 ID：');
  for (const [id, files] of Object.entries(routing.impacts ?? {})) console.log(`- ${id}: ${files.join(', ')}`);
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const taskId = valueAfter('--task');
const mode = valueAfter('--mode') ?? 'analysis';
const impactIds = (valueAfter('--impact') ?? '').split(',').map((v) => v.trim()).filter(Boolean);

if (!taskId || !routing.tasks?.[taskId]) fail('请使用 --task <任务ID>；运行 --list 查看可用值。');
if (!['analysis', 'implementation', 'review'].includes(mode)) fail('--mode 只允许 analysis、implementation 或 review。');

const task = routing.tasks[taskId];
const files = new Set(routing.alwaysRead ?? []);
for (const file of task.read ?? []) files.add(file);
for (const impactId of impactIds) {
  if (!routing.impacts?.[impactId]) fail(`未知影响 ID：${impactId}`);
  for (const file of routing.impacts[impactId]) files.add(file);
}
if (mode !== 'analysis') for (const file of routing.implementationRead ?? []) files.add(file);

const missing = [...files].filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) fail(`路由引用了缺失文件：\n${missing.join('\n')}`);

// Module guides: the AGENTS.md nearest to each search scope plus its
// ancestors below the root. Tools that only load AGENTS.md upward from the
// working directory (Codex, DeepSeek Harness) need this explicit list.
const guides = new Set();
for (const scope of task.search ?? []) {
  let directory = path.join(root, scope);
  if (!scope.endsWith('/')) directory = path.dirname(directory);
  while (directory.startsWith(root) && directory !== root) {
    const guide = path.join(directory, 'AGENTS.md');
    if (fs.existsSync(guide)) guides.add(path.relative(root, guide));
    directory = path.dirname(directory);
  }
}

console.log(`# 任务上下文：${taskId}`);
console.log(`模式：${mode}`);
console.log(`目标：${task.description}`);
console.log('\n必读文档：');
for (const file of files) console.log(`- ${file}`);
console.log('\n默认搜索范围：');
for (const scope of task.search ?? []) console.log(`- ${scope}`);
if (guides.size) {
  console.log('\n模块说明（修改对应目录代码前阅读）：');
  for (const guide of [...guides].sort()) console.log(`- ${guide}`);
}
console.log('\n验证入口：');
for (const command of task.verify ?? []) console.log(`- ${command}`);
if (task.gates?.length) {
  console.log('\n阶段门禁：');
  for (const gate of task.gates) console.log(`- ${gate}`);
}
