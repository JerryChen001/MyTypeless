// Windows 原生助手共用：UTF-8 / UTF-16 转换、二进制 stdin/stdout、base64、JSON 字符串转义（原创）
#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <string.h>
#include <string>

inline std::wstring Utf8ToWide(const std::string &s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
  return w;
}

inline std::string WideToUtf8(const std::wstring &w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

/** 读完 stdin（二进制模式：不做换行转换） */
inline std::string ReadAllStdin() {
  _setmode(_fileno(stdin), _O_BINARY);
  std::string data;
  char buf[65536];
  size_t got;
  while ((got = fread(buf, 1, sizeof buf, stdin)) > 0) data.append(buf, got);
  return data;
}

/** 原样写 stdout（二进制模式：\n 不会变成 \r\n） */
inline void WriteStdout(const std::string &s) {
  _setmode(_fileno(stdout), _O_BINARY);
  fwrite(s.data(), 1, s.size(), stdout);
  fflush(stdout);
}

static const char kBase64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

inline std::string Base64Encode(const std::string &in) {
  std::string out;
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    unsigned v = ((unsigned char)in[i] << 16) | ((unsigned char)in[i + 1] << 8) | (unsigned char)in[i + 2];
    out += kBase64[v >> 18];
    out += kBase64[(v >> 12) & 63];
    out += kBase64[(v >> 6) & 63];
    out += kBase64[v & 63];
  }
  if (i < in.size()) {
    unsigned v = (unsigned char)in[i] << 16;
    if (i + 1 < in.size()) v |= (unsigned char)in[i + 1] << 8;
    out += kBase64[v >> 18];
    out += kBase64[(v >> 12) & 63];
    out += i + 1 < in.size() ? kBase64[(v >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

/** 解码失败（含非法字符）返回 false */
inline bool Base64Decode(const std::string &in, std::string &out) {
  out.clear();
  unsigned v = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=') break;
    const char *p = c ? strchr(kBase64, c) : nullptr;
    if (!p) return false;
    v = (v << 6) | (unsigned)(p - kBase64);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += (char)((v >> bits) & 0xff);
    }
  }
  return true;
}

/** UTF-8 字符串 → JSON 字符串字面量（带引号） */
inline std::string JsonString(const std::string &s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char esc[8];
          snprintf(esc, sizeof esc, "\\u%04x", c);
          out += esc;
        } else {
          out += (char)c;
        }
    }
  }
  return out + "\"";
}
