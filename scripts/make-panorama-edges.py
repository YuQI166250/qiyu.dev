"""生成首页海景的水彩边缘遮罩（CSS mask 用的透明 PNG）。

遮罩作用在整个海景图层上（底图、WebGL 画布、飞过的海鸥一起），中间完全不透明、保持原画清晰，
只有四周按「手刷水彩」的不规则边缘渐隐进米白纸面：上沿留得最宽，向标题区自然晕开。
用法：python scripts/make-panorama-edges.py   （需要 Pillow 和 numpy）
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site/assets/hero"

# 名称: (宽, 高, 左右羽化占宽度比例, 上沿羽化占高度比例, 下沿羽化占高度比例, 随机种子)
# 左右只留很窄的柔边，尽量保住房屋、山体和植物；上下沿用较宽、不均匀的晕染
EDGES = {
    "panorama-edge-desktop": (1200, 511, 0.04, 0.24, 0.2, 7),
    "panorama-edge-mobile": (480, 600, 0.035, 0.15, 0.15, 11),
}


def smooth_noise(h, w, cells, rng):
    """把一小格随机数放大成平滑起伏的噪声，范围约 -1..1。"""
    small = rng.random((cells[0], cells[1])).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 127.5 - 1


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def make(w, h, side, top, bottom, seed):
    rng = np.random.default_rng(seed)
    v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    u /= w - 1
    v /= h - 1
    # 低频决定边缘的大致起伏，中频加一点水彩洇开的不规则
    wobble = smooth_noise(h, w, (7, 9), rng) * 0.7 + smooth_noise(h, w, (14, 26), rng) * 0.3
    wobble2 = smooth_noise(h, w, (8, 10), rng) * 0.7 + smooth_noise(h, w, (16, 30), rng) * 0.3

    # 起伏只把边缘往里推（0..1），保证图片最外一圈完全透明，不会留下硬边
    inward = np.clip(wobble * 0.5 + 0.5, 0, 1)
    inward2 = np.clip(wobble2 * 0.5 + 0.5, 0, 1)
    left = smoothstep((u - inward * side * 0.6) / (side * 0.7))
    right = smoothstep((1 - u - inward2 * side * 0.6) / (side * 0.7))
    # 上下沿起伏更大，像水彩自然洇开的不均匀边
    upper = smoothstep((v - inward2 * top * 0.55) / (top * 0.6))
    lower = smoothstep((1 - v - inward * bottom * 0.55) / (bottom * 0.6))
    alpha = left * right * upper * lower
    # 内部保持完全不透明：只有接近边缘的部分才变淡
    alpha = np.clip(alpha * 1.04, 0, 1)

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (alpha * 255).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (w, h, side, top, bottom, seed) in EDGES.items():
        img = make(w, h, side, top, bottom, seed)
        dest = OUT / f"{name}.png"
        img.save(dest, optimize=True)
        print("edge", dest.relative_to(ROOT), img.size)


if __name__ == "__main__":
    main()
