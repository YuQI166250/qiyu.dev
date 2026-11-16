// 博客生成器：把 content/ 里的 Markdown 变成 site/ 下的静态页面，零依赖，只需要 Node.js。
// 用法：node scripts/build-blog.mjs
//
// 输入
//   content/posts/*.md   文章。文件名（不含 .md）就是网址：content/posts/hello.md → /posts/hello/
//   content/about.md     「关于」页
//   每篇开头是一段 front matter：
//     ---
//     title: 标题
//     date: 2026-11-14
//     category: 笔记
//     tags: [网站, JavaScript]
//     cover: /assets/...        （可选，文章卡片和文章页顶部的封面）
//     summary: 一两句摘要       （可选；不写就用 <!-- more --> 之前的内容，再不行就用第一段）
//     draft: true               （可选，草稿不生成）
//     ---
//
// 输出
//   site/index.html 里 <!-- blog:posts --> 和 <!-- blog:side --> 之间的文章列表与侧栏（其余部分手写，不动）
//   site/posts/<slug>/、site/archives/、site/categories/、site/tags/、site/about/、site/404.html
//   site/search.json（站内搜索索引）、site/feed.xml（RSS）
// 页头、页脚、侧栏的「关于我」卡片直接从 site/index.html 里取，首页改了这些，其他页面跟着变。
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { highlight } from './highlight.mjs';
import { tex2mathml } from './tex2mathml.mjs';
import { imageSize } from './image-size.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const CONTENT = path.join(ROOT, 'content');
const ORIGIN = 'https://qiyu.dev';
const AUTHOR = 'QIYU';
const SITE_NAME = 'QIYU的海边小世界'; // RSS 用的网站名
const TAB_NAME = 'QIYU'; // 浏览器标签上的名字：「文章标题 · QIYU」
const SITE_URL = 'https://qiyu.dev';
const SHARE_IMAGE = '/assets/share/qiyu-share.jpg'; // 默认分享图（1200×630，海景 + 站名）

// 分享卡片：链接发到 QQ、Discord、Telegram 等地方时显示标题、简介和图片（Open Graph / Twitter Card）。
// 文章有封面时，用封面旁边同名的「-share.jpg」（1200×630，JPEG 兼容性最好）；没有就用默认分享图
const shareImageFor = (cover) => {
  if (!cover) return SHARE_IMAGE;
  const jpg = cover.replace(/\.[a-z]+$/i, '-share.jpg');
  return existsSync(path.join(SITE, jpg)) ? jpg : SHARE_IMAGE;
};
const shareTags = ({ path: url, title, description, image = SHARE_IMAGE, type = 'website', published }) => `
  <link rel="canonical" href="${SITE_URL}${url}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${SITE_URL}${url}">
  <meta property="og:image" content="${SITE_URL}${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">${published ? `
  <meta property="article:published_time" content="${published}">` : ''}
  <meta name="twitter:card" content="summary_large_image">`;
const HOME_LIMIT = 10; // 首页最多列几篇，更早的去归档页看
// 评论：giscus，评论存在仓库的 GitHub Discussions 里，访客用 GitHub 账号登录后留言。
// repoId、categoryId 在 https://giscus.app 填入仓库名后获得；两个都填了才显示评论区。
const GISCUS = {
  repo: 'YuQI166250/qiyu.dev',
  repoId: 'R_kgDOVc7bXg',
  category: 'Announcements',
  categoryId: 'DIC_kwDOVc7bXs4DLJEl',
};
const GENERATED = ['posts', 'archives', 'categories', 'tags', 'about']; // 每次重建前清空的目录

// ---------- 小工具 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const anchor = (prefix, name) => `${prefix}-${String(name).trim().replace(/\s+/g, '-')}`;
const CJK = /[　-ヿ㐀-鿿＀-￯]/;

function frontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else value = value.replace(/^["']|["']$/g, '');
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    meta[kv[1]] = value;
  }
  return { meta, body: src.slice(m[0].length) };
}

