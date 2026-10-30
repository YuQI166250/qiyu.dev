# 「海边小世界」环境音预处理：把 art-resources/audio 里的三段原始 WAV 整理成三份单声道母带，
# 之后再压缩成 site/assets/audio/ 下的小文件：Opus/WebM（Chrome WebCodecs 编码，约 24–40kbps 单声道）
# 和 AAC/M4A 备用版（Windows 自带的 Media Foundation 编码器，96kbps 单声道）。
#
#   python scripts/make-ambience.py <输出目录>
#
# - 海浪：原素材本身就是无缝循环，只做响度整理；首尾各多放 1 秒循环内容，
#   这样编码器在开头多出的几十毫秒不会影响循环点（播放时用 loopStart/loopEnd 跳过这两段）。
# - 海风：原录音几乎全是风吹话筒的低频轰鸣，先切掉 80Hz 以下，再用很慢的压缩把阵风压平一些，
#   轻轻压低 2.5–6kHz 里零星的小鸟，免得和海鸥抢；取一段较平稳的部分做交叉淡化循环。
# - 海鸥：挑出几组清楚的远处鸣叫，切掉低频底噪；每组都保留叫声自己慢慢变弱的尾巴，
#   在尾巴上再做一段长淡出，听起来像飞远了，而不是被掐断。中间隔 1 秒静音拼成一份“音效表”。
import json, sys, wave
from pathlib import Path
import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art-resources' / 'audio'
SR = 48000
PAD = 1.0  # 循环文件首尾各多放的秒数


def read(path):
    with wave.open(str(path), 'rb') as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert sw == 3, f'{path.name}: expected 24-bit'
    b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
    x = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
    x = np.where(x >= 1 << 23, x - (1 << 24), x) / float(1 << 23)
    x = x.reshape(-1, ch)
    if sr != SR:
        x = signal.resample_poly(x, SR, sr, axis=0)
    return x


def write(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def peak_to(x, db):
    return x * (10 ** (db / 20) / np.abs(x).max())


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)


def padded_loop(x):
    p = int(PAD * SR)
    return np.concatenate([x[-p:], x, x[:p]])


def waves():
    x = read(SRC / '海浪音频.wav')[:, 0]
    x = x - x.mean()
    return padded_loop(peak_to(x, -1.0))


def wind(start=21.0, length=36.0, fade=4.0):
    x = read(SRC / '海风音频.wav')
    x = signal.sosfiltfilt(signal.butter(2, 80, 'highpass', fs=SR, output='sos'), x, axis=0)
    x = x[:, 0]  # 两个声道几乎反相，相加会互相抵消；只取左声道
    # 压低零星鸟鸣
    b, a = signal.iirpeak(4000, 0.8, fs=SR)
    x = x - 0.7 * signal.filtfilt(b, a, x)
    # 很慢的压缩：包络取 1.5 秒滑动均方根，高于中位数的部分按 2.5:1 压下去
    k = int(1.5 * SR)
    c = np.concatenate([[0], np.cumsum(x ** 2)])
    lo = np.clip(np.arange(len(x)) - k // 2, 0, len(x)); hi = np.clip(lo + k, 0, len(x))
    env = np.sqrt((c[hi] - c[lo]) / (hi - lo)) + 1e-9
    ref = np.median(env)
    over = np.maximum(env / ref, 1)
    x = x / over ** (1 - 1 / 2.5)
    # 交叉淡化成循环：取 [start, start+length+fade)，把尾部 fade 秒等功率混进开头
    s, n, f = int(start * SR), int(length * SR), int(fade * SR)
    seg = x[s:s + n + f].copy()
    t = np.linspace(0, np.pi / 2, f)
    seg[:f] = seg[:f] * np.sin(t) + seg[n:n + f] * np.cos(t)
    loop = seg[:n]
    return padded_loop(peak_to(loop, -1.0))


# 海鸥：几组远处的鸣叫在原录音里的 [开始, 开始淡出, 结束]（秒），按 0.9–3.5kHz 频段逐 0.1 秒的能量看过。
# 不在叫声中间下刀：每组都放到叫声自己减弱之后，再用 1 秒多的淡出收尾。
GULL_CALLS = [
    (0.0, 1.9, 3.3),    # 两声短促的叫
    (6.3, 10.6, 12.3),  # 一串由近到远、越叫越轻的
    (16.8, 20.6, 22.2), # 一阵热闹的群鸣，最后慢慢散开
]


def gulls():
    x = read(SRC / '海鸥音频.wav').mean(1)
    x = signal.sosfiltfilt(signal.butter(3, 550, 'highpass', fs=SR, output='sos'), x)
    gap = np.zeros(SR)
    parts, clips, t = [gap], [], 1.0
    for a, fade, b in GULL_CALLS:
        c = x[int(a * SR):int(b * SR)].copy()
        fi, fo = int(0.35 * SR), int((b - fade) * SR)
        c[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi)) ** 2
        c[-fo:] *= np.linspace(1, 0, fo) ** 2.2  # 前快后慢地收，尾音像是越飘越远
        parts += [c, gap]
        clips.append([round(t, 3), round(len(c) / SR, 3)])
        t += len(c) / SR + 1.0
    sprite = np.concatenate(parts)
    return peak_to(sprite, -1.0), clips


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    w, v = waves(), wind()
    g, clips = gulls()
    for name, x in (('sea-waves', w), ('sea-wind', v), ('sea-gulls', g)):
        write(out / f'{name}.wav', x)
        print(f'{name}: {len(x) / SR:.2f}s  rms {rms_db(x):.1f} dBFS')
    meta = {'pad': PAD, 'waves': round(len(w) / SR - 2 * PAD, 4), 'wind': round(len(v) / SR - 2 * PAD, 4), 'gulls': clips}
    (out / 'ambience.json').write_text(json.dumps(meta))
    print(json.dumps(meta))
