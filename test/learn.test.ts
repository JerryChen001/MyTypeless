// 自动词典学习（D-012）：专有名词提取、修改比对、收录规则
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractTerms, diffCorrections, learnableFromCorrection, tokenize } from '../src/main/learn.ts'

test('extractTerms：内部大写、全大写缩写、字母数字混合；排除普通词、常见缩写和版本号', () => {
  assert.deepEqual(
    extractTerms('用 DeepSeek 和 GitHub 测试 API，iPhone 上跑 GPT4o，版本 v1.2，OK 没问题，Hello world').sort(),
    ['API', 'DeepSeek', 'GPT4o', 'GitHub', 'iPhone'].sort()
  )
})

test('tokenize：汉字逐字，英文数字成词', () => {
  assert.deepEqual(tokenize('明天用 Deep Seek，3点'), ['明', '天', '用', 'Deep', 'Seek', '3', '点'])
})

test('diffCorrections：英文被改正（含前后无关上下文）', () => {
  const inserted = '我们用 deep sick 做测试'
  const current = '上一行的内容。我们用 DeepSeek 做测试，然后'
  assert.deepEqual(diffCorrections(inserted, current), [{ from: 'deep sick', to: 'DeepSeek' }])
})

test('diffCorrections：中文同音错字被改正', () => {
  assert.deepEqual(diffCorrections('开放时间早上九点', '开饭时间早上九点'), [{ from: '开放', to: '开饭' }])
  assert.deepEqual(diffCorrections('请联系张三丰老师', '请联系章三峰老师'), [{ from: '张三丰', to: '章三峰' }])
})

test('diffCorrections：整段改写或光标已不在这里 → 不学习', () => {
  assert.deepEqual(diffCorrections('明天下午三点开会', '这是完全不相关的另一段文字内容'), [])
  assert.deepEqual(diffCorrections('明天下午三点开会', '明天下午三点开会'), [])
})

test('learnableFromCorrection：英文改一次即收录；中文需累计；过长或常见缩写不收', () => {
  assert.deepEqual(learnableFromCorrection({ from: 'deep sick', to: 'DeepSeek' }), { term: 'DeepSeek', immediate: true })
  assert.deepEqual(learnableFromCorrection({ from: '张三丰', to: '章三峰' }), { term: '章三峰', immediate: false })
  assert.equal(learnableFromCorrection({ from: '放', to: '饭' }), null, '单字不收')
  assert.deepEqual(learnableFromCorrection({ from: '开放', to: '开饭' }), { term: '开饭', immediate: false })
  assert.equal(learnableFromCorrection({ from: 'ok', to: 'OK' }), null)
  assert.equal(learnableFromCorrection({ from: 'a', to: 'this is a whole new sentence written here' }), null)
})
