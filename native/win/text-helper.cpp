// mt-text（Windows 版，原创）：繁简转换。协议同 macOS 版（docs/contracts/native-helpers.md）：
//   echo <文本> | mt-text --to hans|hant   UTF-8 进出；退出码 0 成功、2 参数错误、4 转换失败
// 用系统自带的 LCMapStringEx（LCMAP_SIMPLIFIED_CHINESE / LCMAP_TRADITIONAL_CHINESE），不依赖第三方库。
#include "common.h"

int wmain(int argc, wchar_t **argv) {
  DWORD flag = 0;
  if (argc == 3 && wcscmp(argv[1], L"--to") == 0) {
    if (wcscmp(argv[2], L"hans") == 0) flag = LCMAP_SIMPLIFIED_CHINESE;
    else if (wcscmp(argv[2], L"hant") == 0) flag = LCMAP_TRADITIONAL_CHINESE;
  }
  if (!flag) {
    fputs("usage: mt-text --to hans|hant < text\n", stderr);
    return 2;
  }

  std::wstring in = Utf8ToWide(ReadAllStdin());
  if (in.empty()) return 0;
  int n = LCMapStringEx(L"zh-CN", flag, in.data(), (int)in.size(), nullptr, 0, nullptr, nullptr, 0);
  if (n <= 0) return 4;
  std::wstring out(n, L'\0');
  if (LCMapStringEx(L"zh-CN", flag, in.data(), (int)in.size(), out.data(), n, nullptr, nullptr, 0) <= 0) return 4;
  WriteStdout(WideToUtf8(out));
  return 0;
}
