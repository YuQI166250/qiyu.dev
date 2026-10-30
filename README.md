# qiyu.dev

一些有趣的小东西：一片会动的水彩海，和一些慢慢长出来的奇思妙想。

纯静态网站，HTML + CSS + 少量原生 JavaScript，无依赖、无构建步骤，通过 GitHub Actions 发布到 GitHub Pages。

## 目录

- `site/`：发布目录，即网站本身。
  - `index.html`、`styles.css`：首页。
  - `hero-water.js`：海景的 WebGL 动效（海面流动、指针水波与涟漪、枝叶轻摆、云朵漂移、帆船摇晃、偶尔飞过的海鸥）。
  - `postcard.js`：旅行手账里明信片的翻面互动。
  - `assets/`：插画与素材。
- `scripts/`：素材处理脚本（生成响应式图片、动效蒙版、水彩边缘遮罩）。它们读取的原始美术素材不在本仓库中。
- `server.mjs`：本地预览服务器。
- `.github/workflows/pages.yml`：部署到 GitHub Pages。

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
