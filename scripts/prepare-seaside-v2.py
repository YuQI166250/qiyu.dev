"""海边小世界 V2：把黄昏、夜晚两套海景从 art-resources/seaside-v2 压缩到 site/assets/hero，漂流瓶压缩到 site/assets/decor。

两套图与白天插画同一构图、同一尺寸（桌面 1774×887，手机 665×887，手机图按白天手机版的同一位置裁切），
所以白天的动效蒙版、猫咪位置、水彩边缘都可以直接沿用。这里只做有损 WebP 压缩，并为桌面版另出 1200 宽的小图，
与白天的响应式版本一一对应。原始素材目录保持不变；重复运行会覆盖输出。
用法：python scripts/prepare-seaside-v2.py   （需要 Pillow、NumPy、SciPy）
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-resources/seaside-v2"
OUT = ROOT / "site/assets/hero"
QUALITY = 86

for time in ("dusk", "night"):
    desktop = Image.open(SRC / time / f"hero-seaside-desktop-{time}.png").convert("RGB")
    mobile = Image.open(SRC / time / f"hero-seaside-mobile-{time}.png").convert("RGB")
    assert desktop.size == (1774, 887) and mobile.size == (665, 887), time
    outputs = {
        f"hero-seaside-desktop-{time}.webp": desktop,
        f"hero-seaside-desktop-{time}-1200.webp": desktop.resize((1200, 600), Image.LANCZOS),
        f"hero-seaside-mobile-{time}.webp": mobile,
    }
    for name, im in outputs.items():
        im.save(OUT / name, "WEBP", quality=QUALITY, method=6)
        print(f"{name}: {(OUT / name).stat().st_size // 1024} KB")

# ---------- 漂流瓶 ----------
# 原图 1254×1254，瓶身约倾斜 25°。网页上只显示 60–100 像素宽，这里顺时针转 13° 让它更像平躺着漂在海面上，
# 去掉透明边缘外零星的杂点，按瓶子的实际范围裁边，缩到 240 像素宽（够 2 倍屏用）。
# 旋转和缩放都在预乘透明度（RGBa）下进行，半透明边缘不会混进黑边。
import numpy as np
from scipy import ndimage

bottle = Image.open(SRC / "bottle/message-bottle.png").convert("RGBA")
px = np.array(bottle)
alpha = px[..., 3]
labels, _ = ndimage.label(alpha >= 12)
main = labels == np.bincount(labels[labels > 0]).argmax()
keep = ndimage.binary_dilation(main, iterations=3)  # 保留主体边缘的柔和过渡，去掉孤立杂点
px[..., 3] = np.where(keep, alpha, 0)
bottle = Image.fromarray(px).convert("RGBa").rotate(-13, resample=Image.BICUBIC, expand=True)
bottle = bottle.crop(bottle.getchannel("a").point(lambda v: 255 if v >= 4 else 0).getbbox())
w, h = bottle.size
bottle = bottle.resize((240, round(240 * h / w)), Image.LANCZOS).convert("RGBA")
name = OUT.parent / "decor/message-bottle.webp"
bottle.save(name, "WEBP", quality=88, method=6)
print(f"{name.name}: {bottle.size}, {name.stat().st_size // 1024} KB")
