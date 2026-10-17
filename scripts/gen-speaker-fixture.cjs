#!/usr/bin/env node
/**
 * 生成说话人回归数据 test/fixtures/speakers.json（换声纹模型后重跑，D-026）。
 * 用法：node scripts/gen-speaker-fixture.cjs <sr-data 目录> <声纹模型.onnx>
 * - sr-data：sherpa-onnx 说话人识别测试集（Hugging Face csukuangfj/sr-data，Apache-2.0），含 enroll/ 与 test/ 两个目录
 * - 声纹模型：与应用一致（diarizer.ts 的 SPEAKER_MODELS.embedding）
 * 每段中文录音：完整一段（long）+ 按固定随机种子切成 1～2.5 秒的短句（short）；原声（clean）与模拟电脑外放（played：带通 + 回声 + 压缩）
 * 依赖：ffmpeg、native/bin/mt-diarize（npm run diarize）。声纹保留 4 位小数。
 */
const { execFileSync, spawn } = require('child_process')
const { readdirSync, writeFileSync, mkdtempSync, rmSync, statSync } = require('fs')
const { join, basename } = require('path')
const { tmpdir } = require('os')
const readline = require('readline')

const [srDir, model] = process.argv.slice(2)
if (!srDir || !model) {
  console.error('用法：node scripts/gen-speaker-fixture.cjs <sr-data 目录> <声纹模型.onnx>')
  process.exit(2)
}
const root = join(__dirname, '..')
const SR = 16000
const PLAYED = 'highpass=f=350,lowpass=f=5000,equalizer=f=1200:t=q:w=1.5:g=6,aecho=0.8:0.6:40|90:0.4|0.25,volume=0.6,acompressor=threshold=-20dB:ratio=4'
let seed = 20261015
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

const files = ['enroll', 'test', 'test/3d-speaker']
  .flatMap((d) => readdirSync(join(srDir, d)).map((f) => join(srDir, d, f)))
  .filter((f) => f.endsWith('.wav') && !/_en_/.test(f))
  .sort()
const speakerOf = (f) => basename(f).split(/[-_]/)[0]

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'mt-fixture '))
  const helper = spawn(join(root, 'native/bin/mt-diarize'), ['--model', model, '--threads', '2'])
  const rl = readline.createInterface({ input: helper.stdout })
  const queue = []
  rl.on('line', (l) => queue.shift()?.(JSON.parse(l)))
  const send = (c) => new Promise((r) => (queue.push(r), c && helper.stdin.write(c + '\n')))
  await send(null)
  const items = []
  for (const ch of ['clean', 'played']) {
    for (const f of files) {
      const pcm = join(tmp, `${ch}-${basename(f)}.pcm`)
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', f, '-af', ch === 'played' ? PLAYED : 'anull', '-ar', '16000', '-ac', '1', '-f', 's16le', pcm])
      const n = Math.floor(statSync(pcm).size / 2)
      const spk = speakerOf(f)
      const add = async (kind, start, count) => {
        const r = await send(`embed ${start} ${count} ${pcm}`)
        if (r.ok) items.push({ spk, ch, kind, d: +(count / SR).toFixed(2), v: r.v.map((x) => +x.toFixed(4)) })
      }
      await add('long', 0, n)
      for (let o = Math.floor(0.2 * SR); o < n - SR; ) {
        const len = Math.min(n - o, Math.round(SR * (1 + rnd() * 1.5)))
        if (len >= SR) await add('short', o, len)
        o += len
      }
    }
  }
  helper.kill()
  rmSync(tmp, { recursive: true, force: true })
  const out = {
    说明: `说话人回归数据（scripts/gen-speaker-fixture.mjs 生成）：sherpa-onnx 说话人识别测试集 csukuangfj/sr-data（Apache-2.0）中文录音，完整段（long）与 1～2.5 秒短句（short），原声（clean）/ 模拟电脑外放（played）；声纹模型 ${basename(model)}，保留 4 位小数`,
    model: basename(model),
    items
  }
  writeFileSync(join(root, 'test/fixtures/speakers.json'), JSON.stringify(out))
  const count = {}
  for (const it of items) count[`${it.spk}/${it.ch}/${it.kind}`] = (count[`${it.spk}/${it.ch}/${it.kind}`] ?? 0) + 1
  console.log(`写入 ${items.length} 段`, count)
}
main()
