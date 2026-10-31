// 隐藏彩蛋：点一下画里矮墙上的猫，它会在旁边轻轻说一句话。说什么跟着海边的时间变：白天晒太阳，黄昏看晚霞，夜里打盹。
// 不添加任何猫的图片：在原画猫的位置放一个透明按钮，位置按 object-fit: cover 的裁切实时换算；
// 猫被裁掉、或落在水彩淡出的边缘里时，按钮自动移除，不留悬空的点击区。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  const img = figure && figure.querySelector('picture img');
  const spot = figure && figure.querySelector('.cat-spot');
  const says = figure && figure.querySelector('.cat-says');
  if (!figure || !img || !spot || !says) return;

  // 猫在两张原画中的范围（尾巴到前爪、耳尖到身下），按原图像素实测后换算成比例
  const CATS = {
    desktop: { box: [577 / 1774, 580 / 887, 728 / 1774, 635 / 887], edge: 'assets/hero/panorama-edge-desktop.png' },
    mobile: { box: [148 / 665, 580 / 887, 298 / 665, 634 / 887], edge: 'assets/hero/panorama-edge-mobile.png' },
  };
  const HEAD = 0.78; // 猫头大约在猫范围从左往右 78% 处，文字浮在头的上方
  // 头两下总是这两句；之后在「这个时间专属的」和「什么时候都能说的」之间交替着轮
  const FIRST = ['呼噜……', '这里的位置已经被我占了。'];
  const ANY = ['嘘，我在听海。', '喵。', '尾巴不给摸。', '再睡五分钟就起来。', '海风是我叫来的。'];
  const LINES = {
    day: ['太阳晒得刚刚好。', '石头被晒得暖暖的。', '海鸥又在偷看我的午饭。'],
    dusk: ['晚霞是橘子味的。', '天快黑了，我还不想回家。', '等灯塔亮了再走。'],
    night: ['月亮出来巡逻了。', '嘘，星星在数浪。', '墙上还留着一点白天的温度。'],
  };
  const LABELS = { day: '晒太阳的猫', dusk: '看晚霞的猫', night: '打盹的猫' };
  const timeNow = () => (LINES[document.documentElement.dataset.time] ? document.documentElement.dataset.time : 'day');
  const pool = (time) => LINES[time].flatMap((line, i) => [line, ANY[i]]).concat(ANY.slice(LINES[time].length));
  const SHOW_MS = 3200;

  let clicks = 0, hideTimer = 0, edges = {}, cat = null, said = '';

  // 读取水彩边缘遮罩，用来判断猫所在处是否清晰可见
  function loadEdge(src) {
    if (!edges[src]) {
      edges[src] = new Promise((resolve) => {
        const el = new Image();
        el.onload = () => {
          const c = document.createElement('canvas');
          c.width = el.naturalWidth; c.height = el.naturalHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(el, 0, 0);
          resolve((u, v) => ctx.getImageData(Math.min(c.width - 1, u * c.width) | 0, Math.min(c.height - 1, v * c.height) | 0, 1, 1).data[3] / 255);
        };
        el.onerror = () => resolve(null);
        el.src = src;
      });
    }
    return edges[src];
  }

  async function place() {
    if (!img.complete || !img.naturalWidth) return;
    const def = CATS[img.currentSrc.includes('mobile') ? 'mobile' : 'desktop'];
    const fw = figure.clientWidth, fh = figure.clientHeight;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.max(fw / iw, fh / ih); // object-fit: cover
    const [px, py] = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    const ox = (fw - iw * s) * px, oy = (fh - ih * s) * py;
    const [u0, v0, u1, v1] = def.box;
    const r = { left: ox + u0 * iw * s, top: oy + v0 * ih * s, width: (u1 - u0) * iw * s, height: (v1 - v0) * ih * s };

    let visible = r.left >= 0 && r.top >= 0 && r.left + r.width <= fw && r.top + r.height <= fh;
    if (visible) {
      const alpha = await loadEdge(def.edge);
      // 猫身中心和头部都要落在遮罩基本不透明的区域里
      visible = !alpha || [0.5, HEAD].every((k) => alpha((r.left + r.width * k) / fw, (r.top + r.height * 0.5) / fh) > 0.85);
    }
    cat = visible ? r : null;
    spot.hidden = !visible;
    if (!visible) { hide(); return; }
    Object.assign(spot.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    if (says.classList.contains('is-shown')) position();
  }

  // 文字浮在猫头上方，左右不超出画面；若会压到墙上的海鸥，就再抬高到海鸥头顶之上
  function position() {
    if (!cat) return;
    const fw = figure.clientWidth;
    const w = says.offsetWidth, h = says.offsetHeight;
    const x = Math.min(fw - w - 12, Math.max(12, cat.left + cat.width * HEAD - w / 2));
    let y = cat.top - h - 6;
    const gull = figure.querySelector('.wall-gull');
    if (gull) {
      const f = figure.getBoundingClientRect(), g = gull.getBoundingClientRect();
      const gl = g.left - f.left, gt = g.top - f.top;
      if (x < gl + g.width && x + w > gl && y + h > gt) y = gt - h - 4;
    }
    says.style.left = x + 'px';
    says.style.top = y + 'px';
  }

  function hide() {
    clearTimeout(hideTimer);
    says.classList.remove('is-shown');
  }

  spot.addEventListener('click', () => {
    if (!cat) return;
    const lines = pool(timeNow());
    let line = clicks < FIRST.length ? FIRST[clicks] : lines[(clicks - FIRST.length) % lines.length];
    if (line === said) line = lines[(clicks - FIRST.length + 1) % lines.length]; // 刚换了时间时别连着说同一句
    clicks++;
    said = line;
    says.textContent = line;
    position();
    // 先撤掉再加回，让同一句话或连续点击也能重新浮现
    says.classList.remove('is-shown');
    void says.offsetWidth;
    says.classList.add('is-shown');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, SHOW_MS);
  });

  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
  window.addEventListener('resize', schedule);
  img.addEventListener('load', schedule); // 跨过手机断点时 <picture> 会换图
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(figure);
  schedule();

  // 换时间时，按钮的名字跟着换；正在说的话不改
  const label = () => spot.setAttribute('aria-label', LABELS[timeNow()]);
  new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['data-time'] });
  label();
})();
