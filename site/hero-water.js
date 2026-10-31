// 首页主视觉的海水互动，改编自 lab/sea/sea.js。
// 原有 <img> 始终保留在下面作为静态画面；WebGL 画布只在可用、未要求减少动态效果时叠在上面。
// 海面两层运动：着色器噪声（持续流动）+ CPU 波动方程（指针拨动、点击涟漪）。
// 水面蒙版由 scripts/make-sea-masks.py 生成，只让海水流动。
// 黄昏、夜晚两幅插画与白天同一构图，共用蒙版；三幅画按 seaside-time.js 给出的权重在着色器里混合。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  const img = figure && figure.querySelector('img');
  const hint = figure && figure.querySelector('.water-hint');
  if (!figure || !img) return;

  // boat：画面里帆船所在的小方框（x0, y0, x1, y1）和摇晃支点（船底）
  // moon：夜景里月亮的中心和半径（含光晕，按图片比例）；云会漂，月亮不跟着漂。手机图裁掉了月亮。
  const SCENES = {
    desktop: {
      mask: 'assets/hero/hero-seaside-desktop-mask.png', horizon: 0.436, grid: [200, 100],
      boat: [0.645, 0.495, 0.69, 0.645], pivot: [0.666, 0.635],
      moon: [1238 / 1774, 129 / 887, 64 / 1774, 64 / 887],
    },
    mobile: {
      mask: 'assets/hero/hero-seaside-mobile-crop-mask.png', horizon: 0.437, grid: [96, 128],
      boat: [0.698, 0.452, 0.755, 0.526], pivot: [0.726, 0.52],
      moon: [-1, -1, 0.01, 0.01],
    },
  };
  // 海面上的光：lit 是水波迎光面的提亮，glint 是零星的闪光。白天偏白，黄昏偏暖，夜里是很淡的月白
  const LIGHT = {
    lit: [[0.80, 0.96, 1.0, 0.30], [1.0, 0.88, 0.76, 0.26], [0.70, 0.78, 1.0, 0.13]],
    glint: [[1.0, 0.98, 0.88, 0.18], [1.0, 0.85, 0.60, 0.17], [0.86, 0.90, 1.0, 0.09]],
  };
  const LAYERS = ['dusk', 'night'];
  const STEP = 1 / 60;
  const DAMPING = 0.985;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  let canvas, gl, program, uniforms, textures;
  let scene = null, sceneKey = '';
  let W = 0, H = 0, cur, prev, waterMask, waveBytes;
  let running = false, visible = false, raf = 0, last = 0, acc = 0, time = 0, frameCount = 0;
  let lastPointer = null;
  let layerSrc = { dusk: '', night: '' }; // 已经传进纹理的黄昏、夜晚图片地址
  let view = { scale: [1, 1], offset: [0, 0] };

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uImage, uDusk, uNight, uMask, uWave;
    uniform vec3 uWeights;   // 白天、黄昏、夜晚三幅画的比例
    uniform vec3 uLit, uGlint;
    uniform vec4 uMoon;
    uniform vec2 uScale, uOffset;
    uniform vec2 uPx;        // 一个 CSS 像素对应的纹理坐标长度，让动效幅度在桌面和手机上一致
    uniform vec4 uBoat;
    uniform vec2 uPivot;
    uniform float uTime, uHorizon;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    void main() {
      vec2 uv = vUv * uScale + uOffset;
      vec3 layers = texture2D(uMask, uv).rgb; // R 海水 · G 枝叶 · B 天空
      float m = layers.r;
      float d = clamp((uv.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
      vec2 p = vec2(uv.x * 9.0, uv.y * 9.0 * mix(3.2, 1.0, sqrt(d)));
      float t = uTime;

      float n1 = noise(p * vec2(1.0, 1.7) + vec2(t * 0.10, -t * 0.42));
      float n2 = noise(p * vec2(1.8, 2.6) + vec2(-t * 0.16, -t * 0.30) + 7.3);
      float swell = sin(p.y * 2.2 - t * 1.1 + n1 * 2.0);
      vec2 flow = vec2(n1 - 0.5 + 0.25 * swell, (n2 - 0.5) * 0.7 + 0.18 * swell);
      flow *= 0.005 * (0.2 + 0.8 * d);

      vec2 g = (texture2D(uWave, uv).rg - 0.5) * 2.0;
      vec2 offset = (flow + g * 0.014) * m;

      // 枝叶：随一阵阵微风轻摆，幅度约 1–2 像素
      float gust = 0.6 + 0.4 * sin(t * 0.31) * sin(t * 0.17 + 1.3);
      vec2 sway = vec2(sin(t * 1.05 + uv.y * 8.0 + uv.x * 3.0) + 0.45 * sin(t * 1.7 + uv.x * 14.0 + uv.y * 6.0),
                       0.35 * sin(t * 1.3 + uv.x * 9.0));
      offset += sway * 1.3 * gust * uPx * layers.g;

      // 天空：云朵极慢地来回漂移，并带一点舒展变形
      vec2 drift = vec2(9.0 * sin(t * 0.09) + 1.5 * sin(t * 0.13 + uv.y * 5.0), 0.8 * sin(t * 0.1 + uv.x * 4.0));
      drift += (vec2(noise(uv * 6.0 + t * 0.04), noise(uv * 6.0 - t * 0.04 + 3.1)) - 0.5) * 3.0;
      // 夜里云漂得更慢一些，月亮本身留在原处
      float moon = 1.0 - smoothstep(0.7, 1.0, length((uv - uMoon.xy) / uMoon.zw));
      offset += drift * uPx * layers.b * (1.0 - uWeights.z * max(0.4, moon));

      // 帆船：绕船底轻轻摇晃、起伏（在像素空间旋转，避免被拉伸）
      vec2 out2 = max(uBoat.xy - uv, uv - uBoat.zw);
      float inBoat = 1.0 - smoothstep(0.0, 6.0 * uPx.y, max(out2.x, out2.y));
      if (inBoat > 0.0) {
        float a = 0.022 * sin(t * 1.2);
        vec2 q = (uv - uPivot) / uPx;
        vec2 r = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
        offset += (r - q + vec2(0.0, 0.7 * sin(t * 1.2 + 1.2))) * uPx * inBoat;
      }

      vec2 st = uv + offset;
      vec3 color = vec3(0.0);
      if (uWeights.x > 0.0) color += texture2D(uImage, st).rgb * uWeights.x;
      if (uWeights.y > 0.0) color += texture2D(uDusk, st).rgb * uWeights.y;
      if (uWeights.z > 0.0) color += texture2D(uNight, st).rgb * uWeights.z;

      float lit = clamp(-g.x * 0.7 - g.y * 1.1, -1.0, 1.0) * m;
      color += uLit * max(lit, 0.0);
      color *= 1.0 + min(lit, 0.0) * 0.2;

      float s = noise(p * vec2(4.0, 6.0) + vec2(t * 0.25, -t * 0.6) + n2 * 3.0);
      s = smoothstep(0.80, 0.97, s) * m * (0.35 + 0.65 * (1.0 - d));
      color += uGlint * s;
      color *= 1.0 + 0.03 * swell * m;

      gl_FragColor = vec4(color, 1.0);
    }`;

  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function makeTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function upload(unit, tex, source) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  // 创建画布和 WebGL；失败时返回 false，页面保持静态插画
  function setup() {
    canvas = document.createElement('canvas');
    canvas.className = 'water';
    canvas.setAttribute('aria-hidden', 'true');
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return false;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (err) {
      console.warn(err);
      return false;
    }
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    uniforms = {};
    for (const name of ['uImage', 'uDusk', 'uNight', 'uMask', 'uWave', 'uWeights', 'uLit', 'uGlint', 'uMoon',
      'uScale', 'uOffset', 'uPx', 'uBoat', 'uPivot', 'uTime', 'uHorizon']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(uniforms.uImage, 0);
    gl.uniform1i(uniforms.uMask, 1);
    gl.uniform1i(uniforms.uWave, 2);
    gl.uniform1i(uniforms.uDusk, 3);
    gl.uniform1i(uniforms.uNight, 4);
    textures = { image: makeTexture(), mask: makeTexture(), wave: makeTexture(), dusk: makeTexture(), night: makeTexture() };
    // 黄昏、夜晚还没下载时先放一个像素占位，权重为 0，不会被采样
    for (const [unit, tex] of [[3, textures.dusk], [4, textures.night]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    setWeights([1, 0, 0]);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      stop();
      canvas.classList.remove('is-live'); // 退回静态插画
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      canvas.addEventListener(type, () => { lastPointer = null; });
    }
    figure.appendChild(canvas);
    return true;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法加载 ' + src));
      el.src = src;
    });
  }

  function imageReady() {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
  }

  // 根据 <picture> 当前选中的图片（桌面横图或手机竖图）准备纹理、蒙版和波动网格
  async function useCurrentImage() {
    await imageReady();
    const key = img.currentSrc.includes('mobile') ? 'mobile' : 'desktop';
    const src = img.currentSrc;
    sceneKey = src;
    // 换图期间旧纹理与新插画对不上：先停下并淡出画布，新蒙版就绪后再显示
    if (scene) { stop(); scene = null; canvas.classList.remove('is-live'); }
    const def = SCENES[key];
    let maskImg;
    try {
      maskImg = await loadImage(def.mask);
    } catch (err) {
      if (sceneKey === src) fallBack(err); // 已被更新的换图取代时不处理
      return;
    }
    if (sceneKey !== src) return;

    scene = { ...def, maskImg };
    upload(0, textures.image, img);
    upload(1, textures.mask, maskImg);
    layerSrc = { dusk: '', night: '' }; // 换了桌面/手机版，另外两幅画也要重新取

    [W, H] = def.grid;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(maskImg, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    waterMask = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) waterMask[i] = Math.min(1, px[i * 4] / 200);
    cur = new Float32Array(W * H);
    prev = new Float32Array(W * H);
    waveBytes = new Uint8Array(W * H * 4).fill(128);
    uploadWave();

    gl.uniform1f(uniforms.uHorizon, def.horizon);
    gl.uniform4fv(uniforms.uBoat, def.boat);
    gl.uniform2fv(uniforms.uPivot, def.pivot);
    gl.uniform4fv(uniforms.uMoon, def.moon);
    resize();
    goLive();
  }

  // 当前时间要用到的插画都已传进纹理后才显示画布；否则先让下面的静态叠层顶着，等图片到了再显示
  function goLive() {
    if (!scene || !syncTime()) return;
    render();
    canvas.classList.add('is-live');
    if (hint) hint.hidden = false;
    update();
  }

  function setWeights(w) {
    gl.uniform3fv(uniforms.uWeights, w);
    for (const key of ['lit', 'glint']) {
      const sum = [0, 0, 0];
      LIGHT[key].forEach((c, i) => { for (let k = 0; k < 3; k++) sum[k] += c[k] * c[3] * w[i]; });
      gl.uniform3fv(uniforms[key === 'lit' ? 'uLit' : 'uGlint'], sum);
    }
  }

  // 读取 seaside-time.js 的权重，把新下载好的黄昏、夜晚插画传进纹理；返回需要的图是否都已就绪
  function syncTime() {
    const t = window.seaTime;
    if (!t) return true;
    const mobile = img.currentSrc.includes('mobile');
    let ready = true;
    LAYERS.forEach((key, k) => {
      const el = t.layers[key];
      const usable = el.complete && el.naturalWidth > 0 && el.currentSrc.includes('mobile') === mobile;
      if (usable && layerSrc[key] !== el.currentSrc) {
        upload(3 + k, textures[key], el);
        layerSrc[key] = el.currentSrc;
      }
      if (t.weights[k + 1] > 0 && !(usable && layerSrc[key] === el.currentSrc)) ready = false;
    });
    if (ready) setWeights(t.weights);
    return ready;
  }

  function onSeaTime() {
    if (!scene || gl.isContextLost()) return;
    if (!canvas.classList.contains('is-live')) { goLive(); return; }
    if (!syncTime()) { canvas.classList.remove('is-live'); return; } // 极少见：图片还在换，先退回静态叠层
    if (!running) render();
  }

  // 与 <img> 的 object-fit: cover 和 object-position 完全对齐
  function resize() {
    if (!scene) return;
    const rect = figure.getBoundingClientRect();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const boxAspect = rect.width / rect.height, imgAspect = iw / ih;
    const sx = boxAspect > imgAspect ? 1 : boxAspect / imgAspect;
    const sy = boxAspect > imgAspect ? imgAspect / boxAspect : 1;
    const pos = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    view = { scale: [sx, sy], offset: [(1 - sx) * (pos[0] ?? 0.5), (1 - sy) * (pos[1] ?? 0.5)] };

    // 像素密度不超过图片本身的清晰度，手机上再收紧一些，减少着色开销
    const shown = rect.width / sx;
    const maxDpr = coarse ? 1.5 : 2;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr, iw / shown));
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uniforms.uScale, sx, sy);
    gl.uniform2f(uniforms.uOffset, view.offset[0], view.offset[1]);
    gl.uniform2f(uniforms.uPx, sx / rect.width, sy / rect.height);
  }

  // ---------- 波动模拟（同 lab/sea） ----------
  function step() {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1, i = y * W + 1; x < W - 1; x++, i++) {
        const v = (cur[i - 1] + cur[i + 1] + cur[i - W] + cur[i + W]) * 0.5 - prev[i];
        prev[i] = v * DAMPING * waterMask[i];
      }
    }
    const t = cur; cur = prev; prev = t;
  }

  function uploadWave() {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1, i = y * W + 1; x < W - 1; x++, i++) {
        waveBytes[i * 4] = 128 + Math.max(-127, Math.min(127, (cur[i + 1] - cur[i - 1]) * 42));
        waveBytes[i * 4 + 1] = 128 + Math.max(-127, Math.min(127, (cur[i + W] - cur[i - W]) * 42));
      }
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures.wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, waveBytes);
  }

  function disturb(gx, gy, radius, amount) {
    const r = Math.ceil(radius);
    for (let y = Math.max(1, Math.floor(gy - r)); y <= Math.min(H - 2, Math.ceil(gy + r)); y++) {
      for (let x = Math.max(1, Math.floor(gx - r)); x <= Math.min(W - 2, Math.ceil(gx + r)); x++) {
        const dist = Math.hypot(x - gx, y - gy);
        if (dist > radius) continue;
        const i = y * W + x;
        cur[i] += amount * 0.5 * (1 + Math.cos(Math.PI * dist / radius)) * waterMask[i];
      }
    }
  }

  function toGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const u = ((clientX - rect.left) / rect.width) * view.scale[0] + view.offset[0];
    const v = ((clientY - rect.top) / rect.height) * view.scale[1] + view.offset[1];
    return [u * W, v * H];
  }

  // ---------- 交互：只读取指针位置，不阻止默认行为，页面滚动和点击照常 ----------
  function onPointerDown(e) {
    if (!running) return;
    const [gx, gy] = toGrid(e.clientX, e.clientY);
    const x = Math.round(gx), y = Math.round(gy);
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && waterMask[y * W + x] > 0.3) {
      disturb(gx, gy, 5.5, -5);
    }
    lastPointer = [gx, gy];
  }

  function onPointerMove(e) {
    if (!running) return;
    if (e.pointerType !== 'mouse' && e.buttons === 0) return;
    const [gx, gy] = toGrid(e.clientX, e.clientY);
    if (lastPointer) {
      const [lx, ly] = lastPointer;
      const dist = Math.hypot(gx - lx, gy - ly);
      const steps = Math.min(20, Math.ceil(dist / 1.5));
      const strength = Math.min(1.4, 0.3 + dist * 0.15);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        disturb(lx + (gx - lx) * t, ly + (gy - ly) * t, 2.4, strength / Math.sqrt(steps));
      }
    }
    lastPointer = [gx, gy];
  }

  // ---------- 循环 ----------
  function render() {
    gl.uniform1f(uniforms.uTime, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) { step(); acc -= STEP; n++; }
    if (n === 4) acc = 0;
    // 触屏设备隔帧绘制（约 30 帧），海面流动很慢，看不出差别
    if (coarse && (frameCount++ & 1)) return;
    uploadWave();
    render();
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function update() {
    const shouldRun = !!scene && visible && !document.hidden && !reduceMotion.matches && !gl.isContextLost();
    if (shouldRun && !running) {
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      stop();
    }
  }

  function start() {
    if (canvas) { canvas.hidden = false; update(); return; }
    if (hint && coarse) hint.querySelector('.water-hint-text').textContent = '海面是活的：轻触或划过海面，泛起涟漪';
    if (!setup()) { canvas = null; return; }

    // 海景离开可视区域后暂停
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      update();
    }, { rootMargin: '80px' }).observe(figure);

    document.addEventListener('visibilitychange', update);
    figure.addEventListener('seatime', onSeaTime);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', update);

    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { resize(); if (!running && scene) render(); }, 120);
    });
    // 跨过手机断点时 <picture> 会换图，重新准备场景
    img.addEventListener('load', () => { if (img.currentSrc !== sceneKey) useCurrentImage().catch(fallBack); });

    useCurrentImage().catch(fallBack);
  }

  // 素材加载失败：停止绘制并淡出画布，只显示下面的静态插画；之后再换图时会重新尝试
  function fallBack(err) {
    console.warn(err);
    stop();
    scene = null;
    canvas.classList.remove('is-live');
  }

  // 减少动态效果：完全不启用，只显示静态插画
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) {
      stop();
      if (canvas) canvas.hidden = true;
      if (hint) hint.hidden = true;
    } else {
      start();
      if (hint && scene) hint.hidden = false;
    }
  });

  if (!reduceMotion.matches) start();
})();

// 偶尔飞过的海鸥：复用 assets/decor/seagull.png，只在天空右侧出现，
// 从枝叶后面「钻出」或飞回枝叶后面，避免从前景树叶上方穿过。
(() => {
  'use strict';

  const figure = document.querySelector('.panorama');
  const img = figure && figure.querySelector('img');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!figure || !img || !Element.prototype.animate) return;

  const gull = document.createElement('img');
  gull.className = 'flying-gull';
  gull.src = 'assets/decor/seagull.png';
  gull.alt = '';
  gull.setAttribute('aria-hidden', 'true');
  figure.appendChild(gull);

  let visible = false, timer = 0, flight = null;
  const rand = (a, b) => a + Math.random() * (b - a);

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(fly, delay);
  }

  function fly() {
    if (!visible || document.hidden || reduceMotion.matches) { schedule(4000); return; }
    const w = figure.clientWidth, h = figure.clientHeight;
    const mobile = img.currentSrc.includes('mobile');
    const size = mobile ? 22 : Math.max(26, Math.min(38, w * 0.032));
    // 树叶挡住的范围：桌面约左侧一半，手机约左侧六成
    const leafEdge = (mobile ? 0.6 : 0.5) * w;
    const toRight = Math.random() < 0.6;
    const y0 = h * rand(mobile ? 0.06 : 0.07, mobile ? 0.16 : 0.2);
    const y1 = y0 + h * rand(-0.04, 0.05);
    const near = leafEdge - size * 0.5, far = w + size;
    const [x0, x1] = toRight ? [near, far] : [far, near];
    const flip = toRight ? 1 : -1;
    const steps = 10, frames = [];
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const x = x0 + (x1 - x0) * p;
      const y = y0 + (y1 - y0) * p + Math.sin(p * Math.PI * 3) * size * 0.12;
      const tilt = Math.cos(p * Math.PI * 3) * 3;
      let opacity = 1;
      if (toRight && p < 0.15) opacity = p / 0.15;          // 从枝叶后出现
      if (!toRight && p > 0.85) opacity = (1 - p) / 0.15;   // 飞回枝叶后
      frames.push({ transform: `translate(${x}px, ${y}px) scaleX(${flip}) rotate(${tilt}deg)`, opacity });
    }
    gull.style.width = size + 'px';
    flight = gull.animate(frames, { duration: (mobile ? 9000 : 14000) * rand(0.85, 1.15), easing: 'linear' });
    flight.onfinish = () => { flight = null; schedule(rand(16000, 32000)); };
  }

  function update() {
    const active = visible && !document.hidden && !reduceMotion.matches;
    if (flight) active ? flight.play() : flight.pause();
    if (!active && reduceMotion.matches && flight) { flight.cancel(); flight = null; }
  }

  new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    update();
  }).observe(figure);
  document.addEventListener('visibilitychange', update);
  reduceMotion.addEventListener('change', update);

  schedule(rand(3000, 6000));
})();
