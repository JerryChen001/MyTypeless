# 2026-10-17 Windows 安装包文件名带操作系统

## 改动

Windows 的安装包与解压即用版改名：

| 改前 | 改后 |
| --- | --- |
| `MyTypeless-<版本>-<构建号>-x64.exe` / `.zip` | `MyTypeless-<版本>-<构建号>-win-x64.exe` / `.zip` |

`x64` 并不只有 Windows（Intel Mac 也是 x64），文件名应能直接看出平台。

- `electron-builder.yml` 的 `win.artifactName`。
- 发布脚本的解析（`parseWinArtifact` / `parseWinZip`）、`publish-win.cjs` 上传的文件名、`release-windows.yml` 的构建产物。
- 需求、验收、D-036 / D-037、README、CONTRIBUTING 里的文件名。
- Windows 版还没有正式发布过，不涉及旧文件名的兼容。macOS 的文件名不变（建议见 PR）。

## 验证

- 实际打包得到 `MyTypeless-0.3.1-<构建号>-win-x64.exe` / `.zip`。
- 单测：新文件名能解析、旧文件名不再匹配、打包配置的 `artifactName` 与发布脚本一致。
- `npm run test`、typecheck、build、docs:check 通过。