// ---------- Markdown（够写博客的一小部分语法） ----------
// 段落、标题（# 和 ## 都是二级标题）、引用、有序/无序列表、代码块、表格、分隔线、单独一行的图片（带说明文字），
// 行内：`代码`、**粗体**、*斜体*、~~删除线~~、[链接](网址)、![图片](网址)、$公式$、行尾两个空格换行。
// 图片：滚到附近才加载、在后台解码；站内的图片读出宽高写上，下载完之前就留好位置，排版不会跳
const img = (src, alt) => {
  const size = src.startsWith('/') && !src.startsWith('//') ? imageSize(path.join(SITE, decodeURI(src))) : null;
  return `<img src="${src}" alt="${alt}"${size ? ` width="${size.width}" height="${size.height}"` : ''} loading="lazy" decoding="async">`;
};
// 公式：$…$ 行内、单独成段的 $$…$$ 居中显示，生成时转成 MathML（scripts/tex2mathml.mjs）；写错了就原样显示源码
const mathHtml = (tex, display) => {
  try {
    return tex2mathml(tex.trim(), display);
  } catch (err) {
    console.warn(`公式没能转换（${err.message}），按原样显示：${tex}`);
    return `<code class="math-raw">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</code>`;
  }
};
// $ 后紧跟非空白、结尾 $ 前也不是空白、后面不接数字，才算公式（「花了 $5 和 $10」不会被误认）
const INLINE_MATH = /(?<![\\$\w])\$(?=\S)([^$\n]*?[^\s\\])\$(?![\w$])/g;
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  s = s.replace(INLINE_MATH, (_, tex) => `\u0000${codes.push(mathHtml(tex, false)) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => img(src, alt));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    /^https?:/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : `<a href="${href}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n/g, '<br>\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
}

// 中文行之间直接相连，英文行之间补一个空格
const joinLines = (lines) => lines.reduce((acc, line) => !acc ? line : acc + (CJK.test(acc.at(-1)) || CJK.test(line[0]) ? '' : ' ') + line, '');

function markdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [], toc = [], used = new Set();
  let i = 0;
  const heading = (level, text) => {
    const html = inline(text);
    let id = stripTags(html).trim().toLowerCase().replace(/[\s/?#&'"<>]+/g, '-').replace(/^-|-$/g, '') || 'section';
    for (let n = 2; used.has(id); n++) id = id.replace(/-\d+$/, '') + '-' + n;
    used.add(id);
    if (level <= 3) toc.push({ level, id, text: stripTags(html) });
    out.push(`<h${level} id="${id}">${html}</h${level}>`);
  };
  const isBlockStart = (l) => /^(```|\$\$|#{1,4}\s|>|\s*([-*+]|\d+\.)\s|\|)/.test(l) || /^(-{3,}|\*{3,})\s*$/.test(l) || /^<!--.*-->\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<!--.*-->\s*$/.test(line)) { i++; continue; } // <!-- more --> 等注释
    let m;
    if ((m = /^```\s*([\w+-]*)/.exec(line))) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      // 按语法上色（scripts/highlight.mjs）；每行是块级元素，不再另加换行
      out.push(`<pre${m[1] ? ` data-lang="${esc(m[1])}"` : ''}><code>${highlight(body.join('\n'), m[1]).map((l) => `<span class="line">${l}</span>`).join('')}</code></pre>`);
      continue;
    }
    if (/^\$\$/.test(line)) { // 单独成段的公式：$$ … $$ 可以写在一行，也可以跨好几行
      const body = [line.replace(/^\$\$/, '')];
      while (!/\$\$\s*$/.test(body.at(-1)) && i + 1 < lines.length) body.push(lines[++i]);
      i++;
      out.push(`<div class="math-block">${mathHtml(body.join('\n').replace(/\$\$\s*$/, ''), true)}</div>`);
      continue;
    }
    if ((m = /^(#{1,4})\s+(.*?)\s*#*$/.exec(line))) { heading(Math.max(2, m[1].length), m[2]); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(body.join('\n')).html}</blockquote>`);
      continue;
    }
    if ((m = /^\s*([-*+]|\d+\.)\s+/.exec(line))) {
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (item && /\d/.test(item[1]) === ordered) { items.push([item[2]]); i++; continue; }
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items.at(-1).push(lines[i].trim()); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(joinLines(it))}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : ''));
      const rows = [];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      const td = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line))) {
      out.push(`<figure>${img(m[2], esc(m[1]))}${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`);
      i++; continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && (!para.length || !isBlockStart(lines[i])); i++) para.push(lines[i].replace(/^\s+/, ''));
    out.push(`<p>${inline(joinLines(para))}</p>`);
  }
  return { html: out.join('\n'), toc };
}

