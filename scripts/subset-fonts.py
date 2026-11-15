"""标题字体子集：只把网站标题里真正用到的字裁出来，生成几十 KB 的网页字体。

标题字体基于「得意黑」（Smiley Sans，SIL OFL 1.1，© atelierAnchor）。原字体有保留名称，
裁剪后的版本按许可证改名为 QiyuTitle，原版权声明和许可证一起放在 site/assets/fonts/ 里。

用法（每次新增或修改文章标题、小标题后，在 build-blog 之后运行一次）：
    node scripts/build-blog.mjs
    python scripts/subset-fonts.py

原字体文件只放在本机的 design/fonts/SmileySans-Oblique.ttf（不进入仓库），
可从 https://github.com/atelier-anchor/smiley-sans/releases 下载。
需要 fontTools（pip install fonttools）。
"""
import html
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
SOURCE = ROOT / 'design' / 'fonts' / 'SmileySans-Oblique.ttf'
OUTPUT = SITE / 'assets' / 'fonts' / 'title-font.woff'
CHARS_FILE = ROOT / 'scripts' / 'title-font-chars.txt'
FAMILY = 'QiyuTitle'

# 用到标题字体的地方：所有 h1～h3，加上首屏的大标题、副标题、侧栏名字等（与 styles.css 末尾的选择器对应）
TAG_RE = re.compile(r'<(h[1-3])\b[^>]*>(.*?)</\1>', re.S)
CLASS_RE = re.compile(r'<(\w+)\b[^>]*class="[^"]*\b(?:masthead-title|lead|post-card-title|post-title|page-title|profile-name|archive-year|comments-title)\b[^"]*"[^>]*>(.*?)</\1>', re.S)
# 常备：ASCII 可见字符和常用中文标点，新标题里出现数字、英文时也不会掉回系统字体
ALWAYS = ''.join(chr(c) for c in range(0x20, 0x7f)) + '，。、：；！？「」『』（）《》〈〉—…·“”‘’'


def collect():
    chars = set(ALWAYS)
    pages = [p for p in SITE.rglob('*.html') if 'lab' not in p.relative_to(SITE).parts]
    for page in pages:
        text = page.read_text(encoding='utf-8')
        for _, inner in TAG_RE.findall(text) + CLASS_RE.findall(text):
            chars.update(html.unescape(re.sub(r'<[^>]+>', '', inner)))
    chars.update('QIYU的海边小世界')  # 顶栏里的网站名写在 blog.js 里
    return ''.join(sorted(c for c in chars if not c.isspace() or c == ' '))


def main():
    if not SOURCE.exists():
        sys.exit(f'找不到原字体：{SOURCE}\n请从 https://github.com/atelier-anchor/smiley-sans/releases 下载 SmileySans-Oblique.ttf 放到这里。')
    text = collect()
    options = subset.Options()
    options.flavor = 'woff'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    font = subset.load_font(str(SOURCE), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    # 按 OFL 的保留名称条款改名（版权声明 nameID 0 保留不动）
    for record in font['name'].names:
        if record.nameID in (1, 16):
            record.string = FAMILY
        elif record.nameID == 4:
            record.string = FAMILY
        elif record.nameID == 6:
            record.string = FAMILY
        elif record.nameID == 3:
            record.string = f'{FAMILY}-subset'
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(OUTPUT), options)
    CHARS_FILE.write_text(text, encoding='utf-8')
    missing = [c for c in text if ord(c) not in TTFont(str(SOURCE)).getBestCmap()]
    print(f'标题字体：{len(text)} 个字，{OUTPUT.stat().st_size / 1024:.1f} KB → {OUTPUT.relative_to(ROOT)}')
    if missing:
        print('原字体里没有这些字，会用系统字体显示：' + ''.join(missing))


if __name__ == '__main__':
    main()
