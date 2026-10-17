// mt-focus（Windows 版，原创）。协议同 macOS 版（docs/contracts/native-helpers.md）：
//   mt-focus                          → {"bundleId","name","pid"}：前台窗口所属程序；取不到时 {}
//                                       bundleId 用小写 exe 文件名（如 code.exe），name 用程序的文件描述（如 Visual Studio Code）
//   mt-focus --activate <pid>         → 把该进程的窗口切到前台；进程不存在退出码 2，切换失败 4
//   mt-focus --selected-text          → 尚未实现（UI Automation，GAP-008），退出码 5 = 读不到
//   mt-focus --caret-context <前> <后> → 同上
#include "common.h"
#include <wctype.h>

#pragma comment(lib, "version.lib")

static std::wstring ExePath(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return {};
  wchar_t buf[MAX_PATH * 2];
  DWORD len = (DWORD)(sizeof buf / sizeof buf[0]);
  std::wstring path;
  if (QueryFullProcessImageNameW(h, 0, buf, &len)) path.assign(buf, len);
  CloseHandle(h);
  return path;
}

static std::wstring FileName(const std::wstring &path) {
  size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

static std::wstring Lower(std::wstring s) {
  for (auto &c : s) c = (wchar_t)towlower(c);
  return s;
}

/** 程序的文件描述（版本信息里的 FileDescription）；没有时为空 */
static std::wstring FileDescription(const std::wstring &path) {
  DWORD size = GetFileVersionInfoSizeW(path.c_str(), nullptr);
  if (!size) return {};
  std::string data(size, '\0');
  if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return {};
  struct Lang { WORD lang, codepage; } *langs = nullptr;
  UINT bytes = 0;
  if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", (void **)&langs, &bytes) || bytes < sizeof(Lang)) return {};
  wchar_t key[64];
  swprintf(key, 64, L"\\StringFileInfo\\%04x%04x\\FileDescription", langs[0].lang, langs[0].codepage);
  wchar_t *desc = nullptr;
  UINT chars = 0;
  if (!VerQueryValueW(data.data(), key, (void **)&desc, &chars) || !desc || !chars) return {};
  std::wstring s(desc);
  while (!s.empty() && iswspace(s.back())) s.pop_back();
  return s;
}

/** UWP 应用的顶层窗口属于 ApplicationFrameHost.exe：找出里面真正的应用进程 */
static DWORD UwpChildPid(HWND frame, DWORD framePid) {
  struct Ctx { DWORD framePid, found; } ctx{framePid, 0};
  EnumChildWindows(
      frame,
      [](HWND child, LPARAM lp) -> BOOL {
        auto *c = (Ctx *)lp;
        DWORD pid = 0;
        GetWindowThreadProcessId(child, &pid);
        if (pid && pid != c->framePid) {
          c->found = pid;
          return FALSE;
        }
        return TRUE;
      },
      (LPARAM)&ctx);
  return ctx.found;
}

static int PrintFrontApp() {
  HWND hwnd = GetForegroundWindow();
  DWORD pid = 0;
  if (hwnd) GetWindowThreadProcessId(hwnd, &pid);
  std::wstring path = pid ? ExePath(pid) : L"";
  if (!path.empty() && Lower(FileName(path)) == L"applicationframehost.exe") {
    if (DWORD child = UwpChildPid(hwnd, pid)) {
      pid = child;
      path = ExePath(pid);
    }
  }
  if (!pid || path.empty()) {
    WriteStdout("{}\n");
    return 0;
  }
  std::wstring exe = FileName(path);
  std::wstring name = FileDescription(path);
  if (name.empty()) name = exe.size() > 4 && Lower(exe.substr(exe.size() - 4)) == L".exe" ? exe.substr(0, exe.size() - 4) : exe;
  WriteStdout("{\"bundleId\":" + JsonString(WideToUtf8(Lower(exe))) + ",\"name\":" + JsonString(WideToUtf8(name)) +
              ",\"pid\":" + std::to_string(pid) + "}\n");
  return 0;
}

/** 该进程最上层的可见主窗口（没有所有者的顶层窗口，按 Z 序第一个） */
static HWND MainWindowOf(DWORD pid) {
  struct Ctx { DWORD pid; HWND found; } ctx{pid, nullptr};
  EnumWindows(
      [](HWND h, LPARAM lp) -> BOOL {
        auto *c = (Ctx *)lp;
        DWORD p = 0;
        GetWindowThreadProcessId(h, &p);
        if (p != c->pid || !IsWindowVisible(h) || GetWindow(h, GW_OWNER)) return TRUE;
        c->found = h;
        return FALSE;
      },
      (LPARAM)&ctx);
  return ctx.found;
}

static int Activate(DWORD pid) {
  HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!proc) return 2;
  CloseHandle(proc);
  HWND target = MainWindowOf(pid);
  if (!target) return 4;
  if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
  // 前台锁：只有当前前台线程才能随意切换前台窗口——临时把输入队列挂到前台线程上再切换
  HWND fg = GetForegroundWindow();
  DWORD fgThread = fg ? GetWindowThreadProcessId(fg, nullptr) : 0;
  DWORD self = GetCurrentThreadId();
  bool attached = fgThread && fgThread != self && AttachThreadInput(self, fgThread, TRUE);
  SetForegroundWindow(target);
  BringWindowToTop(target);
  SetFocus(target);
  if (attached) AttachThreadInput(self, fgThread, FALSE);
  return GetForegroundWindow() == target ? 0 : 4;
}

int wmain(int argc, wchar_t **argv) {
  if (argc == 1) return PrintFrontApp();
  if (argc == 3 && wcscmp(argv[1], L"--activate") == 0) {
    wchar_t *end = nullptr;
    unsigned long pid = wcstoul(argv[2], &end, 10);
    if (!pid || (end && *end)) return 2;
    return Activate((DWORD)pid);
  }
  if (argc == 2 && wcscmp(argv[1], L"--selected-text") == 0) return 5;
  if (argc == 4 && wcscmp(argv[1], L"--caret-context") == 0) return 5;
  fputs("usage: mt-focus [--activate <pid> | --selected-text | --caret-context <before> <after>]\n", stderr);
  return 2;
}
