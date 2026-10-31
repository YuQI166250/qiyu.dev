// 漂流瓶彩蛋（V2 第二阶段）：在页面上停留一两分钟后，偶尔有一只瓶子从海景右侧的海面慢慢漂进来，
// 停在帆船和礁石之间的开阔水面上随浪轻摇。点一下（或用键盘按下）就展开一张米黄色信纸，读一句海边来信；
// 合上信纸后瓶子慢慢漂走，隔几分钟才可能再来。没有提示、没有计数，不来也没关系。
// 计时只在页面处于前台、海景在可视范围内时走；阅读信纸时停住，瓶子也不会离开。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  const img = figure && figure.querySelector('picture img');
  const bottle = figure && figure.querySelector('.bottle');
  const letter = document.querySelector('.bottle-letter');
  if (!figure || !img || !bottle || !letter || typeof letter.showModal !== 'function') return;

  const bottleImg = bottle.querySelector('.bottle-img');
  const text = letter.querySelector('.letter-text');
  const sign = letter.querySelector('.letter-sign');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SRC = 'assets/decor/message-bottle.webp';
  const RATIO = 101 / 240; // 素材高宽比

  // 瓶子在两张原画里的路线（原图像素）：from 从画面右缘外的海面进来，停在 rest，合上信后漂向 away。
  // rest 选在帆船右侧、礁石左侧的开阔水面上；width 是瓶子在原图里的宽度，近处海面上略大于远处的帆船。
  const ROUTES = {
    desktop: { size: [1774, 887], from: [1835, 590], rest: [1400, 612], away: [1765, 568], width: 108 },
    mobile: { size: [665, 887], from: [725, 494], rest: [566, 506], away: [705, 476], width: 100 },
  };
  const ARRIVE_MS = 18000, LEAVE_MS = 15000;
  const MIN = 60000;

  const LETTERS = [
    '今天的浪有点调皮，卷走了我一只拖鞋。如果你捡到了，请替我好好穿着。',
    '这里的海鸥会偷薯条。别问我是怎么知道的。',
    '我在瓶子里装了一小块傍晚，打开的时候请慢一点。',
    '写这封信的时候，一只螃蟹从脚边路过，横着看了我一眼。',
    '露台上那只猫说，这片阳光是它先占的。我只是借来写信。',
    '我数了一下午的浪，数到第一千零一朵，就忘了前面的。',
    '柠檬树结果了，本想摘一个寄给你，可惜塞不进瓶口。',
    '灯塔的人说，晚上九点的海最好听。你要是睡不着，可以试试。',
    '如果这只瓶子漂到了你那里，说明海也想和你打个招呼。',
    '今天风很软，适合什么都不做。我决定认真地什么都不做。',
    '有人问我海有多远。我说，走到听得见浪的地方就到了。',
    '把烦心事写在沙滩上就好，涨潮的时候，海会帮你收走。',
  ];
  const SIGNS = ['—— 海边晒太阳的人', '—— 一个刚游完泳的人', '—— 露台上的某人', '—— 来自海的那一边', '—— 灯塔附近的邻居'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list, avoid) => {
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === avoid) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    return i;
  };

  // ---------- 只在前台、海景可见时走的计时器 ----------
  let inView = false, timer = 0, due = 0, since = 0, next = null;
  const awake = () => inView && !document.hidden;

  function wait(ms, fn) {
    clearTimeout(timer); timer = 0;
    due = ms; next = fn;
    resume();
  }
  function resume() {
    if (!next || timer || !awake()) return;
    since = performance.now();
    timer = setTimeout(() => { timer = 0; const fn = next; next = null; fn(); }, due);
  }
  function pause() {
    if (!timer) return;
    clearTimeout(timer); timer = 0;
    due = Math.max(0, due - (performance.now() - since));
  }
  function stopWaiting() { clearTimeout(timer); timer = 0; next = null; }

  // ---------- 位置 ----------
  // 与 cat.js 相同：按 object-fit: cover 的裁切把原图坐标换算成画框里的像素
  let state = 'idle', anim = null, spot = null, lastLetter = -1;

  function measure() {
    if (!img.complete || !img.naturalWidth) return null;
    const route = ROUTES[img.currentSrc.includes('mobile') ? 'mobile' : 'desktop'];
    const fw = figure.clientWidth, fh = figure.clientHeight;
    const [iw, ih] = route.size;
    const s = Math.max(fw / iw, fh / ih);
    const [px, py] = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    const ox = (fw - iw * s) * px, oy = (fh - ih * s) * py;
    const at = ([x, y]) => [ox + x * s, oy + y * s];
    const w = Math.round(Math.min(96, Math.max(52, route.width * s)));
    const h = w * RATIO;
    const [x, y] = at(route.rest);
    // 停靠处必须完整地落在画框里，离水彩边缘留一点余地
    if (x - w / 2 < fw * 0.04 || x + w / 2 > fw * 0.96 || y - h / 2 < 0 || y + h / 2 > fh * 0.9) return null;
    const off = (p) => { const [a, b] = at(p); return [a - x, b - y]; };
    return { left: x - w / 2, top: y - h / 2, w, from: off(route.from), away: off(route.away) };
  }

  function place() {
    spot = measure();
    if (!spot) return false;
    Object.assign(bottle.style, { left: spot.left + 'px', top: spot.top + 'px', width: spot.w + 'px' });
    return true;
  }

  const shift = ([x, y], k = 1) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k})`;

  // ---------- 漂来、停留、漂走 ----------
  function loadImage() {
    if (!bottleImg.getAttribute('src')) bottleImg.src = SRC;
    return bottleImg.decode ? bottleImg.decode() : Promise.resolve();
  }

  async function arrive() {
    try { await loadImage(); } catch { wait(rand(2, 4) * MIN, arrive); return; } // 素材没下载下来：过一会儿再试
    if (!awake()) { wait(1000, arrive); return; }
    if (!place()) { wait(rand(1, 2) * MIN, arrive); return; } // 画面太窄、停靠处被裁掉了：这次不来
    state = 'arriving';
    bottle.removeAttribute('aria-disabled');
    bottle.hidden = false;
    if (reduceMotion.matches) { settle(); return; }
    anim = bottle.animate([
      { transform: shift(spot.from, 0.94), opacity: 0 },
      { opacity: 1, offset: 0.22 },
      { transform: shift([0, 0]), opacity: 1 },
    ], { duration: ARRIVE_MS, easing: 'cubic-bezier(.3, .55, .4, 1)' });
    anim.onfinish = () => { anim = null; if (state === 'arriving') settle(); };
  }

  // 停在海面上；一直没人理的话，一分多钟后自己漂走
  function settle() {
    state = 'floating';
    wait(rand(70, 100) * 1000, () => leave(rand(2.5, 4.5) * MIN));
  }

  function leave(after) {
    state = 'leaving';
    bottle.setAttribute('aria-disabled', 'true');
    const done = () => { hide(); wait(after, arrive); }; // hide() 会取消停在终点的漂走动画
    if (reduceMotion.matches || !spot) { done(); return; }
    // 还在漂来的半路上：从当前位置接着漂走，不跳回停靠点
    let start = { transform: shift([0, 0]), opacity: 1 };
    if (anim) {
      anim.commitStyles();
      anim.cancel();
      start = { transform: bottle.style.transform, opacity: bottle.style.opacity || 1 };
    }
    anim = bottle.animate([start, { opacity: 1, offset: 0.35 }, { transform: shift(spot.away, 0.84), opacity: 0 }],
      { duration: LEAVE_MS, easing: 'cubic-bezier(.45, 0, .7, 1)', fill: 'forwards' });
    anim.onfinish = done;
  }

  function hide() {
    if (anim) { anim.cancel(); anim = null; }
    if (document.activeElement === bottle) bottle.blur();
    bottle.hidden = true;
    bottle.style.transform = bottle.style.opacity = '';
    state = 'idle';
  }

  // ---------- 信纸 ----------
  bottle.addEventListener('click', () => {
    if (state !== 'arriving' && state !== 'floating') return;
    state = state === 'arriving' ? 'reading-arriving' : 'reading';
    stopWaiting(); // 阅读时不计时，瓶子也不会自己漂走
    lastLetter = pick(LETTERS, lastLetter);
    text.textContent = LETTERS[lastLetter];
    sign.textContent = SIGNS[pick(SIGNS)];
    letter.classList.remove('is-closing');
    letter.showModal();
  });

  let closing = 0;
  function closeLetter() {
    if (!letter.open || closing) return;
    if (reduceMotion.matches) { letter.close(); return; }
    letter.classList.add('is-closing');
    closing = setTimeout(() => { closing = 0; letter.close(); }, 320);
  }

  letter.querySelector('.letter-close').addEventListener('click', closeLetter);
  // 点在信纸外面（落在 dialog 自身，也就是遮罩上）时合上
  letter.addEventListener('click', (e) => { if (e.target === letter) closeLetter(); });
  letter.addEventListener('cancel', (e) => { e.preventDefault(); closeLetter(); }); // Esc：同样慢慢合上
  letter.addEventListener('close', () => {
    clearTimeout(closing); closing = 0;
    letter.classList.remove('is-closing');
    if (state.startsWith('reading')) leave(rand(5, 8) * MIN);
  });

  // ---------- 前台 / 后台、可见 / 不可见 ----------
  function update() {
    if (awake()) { resume(); if (anim && anim.playState === 'paused') anim.play(); }
    else { pause(); if (anim && anim.playState === 'running') anim.pause(); }
  }
  new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    update();
  }, { threshold: 0.3 }).observe(figure);
  document.addEventListener('visibilitychange', update);

  // 窗口大小变了或跨过手机断点换了图：直接走完当前这段漂移，再按新的画框重新摆好
  let frame = 0;
  const relayout = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (state === 'idle') return;
      if (anim) anim.finish();
      // 停靠处被裁掉了就先收起瓶子；正在读信时不动它，等合上信再漂走
      if (state !== 'idle' && !place() && !state.startsWith('reading')) { stopWaiting(); hide(); wait(rand(1, 2) * MIN, arrive); }
    });
  };
  window.addEventListener('resize', relayout);
  img.addEventListener('load', relayout);

  wait(rand(1, 3) * MIN, arrive);
})();