// ---------- 读文章 ----------
const wordCount = (text) => (text.match(/[\u3400-\u9fff]/g) || []).length + (text.match(/[A-Za-z0-9_]+(?:['.-][A-Za-z0-9_]+)*/g) || []).length;
async function loadPosts() {
  const dir = path.join(CONTENT, 'posts');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    const { meta, body } = frontMatter(await readFile(path.join(dir, file), 'utf8'));
    if (meta.draft === true) continue;
    const slug = file.replace(/\.md$/, '');
    if (!/^[\w-]+$/.test(slug)) throw new Error(`文件名只用英文字母、数字和 - _：${file}`);
    if (!meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) throw new Error(`${file} 缺少 title 或 date（格式 2026-11-14）`);
    const { html, toc } = markdown(body);
    const more = body.indexOf('<!-- more -->');
    const lead = more > 0 ? stripTags(markdown(body.slice(0, more)).html) : stripTags(html.split('\n').find((l) => l.startsWith('<p>')) || '');
    posts.push({
      slug, url: `/posts/${slug}/`, title: meta.title, date: meta.date,
      category: meta.category || '未分类', tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
      cover: meta.cover || '', summary: meta.summary || lead.replace(/\s+/g, ' ').trim(), html, toc,
      updated: /^\d{4}-\d{2}-\d{2}$/.test(meta.updated || '') && meta.updated !== meta.date ? meta.updated : '',
      words: wordCount(stripTags(html)),
    });
  }
  return posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

const countBy = (posts, key) => {
  const map = new Map();
  for (const p of posts) for (const v of [].concat(p[key])) map.set(v, (map.get(v) || []).concat(p));
  return [...map].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh'));
};

// ---------- 片段 ----------
const ICON = {
  date: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/></svg>',
  category: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 5.6c0-.9.7-1.6 1.6-1.6h3.4l1.6 2h6.2c.9 0 1.6.7 1.6 1.6v7c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6Z"/></svg>',
  tag: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.2 3.2h6.2l7.4 7.4-6.2 6.2-7.4-7.4Z"/><circle cx="6.8" cy="6.8" r="1.2"/></svg>',
};
const metaLine = (p) => `${ICON.date}<time datetime="${p.date}">${p.date}</time>`
  + `<span class="dot" aria-hidden="true">·</span>${ICON.category}<a href="/categories/#${anchor('c', p.category)}">${esc(p.category)}</a>`
  + (p.tags.length ? `<span class="dot" aria-hidden="true">·</span>${ICON.tag}<span class="post-tags">${p.tags.map((t) => `<a href="/tags/#${anchor('t', t)}">${esc(t)}</a>`).join(' / ')}</span>` : '');

const card = (p) => `<article class="post-card">
  ${p.cover ? `<a class="post-cover" href="${p.url}" tabindex="-1" aria-hidden="true">${img(p.cover, '')}</a>` : ''}
  <div class="post-card-body">
    <h2 class="post-card-title"><a href="${p.url}">${esc(p.title)}</a></h2>
    <p class="post-card-summary">${esc(p.summary)}</p>
    <div class="post-card-foot">
      <p class="post-meta">${metaLine(p)}</p>
      <a class="read-more" href="${p.url}" aria-label="阅读全文：${esc(p.title)}">阅读全文 <span aria-hidden="true">→</span></a>
    </div>
  </div>
</article>`;

// 热门标签：最多 12 个，按文章数分成 1～4 级字号，用得越多字越大
const hotTags = (tags) => {
  const top = tags.slice(0, 12), counts = top.map(([, ps]) => ps.length);
  const min = Math.min(...counts), max = Math.max(...counts);
  const level = (n) => (max === min ? 1 : 1 + Math.round(((n - min) / (max - min)) * 3));
  return top.map(([tag, ps]) => `<a href="/tags/#${anchor('t', tag)}" data-weight="${level(ps.length)}" title="${ps.length} 篇">${esc(tag)}</a>`).join('');
};

const sideCards = (posts) => {
  const cats = countBy(posts, 'category'), tags = countBy(posts, 'tags');
  return `<div class="side-card side-cats">
  <h2 class="side-title"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 5.6c0-.9.7-1.6 1.6-1.6h3.4l1.6 2h6.2c.9 0 1.6.7 1.6 1.6v7c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6Z"/></svg>分类</h2>
  <ul class="side-list">${cats.map(([c, ps]) => `<li><a href="/categories/#${anchor('c', c)}">${esc(c)}</a><span>${ps.length}</span></li>`).join('')}</ul>
</div>
<div class="side-card side-tags">
  <h2 class="side-title"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.2 3.2h6.2l7.4 7.4-6.2 6.2-7.4-7.4Z"/><circle cx="6.8" cy="6.8" r="1.2"/></svg>热门标签</h2>
  <p class="tag-cloud">${hotTags(tags)}</p>
</div>
<div class="side-card side-latest">
  <h2 class="side-title"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.6 1.6"/></svg>最近更新</h2>
  <ul class="side-recent">${posts.slice(0, 5).map((p) => `<li><a href="${p.url}">${esc(p.title)}</a></li>`).join('')}</ul>
</div>`;
};

const tocCard = (toc) => toc.length < 2 ? '' : `<nav class="side-card toc" aria-label="本文目录">
  <h2 class="side-title"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5.5h9.5M7 10h9.5M7 14.5h9.5"/><circle cx="3.8" cy="5.5" r=".6"/><circle cx="3.8" cy="10" r=".6"/><circle cx="3.8" cy="14.5" r=".6"/></svg>本文目录</h2>
  <ol>${toc.map((t) => `<li class="toc-l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol>
</nav>`;

// ---------- 页面外壳：页头、页脚、侧栏卡片都来自首页 ----------
function shellFrom(index) {
  // 首页里的素材是相对路径（assets/...），子页面在 /posts/xxx/ 这样的目录下，统一换成从网站根目录算起
  const rooted = (html) => html.replace(/(src|srcset)="assets\//g, '$1="/assets/').replace(/, assets\//g, ', /assets/');
  const pick = (re, what) => { const m = re.exec(index); if (!m) throw new Error(`site/index.html 里找不到${what}`); return rooted(m[0]); };
  const header = pick(/<header class="site-header[\s\S]*?<\/header>/, '页头');
  const footer = pick(/<footer class="site-footer"[\s\S]*?<\/footer>/, '页脚');
  const defs = pick(/<svg class="tone-defs"[\s\S]*?<\/svg>/, '滤镜定义');
  const masthead = pick(/<!-- blog:masthead -->[\s\S]*?<!-- \/blog:masthead -->/, '标题区')
    .replace(/<h1 class="masthead-title"[^>]*>(.*?)<\/h1>/, '<p class="masthead-title"><a href="/">$1</a></p>')
    .replace(/ aria-current="page"/g, ''); // 首页上的高亮去掉，由各页面自己标
  const profile = pick(/<!-- blog:profile -->[\s\S]*?<!-- \/blog:profile -->/, '「关于我」卡片');
  const picture = pick(/<picture>[\s\S]*?<\/picture>/, '海景插画').replace(/(src|srcset)="assets\//g, '$1="/assets/').replace(/, assets\//g, ', /assets/')
    .replace(/fetchpriority="high"\s*/, '').replace(/alt="[^"]*"/, 'alt=""');

  return ({ title, description, nav, main, side, bodyClass = '', share }) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fbf7ec">
  <meta name="description" content="${esc(description)}">
  <title>${esc(title)}</title>${share ? shareTags({ description, ...share }) : ''}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <link rel="preload" href="/assets/fonts/title-font.woff" as="font" type="font/woff" crossorigin>
  <link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="/feed.xml">
  <script src="/seaside-clock.js"></script>
  <script src="/ambience.js" defer></script>
  <script src="/seaside-time.js" defer></script>
  <script src="/season.js" defer></script>
  <script src="/blog.js" defer></script>
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#main">跳到正文</a>
  ${defs}

  ${header}

  <main id="main">
    <section class="intro hero is-compact">
      ${markNav(masthead, nav)}
      <!-- 矮一些的海景横幅：跟首页同一幅画，跟着时间变 -->
      <figure class="panorama is-full" aria-hidden="true">
        ${picture}<script>(function (p) { if (window.seaClock) return seaClock.showDay(p); p.querySelectorAll("source, img").forEach(function (e) { if (e.dataset.srcset) e.srcset = e.dataset.srcset; if (e.dataset.src) e.src = e.dataset.src; }); })(document.currentScript.previousElementSibling);</script>
        <noscript>${picture.replace(/data-(src|srcset)=/g, '$1=')}</noscript>
      </figure>
    </section>

    <section class="blog shell">
      <div class="blog-main">
${main}
      </div>
      <aside class="blog-side" aria-label="侧栏">
        ${profile}
${side}
      </aside>
    </section>
  </main>

  ${footer}
</body>
</html>
`;
}

const markNav = (html, href) => html.replace(new RegExp(`<a href="${href.replace(/[/]/g, '\\/')}"`), `<a href="${href}" aria-current="page"`);

// ---------- 生成 ----------
const written = [];
async function write(rel, content) {
  const file = path.join(SITE, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  if (rel.endsWith('.html')) written.push(content);
}

// 标题字体（scripts/subset-fonts.py 生成的子集）里有没有缺字：规则与那个脚本一致，缺了就提醒重新生成
async function checkTitleFont(pages) {
  let have;
  try { have = new Set(await readFile(path.join(ROOT, 'scripts', 'title-font-chars.txt'), 'utf8')); } catch { return; }
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
  const tagRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/g;
  const classRe = /<(\w+)\b[^>]*class="[^"]*\b(?:masthead-title|lead|post-card-title|post-title|page-title|profile-name|archive-year|comments-title)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
  const missing = new Set();
  for (const html of pages) {
    for (const re of [tagRe, classRe]) {
      for (const m of html.matchAll(re)) for (const c of strip(m[2])) if (!/\s/.test(c) && !have.has(c)) missing.add(c);
    }
  }
  if (missing.size) console.warn(`标题字体缺 ${missing.size} 个字（${[...missing].join('')}），先用系统字体显示。运行 python scripts/subset-fonts.py 重新生成。`);
}

const posts = await loadPosts();
const indexFile = path.join(SITE, 'index.html');
const indexRaw = await readFile(indexFile, 'utf8');
const crlf = indexRaw.includes('\r\n');
const index = indexRaw.replace(/\r\n/g, '\n');
const page = shellFrom(index);
const side = sideCards(posts);
for (const dir of GENERATED) await rm(path.join(SITE, dir), { recursive: true, force: true });

// 首页：只替换两个标记之间的内容
const homeList = posts.length
  ? posts.slice(0, HOME_LIMIT).map(card).join('\n') + (posts.length > HOME_LIMIT ? `\n<p class="more-posts"><a href="/archives/">更早的文章都在归档里 →</a></p>` : '')
  : '<div class="page-card empty-note"><p>海边还很安静，第一篇文章正在路上。</p></div>';
let home = index
  .replace(/<!-- blog:posts -->[\s\S]*?<!-- \/blog:posts -->/, `<!-- blog:posts -->\n${homeList}\n<!-- /blog:posts -->`)
  .replace(/<!-- blog:side -->[\s\S]*?<!-- \/blog:side -->/, `<!-- blog:side -->\n${side}\n<!-- /blog:side -->`)
  .replace(/<a href="\/"( aria-current="page")?><svg/, '<a href="/" aria-current="page"><svg');
await writeFile(indexFile, crlf ? home.replace(/\n/g, '\r\n') : home);

// 文章页
for (const [k, p] of posts.entries()) {
  const newer = posts[k - 1], older = posts[k + 1];
  const main = `<article class="page-card post">
  <header class="post-header">
    <h1 class="post-title">${esc(p.title)}</h1>
    <p class="post-meta">${metaLine(p)}</p>
    <p class="post-stats">约 ${p.words} 字<span class="dot" aria-hidden="true"> · </span>读完大约 ${Math.max(1, Math.round(p.words / 400))} 分钟${p.updated ? `<span class="dot" aria-hidden="true"> · </span>更新于 <time datetime="${p.updated}">${p.updated}</time>` : ''}</p>
  </header>
  ${p.cover ? img(p.cover, '').replace('<img', '<img class="post-hero"').replace(' loading="lazy"', ' fetchpriority="high"') : ''}
  <div class="prose">
${p.html}
  </div>
  <div class="post-end">
    <p>本文链接：<a href="${ORIGIN}${p.url}">${ORIGIN}${p.url}</a></p>
    <button class="copy-link" type="button" data-copy="${ORIGIN}${p.url}">复制链接</button>
  </div>
  ${older || newer ? `<nav class="post-nav" aria-label="上一篇和下一篇">
    ${older ? `<a class="post-nav-prev" href="${older.url}"><span>上一篇</span>${esc(older.title)}</a>` : '<span></span>'}
    ${newer ? `<a class="post-nav-next" href="${newer.url}"><span>下一篇</span>${esc(newer.title)}</a>` : '<span></span>'}
  </nav>` : ''}
</article>
${GISCUS.repoId && GISCUS.categoryId ? `<section class="page-card comments" id="comments" aria-labelledby="comments-title"
  data-repo="${GISCUS.repo}" data-repo-id="${GISCUS.repoId}" data-category="${GISCUS.category}" data-category-id="${GISCUS.categoryId}">
  <h2 class="comments-title" id="comments-title">评论</h2>
  <p class="comments-note">用 GitHub 账号登录后就能留言。</p>
  <div class="giscus"></div>
</section>` : ''}`;
  await write(`posts/${p.slug}/index.html`, page({ title: `${p.title} · ${TAB_NAME}`, description: p.summary, nav: '', main, side: tocCard(p.toc) || side, bodyClass: 'is-post',
    share: { path: p.url, title: p.title, image: shareImageFor(p.cover), type: 'article', published: p.date } }));
}

// 归档：按年份
const years = countBy(posts.map((p) => ({ ...p, year: p.date.slice(0, 4) })), 'year').sort((a, b) => b[0].localeCompare(a[0]));
await write('archives/index.html', page({
  title: `归档 · ${TAB_NAME}`, description: `${AUTHOR} 的全部文章`, nav: '/archives/', side,
  share: { path: '/archives/', title: `归档 · ${SITE_NAME}` },
  main: `<div class="page-card">
  <h1 class="page-title">归档</h1>
  <p class="page-sub">一共 ${posts.length} 篇，慢慢写。</p>
  ${years.map(([y, ps]) => `<h2 class="archive-year">${y}</h2>
  <ul class="archive-list">${ps.map((p) => `<li><time datetime="${p.date}">${p.date.slice(5)}</time><a href="${p.url}">${esc(p.title)}</a></li>`).join('')}</ul>`).join('\n  ')}
</div>`,
}));

// 分类、标签：一页列出全部，用锚点跳到对应的那一组
const groupPage = (kind, label, prefix, groups) => page({
  title: `${label} · ${TAB_NAME}`, description: `${AUTHOR} 的文章${label}`, nav: `/${kind}/`, side,
  share: { path: `/${kind}/`, title: `${label} · ${SITE_NAME}` },
  main: `<div class="page-card">
  <h1 class="page-title">${label}</h1>
  <p class="tag-cloud page-cloud">${groups.map(([g, ps]) => `<a href="#${anchor(prefix, g)}" data-weight="${Math.min(3, ps.length)}">${prefix === 't' ? '#' : ''}${esc(g)}<span>${ps.length}</span></a>`).join('')}</p>
  ${groups.map(([g, ps]) => `<section class="group" id="${anchor(prefix, g)}">
    <h2 class="archive-year">${prefix === 't' ? '#' : ''}${esc(g)}</h2>
    <ul class="archive-list">${ps.map((p) => `<li><time datetime="${p.date}">${p.date}</time><a href="${p.url}">${esc(p.title)}</a></li>`).join('')}</ul>
  </section>`).join('\n  ')}
</div>`,
});
await write('categories/index.html', groupPage('categories', '分类', 'c', countBy(posts, 'category')));
await write('tags/index.html', groupPage('tags', '标签', 't', countBy(posts, 'tags')));

// 关于
const about = await readFile(path.join(CONTENT, 'about.md'), 'utf8').catch(() => '');
if (about) {
  const { meta, body } = frontMatter(about);
  await write('about/index.html', page({
    title: `${meta.title || '关于'} · ${TAB_NAME}`, description: meta.summary || `关于 ${AUTHOR}`, nav: '/about/', side,
    share: { path: '/about/', title: `${meta.title || '关于'} · ${SITE_NAME}` },
    main: `<article class="page-card post">
  <header class="post-header"><h1 class="post-title">${esc(meta.title || '关于')}</h1></header>
  <div class="prose">
${markdown(body).html}
  </div>
</article>`,
  }));
}

// 404：GitHub Pages 找不到页面时显示
await write('404.html', page({
  title: `这里只有海浪 · ${TAB_NAME}`, description: '页面不存在', nav: '', side,
  main: `<div class="page-card empty-note">
  <h1 class="page-title">这里只有海浪</h1>
  <p>你要找的页面可能被浪卷走了。<a href="/">回到海边</a>，或者在上面搜一搜。</p>
</div>`,
}));

// 站内搜索索引
await write('search.json', JSON.stringify(posts.map((p) => ({
  title: p.title, url: p.url, date: p.date, category: p.category, tags: p.tags, summary: p.summary,
  text: stripTags(p.html).replace(/\s+/g, ' ').slice(0, 6000),
}))));

// RSS
const rfc822 = (d) => new Date(`${d}T00:00:00+08:00`).toUTCString();
await write('feed.xml', `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${SITE_NAME}</title>
  <link>${ORIGIN}/</link>
  <atom:link href="${ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>保持热爱，奔赴山海。</description>
  <language>zh-CN</language>
${posts.slice(0, 20).map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${ORIGIN}${p.url}</link>
    <guid>${ORIGIN}${p.url}</guid>
    <pubDate>${rfc822(p.date)}</pubDate>
    <category>${esc(p.category)}</category>
    <description>${esc(p.summary)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`);

await checkTitleFont([home, ...written]);
console.log(`博客已生成：${posts.length} 篇文章`);
