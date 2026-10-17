// mt-text —— MyTypeless 文本转换助手（繁简转换，基于系统 ICU）
// 用法: echo "文本" | mt-text --to hans   → 繁体转简体
//       echo "文本" | mt-text --to hant   → 简体转繁体
// 输入输出均为 UTF-8（stdin → stdout）。退出码: 0 成功 / 2 参数或编码错误
// 权限: 无。

import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 2, args[0] == "--to", args[1] == "hans" || args[1] == "hant" else {
    FileHandle.standardError.write("usage: mt-text --to hans|hant < input\n".data(using: .utf8)!)
    exit(2)
}
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let text = String(data: data, encoding: .utf8) else { exit(2) }
let transform = StringTransform(args[1] == "hans" ? "Hant-Hans" : "Hans-Hant")
let out = text.applyingTransform(transform, reverse: false) ?? text
FileHandle.standardOutput.write(out.data(using: .utf8)!)
exit(0)
