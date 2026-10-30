"""生成海景动画用的蒙版。

- 实验页插画（scenes/）：灰度图，白色 = 可以流动的海水。
- 首页插画（hero/）：RGB 图，R = 海水、G = 可轻摆的枝叶、B = 可缓慢漂移的天空与云。

蒙版按颜色和手工划定的区域估算，再做去噪和柔化，供 WebGL 限制每种动效只出现在对应位置；
建筑、石阶、矮墙、猫、桌椅等都排除在外，保持静止。
用法：python scripts/make-sea-masks.py   （需要 Pillow）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-resources/qiyu-dev-art-assets-v1/qiyu-dev-art-assets/assets"
OUT = ROOT / "site/assets"


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# 多边形坐标都按图片宽高的 0–1 比例书写。
# water_exclude：颜色像海水、但其实是建筑或船帆的地方。
# foliage：允许轻摆的枝叶所在区域（区域内再按颜色挑出绿叶和柠檬）；static：始终静止的区域。
# sky：天空与云所在区域（山脊线以上），区域内的枝叶会被剔除。
SCENES = {
    "scenes/sea-watercolor-desktop": {"horizon": 0.462, "width": 560},
    "scenes/sea-watercolor-mobile": {"horizon": 0.482, "width": 320},
    "hero/hero-seaside-desktop": {
        "horizon": 0.436,
        "width": 600,
        "water_exclude": [
            [(0, 0.43), (0.24, 0.43), (0.24, 1), (0, 1)],  # 左侧房屋、藤架
            [(0.2, 0.62), (0.28, 0.68), (0.66, 0.79), (0.67, 1), (0.2, 1)],  # 石阶与矮墙
            [(0.67, 0.43), (1, 0.43), (1, 0.56), (0.8, 0.56), (0.74, 0.505), (0.67, 0.505)],  # 右侧小镇与码头
            [(0.664, 0.5), (0.688, 0.6), (0.688, 0.64), (0.645, 0.64), (0.645, 0.6)],  # 近处帆船
            rect(0.5, 0.455, 0.528, 0.52),  # 远处帆船
            rect(0.577, 0.45, 0.59, 0.48),
        ],
        "foliage": [
            rect(0, 0, 0.5, 0.38),  # 藤架上的柠檬枝
            rect(0, 0.38, 0.26, 1),  # 左墙藤蔓与盆栽橄榄
            [(0.22, 0.55), (0.62, 0.55), (0.66, 0.79), (0.28, 0.68)],  # 矮墙上方的灌木
            [(0.66, 0.7), (1, 0.66), (1, 1), (0.67, 1)],  # 右下角灌木
        ],
        "static": [
            [(0.2, 0.62), (0.28, 0.68), (0.66, 0.79), (0.67, 1), (0.2, 1)],  # 石阶与矮墙
            rect(0.06, 0.55, 0.23, 0.86),  # 桌椅
            rect(0.32, 0.64, 0.42, 0.73),  # 猫
            rect(0.03, 0.2, 0.1, 0.5),  # 窗户
        ],
        "sky": [
            [(0.17, 0), (1, 0), (1, 0.22), (0.9, 0.26), (0.8, 0.29), (0.7, 0.34), (0.6, 0.37),
             (0.5, 0.36), (0.4, 0.31), (0.3, 0.26), (0.2, 0.23), (0.17, 0.2)],
        ],
        "sky_exclude": [rect(0.79, 0.26, 0.835, 0.46)],  # 灯塔
    },
    "hero/hero-seaside-mobile-crop": {
        "horizon": 0.437,
        "width": 300,
        "water_exclude": [
            [(0, 0.43), (0.26, 0.43), (0.26, 0.53), (0, 0.6)],  # 左侧房屋与海岸
            [(0, 0.6), (0.55, 0.68), (1, 0.74), (1, 1), (0, 1)],  # 石阶与矮墙
            [(0.722, 0.455), (0.752, 0.505), (0.752, 0.522), (0.7, 0.522), (0.7, 0.505)],  # 帆船
            rect(0.905, 0.45, 0.925, 0.475),
            rect(0.9, 0.485, 1, 0.51),  # 码头
        ],
        "foliage": [
            rect(0, 0, 0.62, 0.37),  # 柠檬枝
            [(0, 0.47), (1, 0.52), (1, 0.75), (0.55, 0.68), (0, 0.6)],  # 矮墙上方的灌木
        ],
        "static": [
            [(0, 0.6), (0.55, 0.68), (1, 0.74), (1, 1), (0, 1)],  # 石阶与矮墙
            rect(0.08, 0.44, 0.27, 0.53),  # 左侧房屋
            rect(0.22, 0.64, 0.42, 0.72),  # 猫
        ],
        "sky": [
            [(0, 0), (1, 0), (1, 0.4), (0.8, 0.39), (0.6, 0.37), (0.45, 0.36), (0.3, 0.32),
             (0.15, 0.29), (0, 0.29)],
        ],
        "sky_exclude": [],
    },
}


def is_water(r: int, g: int, b: int) -> bool:
    # 礁石、植物、沙色都偏暖（红 ≥ 蓝）；海水偏蓝或青，浪花接近白色且不偏暖
    if min(r, g, b) > 205 and r - b < 20:  # 高光处的白色浪花
        return True
    if b < r - 6:
        return False
    return b > r + 22 or min(r, g, b) > 188


def is_leaf(r: int, g: int, b: int) -> bool:
    # 绿叶和黄柠檬：饱和、偏绿黄；石墙（低饱和米白）、木头、陶盆（偏红）都不算
    return max(r, g, b) - min(r, g, b) > 45 and g > b + 35 and g >= r * 0.86


def polygons(draw, polys, size, fill):
    w, h = size
    for poly in polys:
        draw.polygon([(x * w, y * h) for x, y in poly], fill=fill)


def region(size, include, exclude=()):
    img = Image.new("L", size, 0)
    draw = ImageDraw.Draw(img)
    polygons(draw, include, size, 255)
    polygons(draw, exclude, size, 0)
    return img


def by_color(small, test, area):
    out = Image.new("L", small.size, 0)
    src, dst, inside = small.load(), out.load(), area.load()
    for y in range(small.height):
        for x in range(small.width):
            if inside[x, y] and test(*src[x, y]):
                dst[x, y] = 255
    return out


def main() -> None:
    for name, cfg in SCENES.items():
        width = cfg["width"]
        with Image.open(SRC / f"{name}.webp") as im:
            height = round(im.height * width / im.width)
            small = im.convert("RGB").resize((width, height), Image.LANCZOS)
        size = small.size

        below = region(size, [rect(0, cfg["horizon"] + 1 / height, 1, 1)], cfg.get("water_exclude", []))
        water = by_color(small, is_water, below)
        water = water.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MinFilter(3))
        water = water.filter(ImageFilter.GaussianBlur(1.6))

        if "foliage" not in cfg:
            out = water
        else:
            leaf_area = region(size, cfg["foliage"], cfg["static"])
            leaves = by_color(small, is_leaf, leaf_area)
            leaves = leaves.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MaxFilter(3))
            # 静止区域再收一圈，避免柔化后的边缘拖动墙面、桌椅
            guard = region(size, cfg["static"]).filter(ImageFilter.MaxFilter(5))
            leaves = Image.composite(Image.new("L", size, 0), leaves, guard)
            leaves = leaves.filter(ImageFilter.GaussianBlur(1.2))

            sky_area = region(size, cfg["sky"], cfg["sky_exclude"])
            # 天空里挂着的枝叶不随云漂移，周围留出缓冲
            leaf_near = by_color(small, is_leaf, sky_area).filter(ImageFilter.MaxFilter(9))
            sky = Image.composite(Image.new("L", size, 0), sky_area, leaf_near)
            sky = sky.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(6))
            out = Image.merge("RGB", (water, leaves, sky))

        dest = OUT / f"{name}-mask.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        out.save(dest, optimize=True)
        print("mask", dest.relative_to(ROOT), out.size, out.mode)


if __name__ == "__main__":
    main()
