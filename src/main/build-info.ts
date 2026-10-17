import { app } from 'electron'
import type { AppInfo } from '../shared/types'

// 构建时由 electron.vite.config.ts 的 define 注入（scripts/dist.cjs 设置；开发运行为 dev）
declare const __MT_BUILD__: string
declare const __MT_COMMIT__: string

/** 当前版本：package.json 版本 + 本次打包的构建号与提交 */
export function appInfo(): AppInfo {
  return { version: app.getVersion(), build: __MT_BUILD__, commit: __MT_COMMIT__ }
}

/** 一行展示：0.2.0（构建 20261015.1342） */
export function versionLabel(): string {
  const i = appInfo()
  return i.build === 'dev' ? `${i.version}（开发版）` : `${i.version}（构建 ${i.build}）`
}
