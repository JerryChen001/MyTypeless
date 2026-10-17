import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // 构建号与提交（scripts/dist.cjs 设置；开发运行时为 dev）
    define: {
      __MT_BUILD__: JSON.stringify(process.env.MT_BUILD ?? 'dev'),
      __MT_COMMIT__: JSON.stringify(process.env.MT_COMMIT ?? 'dev')
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    // 固定 IPv4：Windows 上 localhost 可能只解析到 ::1，Electron 按 127.0.0.1 连接会被拒绝
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: {
        input: {
          'floating-bar': resolve(__dirname, 'src/renderer/floating-bar/index.html'),
          'answer-card': resolve(__dirname, 'src/renderer/answer-card/index.html'),
          hub: resolve(__dirname, 'src/renderer/hub/index.html')
        }
      }
    }
  }
})
