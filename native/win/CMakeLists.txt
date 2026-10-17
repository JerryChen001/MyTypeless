# Windows 原生助手（GAP-008）：由 scripts/build-native-win.cjs 调用，产物复制到 native/bin/mt-*.exe
cmake_minimum_required(VERSION 3.20)
project(mytypeless_native_win CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# 静态链接 C/C++ 运行库：产物只依赖系统 DLL，不需要另装 VC++ 运行库
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_options(/utf-8 /W4 /permissive-)
add_compile_definitions(UNICODE _UNICODE)

add_executable(mt-text text-helper.cpp)
add_executable(mt-focus focus-helper.cpp)
