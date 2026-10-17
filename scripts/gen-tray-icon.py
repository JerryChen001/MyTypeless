#!/usr/bin/env python3
"""生成菜单栏托盘模板图（黑色+透明，macOS 自动适配深浅色）：麦克风轮廓。
输出 base64 到 stdout，粘贴进 src/main/tray-icon.ts。"""
from PIL import Image, ImageDraw
import base64, io

S = 4  # 超采样
W = 32  # @2x：16pt
img = Image.new("RGBA", (W * S, W * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
k = (0, 0, 0, 255)
lw = int(2.4 * S)
# 胶囊
d.rounded_rectangle([11 * S, 3 * S, 21 * S, 19 * S], radius=5 * S, fill=k)
# 支架弧线
d.arc([6.5 * S, 8 * S, 25.5 * S, 24 * S], start=0, end=180, fill=k, width=lw)
# 立杆 + 底座
d.line([16 * S, 24 * S, 16 * S, 28 * S], fill=k, width=lw)
d.line([11 * S, 28.5 * S, 21 * S, 28.5 * S], fill=k, width=lw)
img = img.resize((W, W), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, "PNG", optimize=True)
print(base64.b64encode(buf.getvalue()).decode())
