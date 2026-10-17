import { randomUUID } from 'crypto'
import { database } from '../history'
import type { MeetingDetail, MeetingSegment, MeetingSpeaker, MeetingStatus, MeetingSummary, Voiceprint } from '../../shared/types'
import { SAMPLE_RATE } from '../live'
import { EMBED_MODEL } from './cluster'

/**
 * 会议存储（D-015、D-016）：会议、说话人（含每人一个声音特征向量）、按句的转写、已保存的声纹。
 * 表结构见 `history.ts`；录音不进数据库（临时文件路径记在 meetings.audio_path，整理完删除）。
 */

const ms = (samples: number) => Math.round((samples / SAMPLE_RATE) * 1000)

function toBlob(v: Float32Array | null): Buffer | null {
  return v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null
}

function fromBlob(b: Buffer | null): Float32Array | null {
  if (!b) return null
  const copy = new Uint8Array(b) // 对齐到 4 字节
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

export interface MeetingRow {
  id: string
  title: string
  started_at: number
  ended_at: number | null
  duration_ms: number
  status: MeetingStatus
  expected_speakers: number | null
  minutes: string | null
  minutes_error: string | null
  audio_path: string | null
  embed_model: string | null // 算逐句声纹用的声纹模型（NULL = 旧模型 CAM++，D-026）
}

export interface SpeakerRow {
  id: number
  meeting_id: string
  label: number
  name: string | null
  voiceprint_id: number | null
  centroid: Float32Array | null
}

export interface SegmentRow {
  id: number
  speakerId: number | null
  startSample: number
  endSample: number
  text: string
  locked: boolean
}

export function createMeeting(m: { title: string; startedAt: number; expectedSpeakers: number | null; audioPath: string }): string {
  const id = randomUUID()
  database()
    .prepare(`INSERT INTO meetings (id, title, started_at, status, expected_speakers, audio_path, embed_model) VALUES (?, ?, ?, 'recording', ?, ?, ?)`)
    .run(id, m.title, m.startedAt, m.expectedSpeakers, m.audioPath, EMBED_MODEL)
  return id
}

/** 这场会议的逐句声纹是否由当前声纹模型算出（只有这样才能与声纹库比较、保存声纹） */
export function usesCurrentModel(id: string): boolean {
  return getMeetingRow(id)?.embed_model === EMBED_MODEL
}

/** 旧模型的会议重新整理时：清掉旧声纹，改由当前模型从临时录音重算 */
export function resetEmbeddings(id: string): void {
  const d = database()
  d.prepare(`UPDATE meeting_segments SET embedding = NULL WHERE meeting_id = ?`).run(id)
  d.prepare(`UPDATE meeting_speakers SET centroid = NULL, voiceprint_id = NULL WHERE meeting_id = ?`).run(id)
  d.prepare(`UPDATE meetings SET embed_model = ? WHERE id = ?`).run(EMBED_MODEL, id)
}

export function updateMeeting(
  id: string,
  patch: Partial<{ title: string; status: MeetingStatus; endedAt: number; durationMs: number; minutes: string | null; minutesError: string | null; audioPath: string | null }>
): void {
  const cols: Record<string, string> = {
    title: 'title',
    status: 'status',
    endedAt: 'ended_at',
    durationMs: 'duration_ms',
    minutes: 'minutes',
    minutesError: 'minutes_error',
    audioPath: 'audio_path'
  }
  const keys = Object.keys(patch).filter((k) => k in cols)
  if (!keys.length) return
  const sql = `UPDATE meetings SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`
  database()
    .prepare(sql)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k] ?? null), id)
}

export function getMeetingRow(id: string): MeetingRow | null {
  return (database().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow | undefined) ?? null
}

/** 异常中断（进行中或整理中）的会议 */
export function unfinishedMeetings(): MeetingRow[] {
  return database().prepare(`SELECT * FROM meetings WHERE status IN ('recording', 'paused', 'processing')`).all() as MeetingRow[]
}

export function displayName(s: { label: number; name: string | null }): string {
  return s.name?.trim() || `说话人 ${s.label}`
}

export function listMeetings(): MeetingSummary[] {
  const rows = database().prepare(`SELECT * FROM meetings ORDER BY started_at DESC`).all() as MeetingRow[]
  const speakerStmt = database().prepare(
    `SELECT s.label, s.name FROM meeting_speakers s
     WHERE s.meeting_id = ? AND EXISTS (SELECT 1 FROM meeting_segments g WHERE g.speaker_id = s.id)
     ORDER BY s.label`
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    status: r.status,
    speakers: (speakerStmt.all(r.id) as Array<{ label: number; name: string | null }>).map(displayName),
    hasMinutes: !!r.minutes
  }))
}

