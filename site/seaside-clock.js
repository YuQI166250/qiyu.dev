// 海边的时间·自动模式：按访客浏览器的本地时间选白天、黄昏或夜晚。不取地理位置，也不查天气。
// 这个小脚本放在 <head> 里同步执行：页面画出来之前就定好首屏是什么时间，
// 夜里打开时纸面、手账一开始就是夜晚的颜色，海景等夜景图下载好再淡入，不会先闪一下白天。
// 切换按钮、过渡和自动更新都在 seaside-time.js 里。
(() => {
  'use strict';

  // 自动模式的时段：[从几点几分起（本地时间，24 小时制）, 场景]，按时间先后排列。改边界只需要改这里。
  // 午夜到第一个时段之前沿用最后一段（夜晚）。
  const HOURS = [
    ['06:00', 'day'],
    ['17:30', 'dusk'],
    ['19:30', 'night'],
  ];
  const TIMES = ['day', 'dusk', 'night'];
  const KEY = 'seaside-time'; // 本次浏览中访客的选择：auto，或手动选的 day / dusk / night

  const table = HOURS.map(([at, time]) => { const [h, m] = at.split(':').map(Number); return [h * 60 + m, time]; });
  const minuteOf = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;

  // 某个时刻应该是哪个时间
  function at(date = new Date()) {
    const now = minuteOf(date);
    let time = table[table.length - 1][1];
    for (const [m, t] of table) if (now >= m) time = t;
    return time;
  }

  // 离下一个时段边界还有多少毫秒
  function untilNext(date = new Date()) {
    const now = minuteOf(date);
    const next = table.map(([m]) => m).find((m) => m > now);
    return ((next === undefined ? table[0][0] + 1440 : next) - now) * 60000;
  }

  // 首屏：本次浏览中手动选过的时间 > 自动
  let saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (err) { /* 隐私模式等：当作没选过 */ }
  const manual = TIMES.includes(saved) ? saved : null;
  const initial = manual || at();

  window.seaClock = { at, untilNext, KEY, mode: manual ? 'manual' : 'auto', initial };

  if (initial === 'day') return;
  const root = document.documentElement;
  root.dataset.time = initial;
  root.classList.add('time-instant', 'time-boot'); // time-boot：海景先藏着，等这个时间的插画下载好
  // 和白天插画一样尽早开始下载
  for (const [media, srcset] of [
    ['(min-width: 641px)', `assets/hero/hero-seaside-desktop-${initial}-1200.webp 1200w, assets/hero/hero-seaside-desktop-${initial}.webp 1774w`],
    ['(max-width: 640px)', `assets/hero/hero-seaside-mobile-${initial}.webp 665w`],
  ]) {
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'image'; link.media = media;
    link.setAttribute('imagesrcset', srcset);
    link.setAttribute('imagesizes', media.includes('min') ? '(min-width: 1240px) 1260px, calc(100vw - 16px)' : '100vw');
    document.head.appendChild(link);
  }
  // 万一后面的脚本没能运行，也不要让海景一直藏着
  setTimeout(() => root.classList.remove('time-boot', 'time-instant'), 8000);
})();
