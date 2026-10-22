# 2026-10-21 构建号固定按北京时间

## 现象

同一版本两个平台的构建号时间对不上：v0.3.3 的 Windows 包是 07:32、Mac 包是 15:29。Windows 包由 `release-windows.yml` 在 GitHub 的 Windows 机器上打，那里是 UTC 时区，`dist.cjs` 取本地时间就比 Mac 早 8 小时；其他时区的贡献者本地打包同样各不相同。

## 改动

`dist.cjs` 的构建号固定按 UTC+8（`BUILD_UTC_OFFSET_HOURS`，与发布者 Mac 的时间一致）计算，与运行打包的机器所在时区无关。只改时间的取法，构建号格式不变；在线更新按版本号判断，不受影响。

## 验证

- 在 UTC-7 的机器上计算出的构建号与北京时间一致。
- typecheck / test / build / docs:check 通过。