export function getMeetingDetail(id: string): MeetingDetail | null {
  const r = getMeetingRow(id)
  if (!r) return null
  const segments = listSegments(id)
  const counts = new Map<number, number>()
  for (const s of segments) if (s.speakerId !== null) counts.set(s.speakerId, (counts.get(s.speakerId) ?? 0) + 1)
  const speakerList: MeetingSpeaker[] = listSpeakers(id)
    .filter((s) => counts.has(s.id))
    .map((s) => ({ id: s.id, label: s.label, name: s.name, voiceprintId: s.voiceprint_id, displayName: displayName(s), segmentCount: counts.get(s.id) ?? 0 }))
  const segs: MeetingSegment[] = segments.map((s) => ({
    id: s.id,
    speakerId: s.speakerId,
    startMs: ms(s.startSample),
    endMs: ms(s.endSample),
    text: s.text,
    locked: s.locked
  }))
  return {
    id: r.id,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    status: r.status,
    speakers: speakerList.map((s) => s.displayName),
    hasMinutes: !!r.minutes,
    expectedSpeakers: r.expected_speakers,
    speakerList,
    segments: segs,
    minutes: r.minutes,
    minutesError: r.minutes_error
  }
}

/** 删除会议的全部数据；返回临时录音路径（由调用方删除文件） */
export function deleteMeeting(id: string): string | null {
  const audio = getMeetingRow(id)?.audio_path ?? null
  const d = database()
  d.transaction(() => {
    d.prepare(`DELETE FROM meeting_segments WHERE meeting_id = ?`).run(id)
    d.prepare(`DELETE FROM meeting_speakers WHERE meeting_id = ?`).run(id)
    d.prepare(`DELETE FROM meetings WHERE id = ?`).run(id)
  })()
  return audio
}

// —— 说话人 ——

export function listSpeakers(meetingId: string): SpeakerRow[] {
  const rows = database().prepare(`SELECT * FROM meeting_speakers WHERE meeting_id = ? ORDER BY label`).all(meetingId) as Array<
    Omit<SpeakerRow, 'centroid'> & { centroid: Buffer | null }
  >
  return rows.map((r) => ({ ...r, centroid: fromBlob(r.centroid) }))
}

export function getSpeaker(id: number): SpeakerRow | null {
  const r = database().prepare(`SELECT * FROM meeting_speakers WHERE id = ?`).get(id) as (Omit<SpeakerRow, 'centroid'> & { centroid: Buffer | null }) | undefined
  return r ? { ...r, centroid: fromBlob(r.centroid) } : null
}

export function addSpeaker(meetingId: string, name: string | null = null, voiceprintId: number | null = null): number {
  const d = database()
  const next = (d.prepare(`SELECT COALESCE(MAX(label), 0) + 1 AS n FROM meeting_speakers WHERE meeting_id = ?`).get(meetingId) as { n: number }).n
  const info = d.prepare(`INSERT INTO meeting_speakers (meeting_id, label, name, voiceprint_id) VALUES (?, ?, ?, ?)`).run(meetingId, next, name, voiceprintId)
  return Number(info.lastInsertRowid)
}

export function updateSpeaker(id: number, patch: Partial<{ name: string | null; voiceprintId: number | null; centroid: Float32Array | null }>): void {
  const d = database()
  if ('name' in patch) d.prepare(`UPDATE meeting_speakers SET name = ? WHERE id = ?`).run(patch.name, id)
  if ('voiceprintId' in patch) d.prepare(`UPDATE meeting_speakers SET voiceprint_id = ? WHERE id = ?`).run(patch.voiceprintId, id)
  if ('centroid' in patch) d.prepare(`UPDATE meeting_speakers SET centroid = ? WHERE id = ?`).run(toBlob(patch.centroid ?? null), id)
}

/** 合并说话人：from 的句子全部归到 into，删除 from（from 的名字在 into 没名字时继承） */
export function mergeSpeakers(from: number, into: number): void {
  const d = database()
  d.transaction(() => {
    const a = getSpeaker(from)
    const b = getSpeaker(into)
    if (a && b && !b.name && a.name) d.prepare(`UPDATE meeting_speakers SET name = ?, voiceprint_id = ? WHERE id = ?`).run(a.name, a.voiceprint_id, into)
    d.prepare(`UPDATE meeting_segments SET speaker_id = ? WHERE speaker_id = ?`).run(into, from)
    d.prepare(`DELETE FROM meeting_speakers WHERE id = ?`).run(from)
  })()
}

// —— 句子 ——

