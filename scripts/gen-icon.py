#!/usr/bin/env python3
"""生成 MyTypeless 应用图标。

标志取自 build/icon-source.png（白底黑色 “MT” 立方体标志，用户提供的原创设计），
放进 macOS 标准图标栅格（1024 画布、824 主体、连续曲率圆角、柔和投影）：
近白微灰渐变底 + 深色标志。4 倍超采样后缩小，保证边缘平滑。
"""
import os

import numpy as np
from PIL import Image, ImageFilter

SS = 4  # 超采样倍数
SIZE = 1024
S = SIZE * SS
BODY = 824 * SS  # 主体边长（macOS 图标栅格）
OFF = (S - BODY) // 2
LOGO = 0.60  # 标志外接框长边占主体边长的比例

here = os.path.dirname(__file__)
out_dir = os.path.join(here, "..", "build")


def superellipse_mask(size: int, n: float = 4.6) -> Image.Image:
    """连续曲率圆角方块（超椭圆）蒙版"""
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    u = np.abs((xs + 0.5) / size * 2 - 1)
    v = np.abs((ys + 0.5) / size * 2 - 1)
    inside = (u**n + v**n) <= 1.0
    return Image.fromarray((inside * 255).astype(np.uint8), "L")


def lerp(a, b, t):
    return a + (b - a) * t


# —— 底：近白对角渐变 ——
ys, xs = np.mgrid[0:BODY, 0:BODY].astype(np.float32) / BODY
t = np.clip(xs * 0.35 + ys * 0.75, 0, 1)[..., None]
top = np.array([255, 255, 255], np.float32)
bottom = np.array([226, 228, 234], np.float32)  # 微冷灰
rgb = lerp(top, bottom, t)
body = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
mask = superellipse_mask(BODY)
body.putalpha(mask)

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 投影：主体蒙版下移、模糊
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
shadow_alpha = Image.new("L", (S, S), 0)
shadow_alpha.paste(mask, (OFF, OFF + 10 * SS))
shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(14 * SS)).point(lambda a: int(a * 0.32))
shadow.putalpha(shadow_alpha)
canvas.alpha_composite(shadow)
canvas.alpha_composite(body, (OFF, OFF))

# 主体内缘一圈细描边，白底在浅色桌面上也有轮廓
rim = Image.new("RGBA", (BODY, BODY), (0, 0, 0, 0))
inner = superellipse_mask(BODY - 4 * SS)
hole = Image.new("L", (BODY, BODY), 0)
hole.paste(inner, (2 * SS, 2 * SS))
rim_alpha = Image.fromarray((np.array(mask, np.int16) - np.array(hole, np.int16)).clip(0, 255).astype(np.uint8))
rim.putalpha(rim_alpha.point(lambda a: int(a * 0.10)))
canvas.alpha_composite(rim, (OFF, OFF))

# —— 标志：源图深色像素即标志，裁到外接框后居中 ——
src = Image.open(os.path.join(out_dir, "icon-source.png")).convert("L")
alpha = src.point(lambda v: 255 - v)  # 白底黑字 → 黑处不透明
bbox = alpha.point(lambda a: 255 if a > 128 else 0).getbbox()
alpha = alpha.crop(bbox)
scale = BODY * LOGO / max(alpha.size)
logo_size = (round(alpha.size[0] * scale), round(alpha.size[1] * scale))
alpha = alpha.resize(logo_size, Image.LANCZOS)
logo = Image.new("RGBA", logo_size, (22, 24, 30, 0))
logo.putalpha(alpha)
lx = (S - logo_size[0]) // 2
ly = (S - logo_size[1]) // 2
canvas.alpha_composite(logo, (lx, ly))

img = canvas.resize((SIZE, SIZE), Image.LANCZOS)

os.makedirs(out_dir, exist_ok=True)
img.save(os.path.join(out_dir, "icon.png"))

# iconutil 需要 iconset
iconset = os.path.join(out_dir, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
for sz in [16, 32, 64, 128, 256, 512, 1024]:
    img.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset, f"icon_{sz}x{sz}.png"))
    if sz <= 512:
        img.resize((sz * 2, sz * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{sz}x{sz}@2x.png"))
print("icon.png + iconset →", out_dir)
