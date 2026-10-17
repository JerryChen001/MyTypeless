// 按平台显示的快捷键名与系统设置路径（主进程与渲染端共用；不依赖 electron，可直接单测）

/** macOS 键名：与改版前首页的显示保持一致 */
const MAC_KEYS: Record<string, string> = {
  fn: 'fn',
  space: '空格',
  shift: '⇧',
  opt: '⌥',
  option: '⌥',
  alt: '⌥',
  ropt: '右⌥',
  cmd: '⌘',
  command: '⌘',
  ctrl: '⌃',
  control: '⌃',
  esc: 'esc'
}

/** Windows 键名：opt 对应 Alt，cmd 对应 Win 键 */
const WIN_KEYS: Record<string, string> = {
  fn: 'Fn',
  space: '空格',
  shift: 'Shift',
  rshift: '右Shift',
  lshift: '左Shift',
  opt: 'Alt',
  option: 'Alt',
  alt: 'Alt',
  ropt: '右Alt',
  lopt: '左Alt',
  cmd: 'Win',
  command: 'Win',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  rctrl: '右Ctrl',
  lctrl: '左Ctrl',
  esc: 'Esc'
}

export function isMacPlatform(platform: string): boolean {
  return platform === 'darwin'
}

/** "fn+space" → ['fn', '空格']；未知键转大写 */
export function comboKeys(combo: string, platform: string): string[] {
  const names = isMacPlatform(platform) ? MAC_KEYS : WIN_KEYS
  return combo
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => names[k] ?? k.toUpperCase())
}

/** 粘贴快捷键的写法（写入失败提示用） */
export function pasteShortcut(platform: string): string {
  return isMacPlatform(platform) ? '⌘V' : 'Ctrl+V'
}

/** 没有麦克风权限时，告诉用户去哪里打开 */
export function micPermissionHint(platform: string): string {
  return isMacPlatform(platform)
    ? '没有麦克风权限：系统设置 → 隐私与安全性 → 麦克风 → 允许 MyTypeless'
    : '没有麦克风权限：设置 → 隐私和安全性 → 麦克风 → 打开「允许桌面应用访问麦克风」'
}
