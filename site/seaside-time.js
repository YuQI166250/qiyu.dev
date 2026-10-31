// 海边的时间：白天、黄昏、夜晚三套海景之间慢慢过渡。默认「自动」，跟着访客的本地时间走（时段表在 seaside-clock.js）；
// 访客手动点了某个时间后就停在那里，直到再点「自动」。
// 三套插画同一构图、同一尺寸，黄昏和夜晚作为两层 <picture> 叠在白天插画上，用透明度交叉淡化；
// 只有第一次切过去时才下载对应的图。WebGL 海面（hero-water.js）读取同一组权重，在着色器里做同样的混合，
// 所以无论画布是否可用，看到的都是同一幅画。页面其余部分的色调由 <html data-time> 和 CSS 过渡负责。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  const img = figure && figure.querySelector('picture img');
  const control = document.querySelector('.time-switch');
  if (!figure || !img || !control) return;

  const TIMES = ['day', 'dusk', 'night'];
  const FADE = 2600; // 毫秒；与 styles.css 中的 --time-fade 一致
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ALT = {
    day: img.alt,
    dusk: '水彩画：黄昏时分，柠檬藤架下的石砌露台，一只猫趴在矮墙上，天边的云被晚霞染成橘粉色，海湾里有帆船，山坡上立着白色灯塔。',
    night: '水彩画：星空下的海湾，柠檬藤架下的石砌露台，一只猫趴在矮墙上，海面泛着月色，灯塔和山坡上的小镇亮起了灯。',
  };
  const THEME = { day: '#fbf7ec', dusk: '#fcf3e8', night: '#eceef3' };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const buttons = [...control.querySelectorAll('button[data-time]')];
  const autoButton = control.querySelector('button[data-mode="auto"]');
  const clock = window.seaClock; // seaside-clock.js 没能运行时只有手动切换
  const root = document.documentElement;
  let mode = clock ? clock.mode : 'manual';

  // ---------- 黄昏、夜晚两层插画 ----------
  const layers = {};
  for (const time of ['dusk', 'night']) {
    const picture = document.createElement('picture');
    picture.className = 'scene-layer';
    picture.setAttribute('aria-hidden', 'true');
    const source = document.createElement('source');
    source.media = '(max-width: 640px)';
    source.width = 665; source.height = 887;
    const el = document.createElement('img');
    el.alt = '';
    el.width = 1774; el.height = 887;
    el.sizes = img.sizes;
    el.decoding = 'async';
    picture.append(source, el);
    layers[time] = { picture, source, img: el, loading: null };
    // 跨过手机断点时这一层也会换图，通知海面重新取纹理
    el.addEventListener('load', () => { if (el.style.opacity !== '') notify(); });
  }
  // 夜晚叠在黄昏之上，两层都在白天插画之上、WebGL 画布之下
  img.closest('picture').after(layers.dusk.picture, layers.night.picture);

  function load(time) {
    if (time === 'day') return Promise.resolve();
    const layer = layers[time];
    if (!layer.loading) {
      layer.loading = new Promise((resolve, reject) => {
        const el = layer.img;
        el.onload = () => { el.onload = el.onerror = null; resolve(); };
        el.onerror = () => { el.onload = el.onerror = null; reject(new Error('无法加载海景图片：' + time)); };
        layer.source.srcset = `assets/hero/hero-seaside-mobile-${time}.webp`;
        el.srcset = `assets/hero/hero-seaside-desktop-${time}-1200.webp 1200w, assets/hero/hero-seaside-desktop-${time}.webp 1774w`;
        el.src = `assets/hero/hero-seaside-desktop-${time}-1200.webp`;
        el.style.opacity = '0';
      })
        .then(() => layer.img.decode().catch(() => {}))
        .catch((err) => { layer.loading = null; throw err; }); // 失败后下次点击可以重试
    }
    return layer.loading;
  }

  // ---------- 权重与过渡 ----------
  // weights：白天、黄昏、夜晚各占多少，三者之和为 1。叠层透明度由它换算，保证画面就是三幅画的加权平均。
  let weights = [1, 0, 0], current = 'day', wanted = 'day', anim = 0;

  // ---------- 手账的色调 ----------
  // 3×3 颜色矩阵（sRGB），写法与 CSS 的 sepia() / saturate() / brightness() 定义一致，可以按权重直接线性混合。
  const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const diag = (r, g, b) => [[r, 0, 0], [0, g, 0], [0, 0, b]];
  const saturate = (s) => [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  const sepia = (a) => {
    const k = 1 - a;
    return [
      [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k],
      [0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k],
      [0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k],
    ];
  };
  const TONE = [
    diag(1, 1, 1),
    mul(diag(0.99, 0.99, 0.99), mul(saturate(1.06), sepia(0.1))), // 黄昏：微暖
    mul(diag(0.80, 0.84, 0.92), saturate(0.68)),                  // 夜晚：更暗、更淡，红绿压得比蓝多一点，带一丝冷意
  ];
  const journal = document.querySelector('.journal');
  const toneMatrix = document.querySelector('#time-tone feColorMatrix');

  function tone(w) {
    if (!journal || !toneMatrix) return;
    if (w[0] > 0.999) { journal.style.filter = ''; return; } // 白天保持原样，不加滤镜
    const m = TONE.reduce((acc, t, i) => acc.map((row, r) => row.map((v, c) => v + t[r][c] * w[i])), diag(0, 0, 0));
    toneMatrix.setAttribute('values', m.map((row) => row.map((v) => v.toFixed(4)).join(' ') + ' 0 0').join(' ') + ' 0 0 0 1 0');
    journal.style.filter = 'url(#time-tone)';
  }

  function apply(w) {
    weights = w;
    const night = w[2];
    const dusk = night < 0.999 ? w[1] / (1 - night) : 0;
    layers.night.img.style.opacity = layers.night.loading ? night.toFixed(4) : '0';
    layers.dusk.img.style.opacity = layers.dusk.loading ? dusk.toFixed(4) : '0';
    tone(w);
    notify();
  }

  function notify() {
    api.weights = weights;
    figure.dispatchEvent(new CustomEvent('seatime'));
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  function fadeTo(time, instant) {
    cancelAnimationFrame(anim);
    const from = weights.slice();
    const to = TIMES.map((t) => (t === time ? 1 : 0));
    if (instant || reduceMotion.matches) { apply(to); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / FADE), k = ease(p);
      apply(from.map((v, i) => v + (to[i] - v) * k));
      if (p < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }

  // 手动时按下的是选中的时间；自动时按下的是「自动」，当前时间的图标只上色、不算按下
  function press(time) {
    const auto = mode === 'auto';
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(!auto && b.dataset.time === time));
      b.classList.toggle('is-current', b.dataset.time === time);
    }
    if (autoButton) autoButton.setAttribute('aria-pressed', String(auto));
  }

  // 首屏不是白天时，海景先藏着（seaside-clock.js 加的 time-boot），换好插画再淡入
  function reveal() {
    if (!root.classList.contains('time-boot')) return;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('time-boot')));
  }

  async function go(time, instant) {
    if (!TIMES.includes(time) || time === wanted) return;
    wanted = time;
    press(time);
    const btn = buttons.find((b) => b.dataset.time === time);
    btn.setAttribute('aria-busy', 'true');
    try {
      await load(time);
    } catch (err) {
      console.warn(err);
      if (wanted === time) { wanted = current; press(current); } // 图没下载下来：留在原来的时间，画面不变
      if (root.classList.contains('time-boot') || root.dataset.time !== current) { // 首屏就没下载下来：退回白天
        root.dataset.time = current;
        root.classList.remove('time-instant');
        reveal();
      }
      btn.title = btn.getAttribute('aria-label') + '（暂时没加载出来，稍后再试）';
      setTimeout(() => { btn.title = btn.getAttribute('aria-label'); }, 4000);
      return;
    } finally {
      btn.removeAttribute('aria-busy');
    }
    if (wanted !== time) return; // 下载期间又换了别的时间
    // 首屏：海景还藏着就直接换好；下载太慢、海景已经先露出来了，就照常慢慢过渡
    if (instant === 'boot') instant = root.classList.contains('time-boot');
    current = time;
    root.dataset.time = time;
    if (instant) root.classList.add('time-instant');
    img.alt = ALT[time];
    if (themeMeta) themeMeta.content = THEME[time];
    fadeTo(time, instant);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('time-instant')));
    else root.classList.remove('time-instant');
    reveal();
  }

  // ---------- 自动 / 手动 ----------
  function setMode(next) {
    mode = next;
    api.mode = next;
    press(wanted);
    clearTimeout(autoTimer);
  }

  function remember(value) {
    try { sessionStorage.setItem(clock.KEY, value); } catch (err) { /* 存不下也没关系 */ }
  }

  // 自动模式：到了下一个时段边界就慢慢换过去。页面在后台时不换，回到前台再换，访客能看到过渡；
  // 最多隔 10 分钟检查一次，电脑睡眠、改了系统时间也能跟上。
  let autoTimer = 0;
  function follow() {
    clearTimeout(autoTimer);
    if (mode !== 'auto') return;
    if (!document.hidden) go(clock.at());
    autoTimer = setTimeout(follow, Math.min(clock.untilNext() + 1000, 10 * 60000));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) follow(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) follow(); });

  for (const b of buttons) {
    b.title = b.getAttribute('aria-label');
    b.addEventListener('click', () => {
      if (clock) remember(b.dataset.time);
      setMode('manual');
      go(b.dataset.time);
    });
  }
  if (autoButton && clock) {
    autoButton.title = autoButton.getAttribute('aria-label');
    autoButton.addEventListener('click', () => {
      remember('auto');
      setMode('auto');
      follow();
    });
  } else if (autoButton) {
    autoButton.hidden = true;
  }
  // 鼠标移到或聚焦到开关上时先在后台把另外两幅画下载好，点下去就能立刻开始过渡
  const warm = () => { for (const t of ['dusk', 'night']) load(t).catch(() => {}); };
  control.addEventListener('pointerenter', warm, { once: true });
  control.addEventListener('focusin', warm, { once: true });

  const api = { weights, mode, layers: { dusk: layers.dusk.img, night: layers.night.img }, go };
  window.seaTime = api;
  control.hidden = false;

  // 首屏的时间由 seaside-clock.js 决定（自动，或本次浏览中手动选过的）
  press('day');
  if (clock && clock.initial !== 'day') go(clock.initial, 'boot');
  follow();
})();
