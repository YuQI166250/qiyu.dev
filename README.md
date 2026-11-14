# qiyu.dev

一些有趣的小东西：一片会动的水彩海，和一些慢慢长出来的奇思妙想。

纯静态网站，HTML + CSS + 少量原生 JavaScript，无依赖。文章用 Markdown 写，由一个零依赖的 Node 脚本生成页面，通过 GitHub Actions 发布到 GitHub Pages。

## 目录

- `content/`：文章（`posts/*.md`）和「关于」页（`about.md`）。
- `site/`：发布目录，即网站本身。
  - `index.html`、`styles.css`：首页（海景铺满首屏，大标题、搜索、导航叠在画上；下面是文章列表和侧栏）。文章列表和侧栏的分类、标签由生成脚本填进去。
  - `blog.js`：站内搜索、文章目录高亮、代码块和本文链接的复制、点击图片放大、滚过首屏后出现的顶栏（带阅读进度和回到顶部）。
  - `posts/`、`archives/`、`categories/`、`tags/`、`about/`、`404.html`、`search.json`、`feed.xml`：由 `scripts/build-blog.mjs` 生成，不要手改。
  - `hero-water.js`：海景的 WebGL 动效（海面流动、指针水波与涟漪、枝叶轻摆、云朵漂移、帆船摇晃、偶尔飞过的海鸥）。
  - `postcard.js`：旅行手账里明信片的翻面互动。
  - `ambience.js`：页头「听听海」开关与海边声景（海浪、海风、远处海鸥），默认静音。声音跟着时间变：黄昏海鸥变少、海风变柔，夜里只剩轻柔的浪。
  - `seaside-clock.js`：自动时间模式的时段表（按访客本地时间，边界集中在文件开头），并在页面画出来之前定好首屏的时间。
  - `seaside-time.js`：页头的时间切换（白天、黄昏、夜晚、自动）。海景三幅插画交叉淡化，页面纸色、晕染、手账和页脚海浪的色调一起慢慢过渡；自动模式下页面开着也会到点慢慢换过去。
  - `bottle.js`：漂流瓶彩蛋。停留一两分钟后偶尔有瓶子从海面漂来，点开是一封随机的海边来信。
  - `assets/`：插画与素材。
- `scripts/build-blog.mjs`：博客生成器。
- `scripts/`：其余是素材处理脚本（生成响应式图片、黄昏与夜晚海景、漂流瓶、动效蒙版、水彩边缘遮罩、环境音母带）。它们读取的原始美术素材不在本仓库中。
- `server.mjs`：本地预览服务器。
- `.github/workflows/pages.yml`：部署到 GitHub Pages。

## 写文章

在 `content/posts/` 里新建一个 Markdown 文件，文件名用英文（会成为网址，例如 `my-note.md` → `/posts/my-note/`），开头写上：

```markdown
---
title: 文章标题
date: 2026-11-14
category: 笔记
tags: [JavaScript, 网站]
summary: 一两句摘要（可选）
---

正文……用 <!-- more --> 可以手动划出摘要。
```

然后生成页面并本地预览：

```bash
node scripts/build-blog.mjs
```

推送到 `main` 后，GitHub Actions 也会先运行这个脚本再发布。写了 `draft: true` 的文章不会生成。

## 本地预览

需要 Node.js：

```bash
node server.mjs site
```

然后打开 http://127.0.0.1:4173 。

## 兼容与回退

- 开启系统「减少动态效果」时不播放海景动画，明信片翻面改为淡入淡出。
- 浏览器不支持 WebGL 时显示静态插画，其余功能正常。
- 海景离开可视区域或页面切到后台时停止绘制。
- 黄昏、夜晚两幅海景只在第一次切过去时下载（鼠标移到开关上时会提前下载）；下载失败时停在原来的时间，画面不变，可以再点一次重试。开启「减少动态效果」时直接换图，不做过渡；没有 WebGL 时只换静态插画。
- 漂流瓶只在页面处于前台、海景可见时计时，图片到出现时才下载（约 11KB）。读信时瓶子不会离开；合上后要过几分钟才可能再来。开启「减少动态效果」时瓶子直接出现、直接消失，信纸不做展开动画。
- 默认自动按本地时间选择场景，不取地理位置、不联网查询；手动选了某个时间后，本次浏览中一直停在那里，直到再点「自动」。首屏是黄昏或夜晚时，海景等那幅插画下载好再淡入；下载失败就显示白天。页面在后台时到点不换，回到前台再慢慢换。
- 声音默认静音，点「听听海」后才下载（Opus 约 300KB；浏览器解不了 Opus 时改用 AAC 版本）。页面切到后台时淡出并暂停，回来后继续。切换时间不会打开声音；正在播放时各层在几秒内平滑过渡。

## 声音素材

三段环境音均来自 [Freesound](https://freesound.org)，采用 [CC0 1.0 公有领域贡献](https://creativecommons.org/publicdomain/zero/1.0/) 授权，可自由使用和修改，无须署名；这里仍记录来源以示感谢。网站中的版本经过剪辑、滤波、响度整理和压缩。

| 用途 | 素材 | 作者 | 授权 |
|---|---|---|---|
| 海浪 | [Gentle Ocean Waves Loop](https://freesound.org/people/kkenny101/sounds/852826/) | kkenny101 | CC0 1.0 |
| 海风 | [Sea Breeze Birds Wind.wav](https://freesound.org/people/jordir/sounds/360448/) | jordir | CC0 1.0 |
| 海鸥 | [Seagulls distant.wav](https://freesound.org/people/Ambientsoundapp/sounds/537854/) | Ambientsoundapp | CC0 1.0 |
