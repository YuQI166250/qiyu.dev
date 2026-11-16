// 季节小彩蛋：按访客当天的日期，在海景里加一点季节的东西。叠在插画上的一层透明画布，不挡任何点击。
//   春（3–5 月）：偶尔飘过几片花瓣，夜里少一些
//   夏（6–8 月）：黄昏和夜里，海面和花丛上有萤火虫一明一暗
//   秋（9–11 月）：几片落叶打着旋飘下来
//   冬（12–2 月）：细细的雪，夜里最亮
// 海景不在屏幕上、页面切到后台、或系统开了「减少动态效果」时停下。地址后面加 ?season=winter 等可以预览别的季节。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  if (!figure || !window.HTMLCanvasElement) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)').matches;

  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const asked = new URLSearchParams(location.search).get('season');
  const month = new Date().getMonth() + 1;
  const season = SEASONS.includes(asked) ? asked
    : month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';

  // 每个季节在白天、黄昏、夜晚的浓淡（0 = 不出现），切换时间时慢慢过渡
  const STRENGTH = {
    spring: { day: 1, dusk: 0.8, night: 0.35 },
    summer: { day: 0, dusk: 0.55, night: 1 },
    autumn: { day: 1, dusk: 1, night: 0.6 },
    winter: { day: 0.75, dusk: 0.9, night: 1 },
  }[season];
  // 同时在画面里的数量：按画面面积算，手机上少一些
  const DENSITY = { spring: 24, summer: 16, autumn: 18, winter: 110 }[season];

  const canvas = document.createElement('canvas');
  canvas.className = 'season-layer';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.season = season;
  figure.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0, dpr = 1, items = [], strength = 0, running = false, visible = false, raf = 0, last = 0;
  const rand = (a, b) => a + Math.random() * (b - a);
  const timeNow = () => document.documentElement.dataset.time || 'day';

  function size() {
    const r = figure.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const want = Math.round(DENSITY * Math.min(1.6, (w * h) / (1440 * 900)) * (coarse ? 0.7 : 1)) + 4;
    while (items.length < want) items.push(spawn(true));
    items.length = want;
  }

  // 一片新的：开场时撒满整个画面，之后从上方（萤火虫在下半部分）补进来
  function spawn(anywhere) {
    const p = { x: rand(-0.05, 1.05) * w, y: anywhere ? rand(0, 1) * h : rand(-0.12, -0.02) * h, phase: rand(0, Math.PI * 2), age: 0 };
    if (season === 'winter') Object.assign(p, { r: rand(1.2, 3.4), vy: rand(16, 38), sway: rand(6, 18), swaySpeed: rand(0.3, 0.8), a: rand(0.6, 1) });
    if (season === 'spring') Object.assign(p, { r: rand(6, 10), vy: rand(18, 34), vx: rand(8, 22), spin: rand(-1.2, 1.2), flip: rand(1.2, 2.6), hue: rand(338, 356), light: rand(84, 92) });
    if (season === 'autumn') Object.assign(p, { r: rand(9, 15), vy: rand(24, 44), vx: rand(-10, 14), spin: rand(-1.6, 1.6), flip: rand(1, 2.2),
      color: ['#d9822b', '#c8553d', '#e0b13c', '#b5672f', '#9e7b2f'][Math.floor(Math.random() * 5)] });
    if (season === 'summer') Object.assign(p, { x: rand(0.05, 0.95) * w, y: rand(0.45, 0.92) * h, r: rand(1.4, 2.6), vx: rand(-8, 8), vy: rand(-6, 6),
      blink: rand(0.6, 1.4), wander: rand(0.4, 1.1) });
    return p;
  }

  function step(dt, t) {
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.age += dt;
      if (season === 'summer') {
        p.vx += Math.sin(t * p.wander + p.phase) * 6 * dt; p.vy += Math.cos(t * p.wander * 0.8 + p.phase) * 6 * dt;
        p.vx = Math.max(-12, Math.min(12, p.vx)); p.vy = Math.max(-9, Math.min(9, p.vy));
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > w || p.y < h * 0.38 || p.y > h * 0.96) items[i] = spawn(true);
        continue;
      }
      p.y += p.vy * dt;
      if (season === 'winter') p.x += Math.sin(t * p.swaySpeed + p.phase) * p.sway * dt;
      else p.x += (p.vx + Math.sin(t * 0.9 + p.phase) * 14) * dt;
      if (p.y > h * 1.05 || p.x < -0.1 * w || p.x > 1.1 * w) items[i] = spawn(false);
    }
  }

  function leaf(r) { // 一片小叶子：两段弧线合成的尖头叶形
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.75, -r * 0.1, 0, r);
    ctx.quadraticCurveTo(-r * 0.75, -r * 0.1, 0, -r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 45, 20, .35)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 0.9); ctx.stroke();
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (strength < 0.01) return;
    const night = timeNow() === 'night';
    for (const p of items) {
      // 刚出现的先淡入，免得突然冒出来
      const fade = Math.min(1, p.age / 1.2) * strength;
      if (season === 'winter') {
        ctx.globalAlpha = p.a * fade;
        ctx.fillStyle = night ? '#f4f7ff' : '#ffffff';
        if (night) { ctx.shadowColor = 'rgba(220, 230, 255, .9)'; ctx.shadowBlur = 6; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      } else if (season === 'summer') {
        const glow = 0.5 + 0.5 * Math.sin(t * p.blink * 2.2 + p.phase);
        ctx.globalAlpha = fade * (0.15 + 0.85 * glow * glow);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        g.addColorStop(0, 'rgba(250, 255, 190, 1)'); g.addColorStop(0.18, 'rgba(225, 245, 120, .85)'); g.addColorStop(1, 'rgba(200, 240, 90, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.phase + t * p.spin);
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(t * p.flip + p.phase))), 1); // 翻面：宽度忽大忽小，像在空中打转
        ctx.globalAlpha = fade * 0.9;
        if (season === 'spring') {
          ctx.fillStyle = `hsl(${p.hue} 70% ${night ? p.light - 22 : p.light}%)`;
          ctx.beginPath(); ctx.ellipse(0, 0, p.r * 0.62, p.r, 0, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          if (night) ctx.filter = 'brightness(.7) saturate(.8)';
          leaf(p.r);
          ctx.filter = 'none';
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const target = STRENGTH[timeNow()] || 0;
    strength += (target - strength) * Math.min(1, dt * 0.8); // 换时间时一两秒内慢慢变浓或变淡
    const t = now / 1000;
    step(dt, t);
    draw(t);
  }

  function update() {
    const run = visible && !document.hidden && !reduceMotion.matches;
    if (run && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!run && running) { running = false; cancelAnimationFrame(raf); }
    if (reduceMotion.matches) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  strength = STRENGTH[timeNow()] || 0;
  size();
  if ('ResizeObserver' in window) new ResizeObserver(size).observe(figure);
  else addEventListener('resize', size);
  new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; update(); }).observe(figure);
  document.addEventListener('visibilitychange', update);
  reduceMotion.addEventListener('change', update);
})();
