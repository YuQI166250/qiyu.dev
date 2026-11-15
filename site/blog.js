// 博客的小互动：站内搜索、文章目录高亮、复制、图片放大、滚动后的顶栏、评论区。
// 搜索索引 search.json 由 scripts/build-blog.mjs 生成，第一次聚焦搜索框时才下载。
(() => {
  'use strict';

  // ---------- 站内搜索（标题区和顶栏各有一个搜索框，共用同一份索引） ----------
  let index = null, loading = null;
  const load = () => loading || (loading = fetch('/search.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((data) => { index = data; return data; })
    .catch(() => { loading = null; return null; }));

  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mark = (text, words) => {
    let html = escape(text);
    for (const w of words) html = html.replace(new RegExp(escape(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
    return html;
  };
  // 摘一小段包含关键词的正文；没有命中正文时用摘要
  const snippet = (post, words) => {
    const lower = post.text.toLowerCase();
    const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
    if (!Number.isFinite(at)) return post.summary;
    const from = Math.max(0, at - 24);
    return (from ? '…' : '') + post.text.slice(from, from + 90) + '…';
  };

  function search(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return index.map((post) => {
      const title = post.title.toLowerCase(), meta = [post.category, ...post.tags].join(' ').toLowerCase();
      const body = (post.summary + ' ' + post.text).toLowerCase();
      let score = 0;
      for (const w of words) {
        if (title.includes(w)) score += 10;
        else if (meta.includes(w)) score += 5;
        else if (body.includes(w)) score += 1;
        else return null; // 每个词都要出现
      }
      return { post, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date)).slice(0, 8)
      .map(({ post }) => ({ post, words }));
  }

  function bindSearch(form) {
    const input = form.querySelector('input');
    const panel = form.querySelector('.search-results');
    if (!input || !panel) return;
    let active = -1;

    function render() {
      const query = input.value.trim();
      active = -1;
      if (!query) { panel.hidden = true; panel.innerHTML = ''; return; }
      if (!index) { panel.hidden = false; panel.innerHTML = '<p>正在翻找……</p>'; return; }
      const results = search(query);
      panel.hidden = false;
      panel.innerHTML = results.length
        ? results.map(({ post, words }) => `<a href="${post.url}"><strong>${mark(post.title, words)}</strong><span>${mark(snippet(post, words), words)}</span></a>`).join('')
        : '<p>没有找到相关的文章，换个词试试？</p>';
    }

    function move(step) {
      const links = [...panel.querySelectorAll('a')];
      if (!links.length) return;
      links[active]?.classList.remove('is-active');
      active = (active + step + links.length) % links.length;
      links[active].classList.add('is-active');
      links[active].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', () => { load().then(() => { if (input.value.trim()) render(); }); });
    input.addEventListener('input', () => { if (index) render(); else { render(); load().then(render); } });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Escape') { panel.hidden = true; }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = panel.querySelector('a.is-active') || panel.querySelector('a');
      if (target) location.href = target.href;
    });
    // 点在搜索框外面时收起结果
    document.addEventListener('pointerdown', (e) => { if (!form.contains(e.target)) panel.hidden = true; });
    form.addEventListener('focusout', (e) => { if (!form.contains(e.relatedTarget)) panel.hidden = true; });
  }
  document.querySelectorAll('.site-search').forEach(bindSearch);

  // ---------- 文章目录：高亮正在读的那一节 ----------
  const links = [...document.querySelectorAll('.toc a')];
  const heads = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  if (heads.length && 'IntersectionObserver' in window) {
    const visible = new Set();
    const pick = () => {
      // 视口里最靠上的标题；都不在视口里时取刚刚滚过去的那个
      let current = heads.find((h) => visible.has(h));
      if (!current) current = [...heads].reverse().find((h) => h.getBoundingClientRect().top < 0) || heads[0];
      links.forEach((a, i) => a.classList.toggle('is-active', heads[i] === current));
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
      pick();
    }, { rootMargin: '0px 0px -55% 0px' });
    heads.forEach((h) => io.observe(h));
  }

  // ---------- 复制：代码块右上角、文末的本文链接 ----------
  const copy = (text, button, label) => {
    const done = (ok) => {
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  };
  document.querySelectorAll('.prose pre').forEach((pre) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    // 逐行取文字再拼起来，空行也保留
    const text = () => [...pre.querySelectorAll('.line')].map((line) => line.textContent).join('\n') || pre.textContent;
    button.addEventListener('click', () => copy(text(), button, '复制'));
    pre.appendChild(button);
  });
  document.querySelectorAll('.copy-link').forEach((button) => {
    button.addEventListener('click', () => copy(button.dataset.copy, button, '复制链接'));
  });

  // 「关于我」卡片里的 QQ：没有网页可以打开，点一下把号码复制下来
  document.querySelectorAll('.profile-qq').forEach((button) => {
    const toast = button.querySelector('.qq-toast');
    let timer = 0;
    const show = (text) => {
      toast.textContent = text;
      toast.classList.add('is-shown');
      clearTimeout(timer);
      timer = setTimeout(() => toast.classList.remove('is-shown'), 1800);
    };
    button.addEventListener('click', () => {
      const qq = button.dataset.qq;
      if (navigator.clipboard) navigator.clipboard.writeText(qq).then(() => show(`已复制 QQ：${qq}`), () => show(`QQ：${qq}`));
      else show(`QQ：${qq}`);
    });
  });

  // ---------- 点击文章里的图片放大看 ----------
  const images = document.querySelectorAll('.prose img');
  if (images.length && typeof HTMLDialogElement === 'function') {
    const box = document.createElement('dialog');
    box.className = 'lightbox';
    box.setAttribute('aria-label', '查看大图');
    const big = document.createElement('img');
    box.appendChild(big);
    document.body.appendChild(box);
    box.addEventListener('click', () => box.close());
    images.forEach((el) => el.addEventListener('click', () => {
      big.src = el.currentSrc || el.src;
      big.alt = el.alt;
      box.showModal();
    }));
  }

  // ---------- 评论：giscus，滚到评论区附近才加载 ----------
  const comments = document.querySelector('.comments');
  if (comments) {
    // 自定义配色要从 https 加载（giscus 的窗口是 https）；本地 http 预览时用官方主题。夜晚换深色
    const giscusTheme = () => {
      const night = document.documentElement.dataset.time === 'night';
      if (location.protocol !== 'https:') return night ? 'dark' : 'light';
      return new URL(night ? '/giscus-theme-night.css' : '/giscus-theme.css', location.origin).href;
    };
    // 切换海边时间时，已经加载好的评论区跟着换配色
    new MutationObserver(() => {
      const frame = comments.querySelector('iframe.giscus-frame');
      if (frame) frame.contentWindow.postMessage({ giscus: { setConfig: { theme: giscusTheme() } } }, 'https://giscus.app');
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-time'] });
    const load = () => {
      const d = comments.dataset;
      const script = document.createElement('script');
      script.src = 'https://giscus.app/client.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      Object.entries({
        repo: d.repo, 'repo-id': d.repoId, category: d.category, 'category-id': d.categoryId,
        mapping: 'pathname', strict: '1', 'reactions-enabled': '1', 'emit-metadata': '0',
        'input-position': 'top', lang: 'zh-CN', loading: 'lazy',
        theme: giscusTheme(),
      }).forEach(([key, value]) => script.setAttribute(`data-${key}`, value));
      comments.querySelector('.giscus').appendChild(script);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
      }, { rootMargin: '600px 0px' });
      io.observe(comments);
    } else load();
  }

  // ---------- 滚过首屏后出现的顶栏：网站名、当前标题、回到顶部；文章页显示阅读进度 ----------
  const hero = document.querySelector('.intro.hero');
  if (hero) {
    const bar = document.createElement('div');
    bar.className = 'float-bar';
    bar.innerHTML = `<div class="float-bar-inner shell">
      <a class="float-bar-home" href="/">QIYU<span>的海边小世界</span></a>
      <nav class="float-bar-nav" aria-label="顶栏导航"></nav>
      <button class="float-bar-top" type="button" aria-label="回到顶部"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
    </div>
    <div class="float-bar-progress" aria-hidden="true"></div>`;
    // 导航和搜索框照搬标题区的那一份，当前页面的高亮也一起带过来
    const mastNav = document.querySelector('.masthead .site-nav');
    if (mastNav) bar.querySelector('.float-bar-nav').innerHTML = mastNav.innerHTML;
    const mastSearch = document.querySelector('.masthead .site-search');
    if (mastSearch) {
      const barSearch = mastSearch.cloneNode(true);
      barSearch.classList.add('float-bar-search');
      barSearch.querySelector('input').value = '';
      barSearch.querySelector('.search-results').hidden = true;
      barSearch.querySelector('.search-results').innerHTML = '';
      bar.querySelector('.float-bar-nav').after(barSearch);
      bindSearch(barSearch);
    }
    bar.inert = true; // 藏起来时不能被 Tab 到
    document.body.appendChild(bar);
    const progress = bar.querySelector('.float-bar-progress');
    const article = document.querySelector('article.post .prose');
    // 窄屏右下角的圆形「回到顶部」（宽屏用顶栏里的箭头，由 CSS 切换）
    const backTop = document.createElement('button');
    backTop.type = 'button';
    backTop.className = 'back-top';
    backTop.setAttribute('aria-label', '回到顶部');
    backTop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    document.body.appendChild(backTop);
    const toTop = () => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    bar.querySelector('.float-bar-top').addEventListener('click', toTop);
    backTop.addEventListener('click', toTop);
    let ticking = false;
    const update = () => {
      ticking = false;
      // 首屏里的导航一滚出视线就出现（首页内容少、滚不过整个首屏时也能看到）
      const shown = (mastNav || hero).getBoundingClientRect().bottom < 0;
      bar.classList.toggle('is-shown', shown);
      bar.inert = !shown;
      backTop.classList.toggle('is-shown', shown);
      backTop.tabIndex = shown ? 0 : -1;
      if (article) {
        const r = article.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (innerHeight * 0.4 - r.top) / r.height));
        progress.style.transform = `scaleX(${ratio})`;
      }
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }
})();