export function addSegment(
  meetingId: string,
  seg: { speakerId: number | null; startSample: number; endSample: number; text: string; embedding?: Float32Array | null }
): number {
  const info = database()
    .prepare(`INSERT INTO meeting_segments (meeting_id, speaker_id, start_sample, end_sample, text, embedding) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(meetingId, seg.speakerId, seg.startSample, seg.endSample, seg.text, toBlob(seg.embedding ?? null))
  return Number(info.lastInsertRowid)
}

/** 逐句声纹（D-020）：会后按人数重新区分说话人用 */
export function setSegmentEmbedding(id: number, v: Float32Array): void {
  database().prepare(`UPDATE meeting_segments SET embedding = ? WHERE id = ?`).run(toBlob(v), id)
}

export function segmentEmbeddings(meetingId: string): Map<number, Float32Array> {
  const rows = database().prepare(`SELECT id, embedding FROM meeting_segments WHERE meeting_id = ? AND embedding IS NOT NULL`).all(meetingId) as Array<{
    id: number
    embedding: Buffer
  }>
  return new Map(rows.map((r) => [r.id, fromBlob(r.embedding)!]))
}

export function setExpectedSpeakers(id: string, n: number | null): void {
  database().prepare(`UPDATE meetings SET expected_speakers = ? WHERE id = ?`).run(n, id)
}

export function setSegmentSpeaker(id: number, speakerId: number | null, locked?: boolean): void {
  if (locked === undefined) database().prepare(`UPDATE meeting_segments SET speaker_id = ? WHERE id = ?`).run(speakerId, id)
  else database().prepare(`UPDATE meeting_segments SET speaker_id = ?, locked = ? WHERE id = ?`).run(speakerId, locked ? 1 : 0, id)
}

export function listSegments(meetingId: string): SegmentRow[] {
  const rows = database()
    .prepare(`SELECT id, speaker_id, start_sample, end_sample, text, locked FROM meeting_segments WHERE meeting_id = ? ORDER BY start_sample, id`)
    .all(meetingId) as Array<{ id: number; speaker_id: number | null; start_sample: number; end_sample: number; text: string; locked: number }>
  return rows.map((r) => ({ id: r.id, speakerId: r.speaker_id, startSample: r.start_sample, endSample: r.end_sample, text: r.text, locked: !!r.locked }))
}

/** 「说话人 N」按第一次发言的先后重新编号（名字不变） */
export function relabelSpeakers(meetingId: string): void {
  const d = database()
  const order = d
    .prepare(
      `SELECT s.id FROM meeting_speakers s
       JOIN (SELECT speaker_id, MIN(start_sample) AS first FROM meeting_segments WHERE meeting_id = ? GROUP BY speaker_id) f ON f.speaker_id = s.id
       WHERE s.meeting_id = ? ORDER BY f.first`
    )
    .all(meetingId, meetingId) as Array<{ id: number }>
  d.transaction(() => {
    const stmt = d.prepare(`UPDATE meeting_speakers SET label = ? WHERE id = ?`)
    order.forEach((r, i) => stmt.run(i + 1, r.id))
  })()
}

/** 删掉没有句子的说话人（重新归类、合并之后） */
export function pruneSpeakers(meetingId: string): void {
  database()
    .prepare(`DELETE FROM meeting_speakers WHERE meeting_id = ? AND NOT EXISTS (SELECT 1 FROM meeting_segments g WHERE g.speaker_id = meeting_speakers.id)`)
    .run(meetingId)
}

// —— 声纹库（D-016）——

export function listVoiceprints(): Voiceprint[] {
  return (database().prepare(`SELECT id, name, samples, created_at, updated_at FROM voiceprints ORDER BY updated_at DESC`).all() as Array<{
    id: number
    name: string
    samples: number
    created_at: number
    updated_at: number
  }>).map((r) => ({ id: r.id, name: r.name, samples: r.samples, createdAt: r.created_at, updatedAt: r.updated_at }))
}

export function voiceprintVectors(): Array<{ id: number; name: string; samples: number; vector: Float32Array }> {
  return (database().prepare(`SELECT id, name, samples, vector FROM voiceprints WHERE model = ?`).all(EMBED_MODEL) as Array<{ id: number; name: string; samples: number; vector: Buffer }>).map(
    (r) => ({ id: r.id, name: r.name, samples: r.samples, vector: fromBlob(r.vector)! })
  )
}

export function saveVoiceprint(p: { id?: number | null; name: string; vector: Float32Array; samples: number }): number {
  const d = database()
  const now = Date.now()
  if (p.id) {
    d.prepare(`UPDATE voiceprints SET name = ?, vector = ?, samples = ?, model = ?, updated_at = ? WHERE id = ?`).run(p.name, toBlob(p.vector), p.samples, EMBED_MODEL, now, p.id)
    return p.id
  }
  const info = d.prepare(`INSERT INTO voiceprints (name, vector, samples, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(p.name, toBlob(p.vector), p.samples, EMBED_MODEL, now, now)
  return Number(info.lastInsertRowid)
}

export function renameVoiceprint(id: number, name: string): void {
  const d = database()
  d.transaction(() => {
    d.prepare(`UPDATE voiceprints SET name = ?, updated_at = ? WHERE id = ?`).run(name, Date.now(), id)
    d.prepare(`UPDATE meeting_speakers SET name = ? WHERE voiceprint_id = ?`).run(name, id)
  })()
}

/** 删除声纹：立即生效；已有会议里的名字保留，只是不再关联声纹 */
export function deleteVoiceprint(id: number): void {
  const d = database()
  d.transaction(() => {
    d.prepare(`DELETE FROM voiceprints WHERE id = ?`).run(id)
    d.prepare(`UPDATE meeting_speakers SET voiceprint_id = NULL WHERE voiceprint_id = ?`).run(id)
  })()
}
