// 海边声景：页头「听听海」开关。默认静音，点开后才下载声音（约 300KB）。
// 三层声音：海浪一直在（同一段录音分成近、远两层，以不同速度循环，叠起来不会听出 22 秒的重复），
// 海风在下面缓慢起伏，远处的海鸥隔一阵随机叫一声。
// 开关、页面隐藏、来电打断时都用音量渐变，不会突然出声或断掉。
(() => {
  'use strict';

  const button = document.querySelector('.sound-toggle');
  const label = button && button.querySelector('.sound-label');
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!button || !label || !AC) return; // 不支持 Web Audio 时开关保持隐藏

  const BASE = 'assets/audio/';
  const PAD = 1; // 循环文件首尾各多放了 1 秒（见 scripts/make-ambience.py）
  const LOOPS = { waves: 21.7699, wind: 36 };
  const GULLS = [[1, 3.3], [5.3, 6], [12.3, 5.4]]; // 海鸥音效表里每组叫声的 [开始, 时长]（秒），尾巴已带长淡出

  // 三种声音的音量（0–1）和海鸥出现的间隔（秒）——试听后在这里定稿
  const mix = {
    waves: 0.7,
    wind: 0.25,
    gulls: 0.22,
    gullGap: [12, 32], // 上一组叫完之后再等这么久
  };
  const FADE_IN = 2.5, FADE_OUT = 1.2;

  let ctx = null, master = null, buses = null, layers = null, echo = null, buffers = null, loading = null;
  let wanted = false, started = false;
  let timers = [], suspendTimer = 0, lastGull = -1, retryArmed = false;

  const rand = (a, b) => a + Math.random() * (b - a);

  function setUi(state) {
    // state: off | loading | on | error
    button.dataset.state = state;
    label.textContent = state === 'error' ? '暂时听不到' : '听听海';
    button.setAttribute('aria-pressed', String(state === 'on' || state === 'loading'));
    button.setAttribute('aria-busy', String(state === 'loading'));
    button.title = state === 'on' ? '关掉海边的声音' : state === 'error' ? '海的声音暂时没能载入，稍后再试' : '打开海边的声音';
  }

  async function loadBuffer(name) {
    // 首选 Opus（体积小）；个别浏览器解不了时退回 AAC
    for (const ext of ['webm', 'm4a']) {
      try {
        const res = await fetch(BASE + name + '.' + ext);
        if (!res.ok) throw new Error(res.status + ' ' + res.url);
        const data = await res.arrayBuffer();
        return await new Promise((resolve, reject) => {
          const p = ctx.decodeAudioData(data, resolve, reject); // 旧版 Safari 只认回调写法
          if (p && p.catch) p.catch(reject);
        });
      } catch (err) {
        if (ext === 'm4a') throw err;
      }
    }
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    buses = {};
    for (const k of ['waves', 'wind', 'gulls']) {
      buses[k] = ctx.createGain();
      buses[k].gain.value = mix[k];
      buses[k].connect(master);
    }
    // 海鸥的空间余响：叫声停下后还有一点在海湾上空散开的尾音，不会戛然而止
    echo = ctx.createConvolver();
    echo.buffer = airImpulse(2.8);
    const echoTone = ctx.createBiquadFilter(), echoGain = ctx.createGain();
    echoTone.type = 'lowpass'; echoTone.frequency.value = 2400;
    echoGain.gain.value = 0.45;
    echo.connect(echoTone).connect(echoGain).connect(buses.gulls);
  }

  // 现场生成一段指数衰减的立体声噪声当作“空气”的冲激响应，不用额外下载
  function airImpulse(seconds) {
    const n = Math.round(seconds * ctx.sampleRate), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3) * Math.min(1, i / (0.02 * ctx.sampleRate));
      }
    }
    return ir;
  }

  const panner = (value) => {
    if (!ctx.createStereoPanner) return ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = value; return p;
  };

  function loop(buffer, length, rate, offset) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = PAD;
    src.loopEnd = PAD + length;
    src.playbackRate.value = rate;
    src.start(0, PAD + offset);
    return src;
  }

  // 让某个音量在一个范围里慢慢漂移，像风和浪的强弱自然变化
  function drift(param, lo, hi, every, tc) {
    const step = () => {
      if (!ctx || ctx.state !== 'running') return;
      param.setTargetAtTime(rand(lo, hi), ctx.currentTime, tc);
      timers.push(setTimeout(step, rand(every[0], every[1]) * 1000));
    };
    step();
  }

  function startLayers() {
    started = true;
    const { waves, wind } = buffers;
    // 近处的浪：原速
    const nearGain = ctx.createGain(), nearPan = panner(-0.12);
    loop(waves, LOOPS.waves, 1, rand(0, LOOPS.waves)).connect(nearGain);
    nearGain.connect(nearPan).connect(buses.waves);
    // 远一点的浪：稍慢、更闷、更轻，和近处错开；两层周期不同，组合起来很久都不会重复
    const farGain = ctx.createGain(), farPan = panner(0.35), farTone = ctx.createBiquadFilter();
    farTone.type = 'lowpass'; farTone.frequency.value = 1300;
    farGain.gain.value = 0.5;
    loop(waves, LOOPS.waves, 0.91, rand(0, LOOPS.waves)).connect(farTone);
    farTone.connect(farGain).connect(farPan).connect(buses.waves);
    // 海风
    const windGain = ctx.createGain(), windPan = panner(0);
    windGain.gain.value = 0.8;
    loop(wind, LOOPS.wind, 1, rand(0, LOOPS.wind)).connect(windGain);
    windGain.connect(windPan).connect(buses.wind);

    layers = { nearGain, farGain, windGain, windPan };
  }

  // 起伏和海鸥用定时器驱动；静音或页面隐藏时全部停掉，回来再重新排
  function animate() {
    stopTimers();
    if (!layers) return;
    drift(layers.nearGain.gain, 0.8, 1, [6, 12], 2.5);
    drift(layers.farGain.gain, 0.35, 0.6, [7, 14], 3);
    drift(layers.windGain.gain, 0.45, 1, [5, 11], 3.5);
    if (layers.windPan.pan) drift(layers.windPan.pan, -0.35, 0.35, [8, 16], 5);
    timers.push(setTimeout(gull, rand(5, 12) * 1000));
  }

  function gull(once) {
    if (!ctx || ctx.state !== 'running' || !buffers) return;
    let i;
    do { i = Math.floor(Math.random() * GULLS.length); } while (i === lastGull && GULLS.length > 1);
    lastGull = i;
    const [at, len] = GULLS[i];
    const t0 = ctx.currentTime + 0.05, rate = rand(0.94, 1.05), dur = len / rate;
    const src = ctx.createBufferSource(), g = ctx.createGain(), tone = ctx.createBiquadFilter();
    const p0 = rand(-0.6, 0.6), pan = panner(p0);
    src.buffer = buffers.gulls;
    tone.type = 'lowpass';
    // 飞远：边叫边往一侧移开，声音慢慢变闷、变轻，音调也略微往下沉一点
    const f0 = rand(3200, 4500), g0 = rand(0.6, 1);
    src.playbackRate.setValueAtTime(rate, t0);
    src.playbackRate.linearRampToValueAtTime(rate * 0.98, t0 + dur);
    tone.frequency.setValueAtTime(f0, t0);
    tone.frequency.setValueAtTime(f0, t0 + dur * 0.35);
    tone.frequency.exponentialRampToValueAtTime(f0 * 0.4, t0 + dur);
    g.gain.setValueAtTime(g0, t0);
    g.gain.linearRampToValueAtTime(g0 * 0.55, t0 + dur);
    if (pan.pan) {
      const away = Math.max(-0.9, Math.min(0.9, p0 + (p0 < 0 ? -1 : 1) * rand(0.2, 0.4)));
      pan.pan.setValueAtTime(p0, t0);
      pan.pan.linearRampToValueAtTime(away, t0 + dur);
    }
    src.connect(tone).connect(g).connect(pan);
    pan.connect(buses.gulls);
    pan.connect(echo);
    src.start(t0, at, len);
    // 下一声从这一组结束后再算间隔
    if (!once) timers.push(setTimeout(gull, (dur + rand(mix.gullGap[0], mix.gullGap[1])) * 1000));
  }

  function stopTimers() { timers.forEach(clearTimeout); timers = []; }

  function fadeTo(value, seconds) {
    const g = master.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(value, t + seconds);
  }

  // 真正出声：需要 ctx 在运行、声音已载入、用户想听、页面在前台
  async function play() {
    clearTimeout(suspendTimer);
    if (!wanted || document.hidden || !buffers) return;
    try { if (ctx.state !== 'running') await ctx.resume(); } catch (err) { /* 下面统一处理 */ }
    if (!wanted || document.hidden) return;
    if (ctx.state !== 'running') { armRetry(); return; }
    if (!started) startLayers();
    animate();
    fadeTo(1, FADE_IN);
    setUi('on');
  }

  // 淡出后再挂起，挂起时不耗电；keepWanted 表示只是页面暂时隐藏
  function pause(seconds) {
    stopTimers();
    if (!ctx || !master) return;
    if (ctx.state === 'running') fadeTo(0, seconds);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (ctx && ctx.state === 'running' && (!wanted || document.hidden)) ctx.suspend().catch(() => {});
    }, seconds * 1000 + 100);
  }

  // 移动端有时不允许在没有点按的情况下恢复声音（比如切回页面、来电结束后），等下一次点按再接着放
  function armRetry() {
    if (retryArmed) return;
    retryArmed = true;
    const again = () => {
      retryArmed = false;
      document.removeEventListener('pointerdown', again, true);
      document.removeEventListener('keydown', again, true);
      if (wanted) play();
    };
    document.addEventListener('pointerdown', again, true);
    document.addEventListener('keydown', again, true);
  }

  function setSession(type) {
    // iOS 17+：打开时按“播放”处理，静音拨片打开也能听到；关掉后交还给系统
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (err) { /* 忽略 */ }
  }

  async function turnOn() {
    wanted = true;
    setSession('playback');
    if (!ctx) {
      try {
        ctx = new AC({ latencyHint: 'playback' });
      } catch (err) {
        ctx = null;
        return fail(err);
      }
      buildGraph();
      ctx.addEventListener('statechange', () => {
        // iOS 来电、Siri 等会把声音“打断”；恢复后如果用户还想听，就接着淡入
        if (ctx.state === 'running') return;
        stopTimers();
        if (wanted && !document.hidden && buffers) armRetry();
      });
    }
    // 必须在点按事件里同步调用 resume，iOS 才会放行
    const resumed = ctx.resume();
    if (!buffers) {
      setUi('loading');
      loading = loading || Promise.all(['sea-waves', 'sea-wind', 'sea-gulls'].map(loadBuffer))
        .then(([waves, wind, gulls]) => { buffers = { waves, wind, gulls }; });
      try {
        await loading;
      } catch (err) {
        loading = null;
        return fail(err);
      }
    }
    try { await resumed; } catch (err) { /* play() 会再试 */ }
    play();
  }

  function turnOff() {
    wanted = false;
    setUi('off');
    pause(FADE_OUT);
    setTimeout(() => { if (!wanted) setSession('auto'); }, FADE_OUT * 1000 + 200);
  }

  function fail(err) {
    console.warn('海边声景没能开启：', err);
    wanted = false;
    setSession('auto');
    if (ctx && master) pause(0.2);
    setUi('error');
    setTimeout(() => { if (button.dataset.state === 'error') setUi('off'); }, 4000);
  }

  button.addEventListener('click', () => {
    if (wanted) turnOff(); else turnOn();
  });

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) pause(0.4);
    else if (wanted) play();
  });
  window.addEventListener('pagehide', () => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && wanted && ctx) play(); });

  // 本地试听调比例用：seaAmbience.set('wind', 0.2)
  window.seaAmbience = {
    mix,
    set(name, value) {
      if (name === 'gullGap') { mix.gullGap = value; return; }
      mix[name] = value;
      if (buses && buses[name]) buses[name].gain.setTargetAtTime(value, ctx.currentTime, 0.15);
    },
    gull: () => gull(true),
  };

  setUi('off');
  button.hidden = false;
})();
