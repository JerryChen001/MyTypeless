// 实时转写调度（D-013）：停顿即识别、松手零等待、限频预览、长段定稿后不再重复识别
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LiveTranscriber, SAMPLE_RATE, splitForTranscription } from '../src/main/live.ts'

const FRAME = 1600
const speech = () => {
  const f = new Int16Array(FRAME)
  for (let i = 0; i < FRAME; i++) f[i] = Math.round(5000 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE))
  return f
}
const silence = () => new Int16Array(FRAME)
const tick = () => new Promise((r) => setImmediate(r))

function harness(previewGapMs = 2500) {
  let t = 0
  const calls: Array<{ seconds: number; concurrent: boolean }> = []
  let running = 0
  const live = new LiveTranscriber(
    {
      previewGapMs,
      transcribe: async (pcm) => {
        running++
        calls.push({ seconds: pcm.length / SAMPLE_RATE, concurrent: running > 1 })
        await tick()
        running--
        return `<${(pcm.length / SAMPLE_RATE).toFixed(1)}s>`
      }
    },
    () => t
  )
  /** 推入若干 100ms 帧，模拟时间流逝，每帧之后让异步结果落地 */
  const feed = async (kind: 'speech' | 'silence', ms: number) => {
    for (let i = 0; i < ms / 100; i++) {
      live.push(kind === 'speech' ? speech() : silence())
      t += 100
      await tick()
    }
  }
  return { live, calls, feed }
}

test('停顿即识别；松手时最后一句已识别 → 不再发请求（零等待）', async () => {
  const { live, calls, feed } = harness(0)
  await feed('speech', 2000)
  assert.equal(calls.length, 0, '说话中、预览关闭时不识别')
  await feed('silence', 600)
  assert.equal(calls.length, 1, '停顿后识别一次')
  assert.equal(live.finalRequestNeeded(), false)
  const text = await live.finish()
  assert.equal(calls.length, 1, '松手不再识别')
  assert.equal(text, '<2.3s>') // 第 3 个静音帧触发：2.0s 语音 + 0.3s 静音；之后只有静音，无需再识别
})

test('没有停顿就松手 → 只对当前窗口识别一次', async () => {
  const { live, calls, feed } = harness(0)
  await feed('speech', 1500)
  assert.equal(live.finalRequestNeeded(), true)
  const text = await live.finish()
  assert.equal(calls.length, 1)
  assert.match(text, /^<1\.5s>$/)
})

test('停顿后又继续说 → 松手时补识别一次，覆盖全部语音', async () => {
  const { live, calls, feed } = harness(0)
  await feed('speech', 1500)
  await feed('silence', 600)
  await feed('speech', 1000)
  const text = await live.finish()
  assert.equal(calls.length, 2)
  assert.equal(text, '<3.1s>')
})

test('说话不停时限频预览：间隔受控，从不并发', async () => {
  const { live, calls, feed } = harness(2500)
  await feed('speech', 8000)
  assert.ok(calls.length >= 2 && calls.length <= 4, `预览次数 ${calls.length}`)
  assert.ok(calls.every((c) => !c.concurrent), '不并发')
  await live.finish()
})

test('超过 24 秒在停顿处定稿，之后的识别不再包含已定稿部分', async () => {
  const { live, calls, feed } = harness(0)
  for (let i = 0; i < 6; i++) {
    await feed('speech', 4500)
    await feed('silence', 500)
  }
  await feed('speech', 2000)
  const text = await live.finish()
  const longest = Math.max(...calls.map((c) => c.seconds))
  assert.ok(longest <= 28, `单次识别不超过 28 秒（实际 ${longest}s）`)
  // 总长 32s；定稿切在 24s 前最近的停顿处（约 19.5s），之后只识别剩余约 12.5s
  const last = calls.at(-1)!.seconds
  assert.ok(last <= 13, `定稿后最后一次只识别剩余部分（实际 ${last}s）`)
  assert.match(text, /^<\d+\.\ds><\d+\.\ds>$/, `定稿文本 + 窗口文本：${text}`)
})

test('全程静音：不识别，返回空', async () => {
  const { live, calls, feed } = harness(2500)
  await feed('silence', 3000)
  assert.equal(live.hasSpeech(), false)
  assert.equal(await live.finish(), '')
  assert.equal(calls.length, 0)
})

test('长录音（3 分钟）：定稿部分的音频被释放，内存与识别耗时不随时长增长', async () => {
  const { live, calls, feed } = harness(0)
  let maxRetained = 0
  for (let i = 0; i < 36; i++) {
    await feed('speech', 4500)
    await feed('silence', 500)
    maxRetained = Math.max(maxRetained, live.retainedSamples())
  }
  const text = await live.finish()
  assert.ok(maxRetained / SAMPLE_RATE <= 30, `内存里最多保留约 30 秒音频（实际 ${maxRetained / SAMPLE_RATE}s）`)
  assert.ok(Math.max(...calls.map((c) => c.seconds)) <= 28, '单次识别不超过 28 秒')
  const total = [...text.matchAll(/<(\d+\.\d)s>/g)].reduce((a, m) => a + Number(m[1]), 0)
  assert.ok(Math.abs(total - 180) < 1, `各段拼起来覆盖全部 180 秒（实际 ${total}s）`)
})

test('splitForTranscription：长音频按不超过上限切段、在最安静处下刀、首尾相接', () => {
  const sec = (n: number) => n * SAMPLE_RATE
  const pcm = new Int16Array(sec(12 * 60)).fill(3000)
  pcm.fill(0, sec(295), sec(295.1)) // 第一个 5 分钟末尾附近有一处停顿
  const parts = splitForTranscription(pcm)
  assert.equal(parts[0][0], 0)
  assert.equal(parts.at(-1)![1], pcm.length)
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i][0], parts[i - 1][1], '首尾相接')
  assert.ok(parts.every(([a, b]) => b - a <= sec(300)), '每段不超过 5 分钟')
  assert.ok(Math.abs(parts[0][1] - sec(295.05)) < 1600, `在停顿处切：${parts[0][1] / SAMPLE_RATE}s`)
  assert.deepEqual(splitForTranscription(new Int16Array(sec(30))), [[0, sec(30)]], '短音频不切')
})
