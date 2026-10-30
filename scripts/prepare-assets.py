"""把首页用到的美术素材从 art-resources 复制到 site/assets，并生成较小的响应式版本。

第三批（V3）透明素材另做修整：裁掉相邻物件的碎片，清除纸张四周残留的底色，再存为带透明通道的 WebP。
原始素材目录保持不变。重复运行会覆盖 site/assets 中生成的文件。
用法：python scripts/prepare-assets.py   （需要 Pillow）
"""
from collections import deque
from pathlib import Path
import shutil

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-resources/qiyu-dev-art-assets-v1/qiyu-dev-art-assets/assets"
SRC_V3 = ROOT / "art-resources/qiyu-watercolor-assets-v3/assets/ready"
OUT = ROOT / "site/assets"

# 原样复制的文件
COPY = [
    "hero/hero-seaside-desktop.webp",
    "hero/hero-seaside-mobile-crop.webp",
    "covers/sea-cover.webp",
    "covers/breeze-cover-temp.webp",
    "decor/lemon-branch.png",
    "decor/seagull.png",
    "decor/sailboat.png",
    "decor/watercolor-cloud.png",
    "scenes/sea-watercolor-desktop.webp",
    "scenes/sea-watercolor-mobile.webp",
]

# 额外生成的缩小版本：(源文件, 目标宽度)
RESIZE = [
    ("hero/hero-seaside-desktop.webp", 1200),
    ("covers/sea-cover.webp", 800),
    ("covers/breeze-cover-temp.webp", 800),
]

# V3 素材：(源文件, 输出文件, 裁切框或 None, 是否清除边缘底色)
# 裁切框用来去掉拼版时压进来的相邻物件；清除底色从图片边缘向内泛洪，遇到纸张较深的毛边即停止。
V3 = [
    ("travel/coastal-postcard.png", "journal/postcard.webp", (6, 0, 385, 280), True),
    ("travel/folded-map.png", "journal/map.webp", (14, 0, 373, 444), True),
    ("travel/blue-washi-tape.png", "journal/washi-tape.webp", None, False),
    ("ocean/standing-seagull.png", "decor/perched-gull.webp", (0, 0, 240, 194), False),  # 只留到脚下，见 feet_only
]


def feet_only(im: Image.Image, below: int = 166) -> Image.Image:
    """海鸥脚下原本是一块礁石：从脚踝往下只保留橙色的脚，让它能直接站在画里的矮墙上。"""
    px = im.load()
    for y in range(below, im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and not (r > g + 30 and g > b + 20):
                px[x, y] = (r, g, b, 0)
    return im


def solid_body(im: Image.Image, paper=(250, 246, 236), legs: int = 140) -> Image.Image:
    """拆图时白色羽毛被当成纸底去掉了一半：在身体轮廓内把海鸥垫回到暖白纸色上（就像它原本画在纸上），
    轮廓外缘仍保留原来的水彩柔边。"""
    w, h = im.size
    shape = im.getchannel("A").point(lambda v: 255 if v > 30 else 0)
    shape = shape.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))  # 闭合胸口等较大的缺口
    outside = bytearray(w * h)
    px = shape.load()
    queue = deque((x, y) for x in range(w) for y in (0, h - 1))
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if outside[i] or px[x, y]:
            continue
        outside[i] = 1
        if x > 0: queue.append((x - 1, y))
        if x < w - 1: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y < h - 1: queue.append((x, y + 1))
    body = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in outside))
    body.paste(0, (0, legs, w, h))  # 脚踝以下不补，两腿之间保持透明
    body.paste(0, (0, 0, w, 8))  # 闭运算在图片上沿产生的小白块
    body = body.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.5))

    on_paper = Image.alpha_composite(Image.new("RGBA", im.size, paper + (255,)), im)
    on_paper.putalpha(body)
    return Image.alpha_composite(im, on_paper)


def clear_backdrop(im: Image.Image) -> Image.Image:
    """把从边缘连通、颜色浅且低饱和的残留底色变成透明，并柔化边界。"""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_backdrop(x, y):
        r, g, b, a = px[x, y]
        return a < 40 or (min(r, g, b) > 196 and max(r, g, b) - min(r, g, b) < 36)

    seen = bytearray(w * h)
    queue = deque()
    for x in range(w):
        queue.extend([(x, 0), (x, h - 1)])
    for y in range(h):
        queue.extend([(0, y), (w - 1, y)])
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if seen[i] or not is_backdrop(x, y):
            continue
        seen[i] = 1
        if x > 0: queue.append((x - 1, y))
        if x < w - 1: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y < h - 1: queue.append((x, y + 1))

    keep = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in seen))
    keep = keep.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(ImageChops.darker(im.getchannel("A"), keep))
    return largest_piece(im)


def largest_piece(im: Image.Image) -> Image.Image:
    """只保留面积最大的一块不透明区域，去掉四周零星的碎屑。"""
    w, h = im.size
    solid = im.getchannel("A").point(lambda v: 1 if v > 60 else 0).tobytes()
    label = [0] * (w * h)
    best, best_size, current = 0, 0, 0
    for start in range(w * h):
        if not solid[start] or label[start]:
            continue
        current += 1
        label[start] = current
        stack, size = [start], 0
        while stack:
            i = stack.pop()
            size += 1
            x, y = i % w, i // w
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, i - w, i + w):
                if 0 <= j < w * h and solid[j] and not label[j]:
                    label[j] = current
                    stack.append(j)
        if size > best_size:
            best, best_size = current, size
    piece = Image.frombytes("L", (w, h), bytes(255 if v == best else 0 for v in label))
    piece = piece.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1))
    im.putalpha(ImageChops.darker(im.getchannel("A"), piece))
    return im


def main() -> None:
    for rel in COPY:
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC / rel, dest)
        print("copy  ", rel)

    for rel, width in RESIZE:
        src = SRC / rel
        with Image.open(src) as im:
            height = round(im.height * width / im.width)
            small = im.convert("RGB").resize((width, height), Image.LANCZOS)
            dest = OUT / rel.replace(".webp", f"-{width}.webp")
            small.save(dest, "WEBP", quality=86, method=6)
            print("resize", dest.relative_to(OUT), f"{width}x{height}")

    for rel, out, box, clear in V3:
        with Image.open(SRC_V3 / rel) as im:
            im = im.convert("RGBA")
            if box:
                im = im.crop(box)
            if clear:
                im = clear_backdrop(im)
            if out == "decor/perched-gull.webp":
                im = solid_body(feet_only(im))
            im = im.crop(im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())
            dest = OUT / out
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "WEBP", quality=90, method=6)
            print("v3    ", dest.relative_to(OUT), f"{im.width}x{im.height}")


if __name__ == "__main__":
    main()
