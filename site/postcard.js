// 旅行手账里的明信片：点击、轻触或按 Enter / 空格翻面，再按一次翻回正面。
// 翻面期间给手账加 is-turning，让纸胶带先揭起、翻好后贴回；减少动态效果时由 CSS 改为淡入淡出。
(() => {
  'use strict';

  const card = document.querySelector('.journal-postcard');
  const journal = card && card.closest('.journal');
  const inner = card && card.querySelector('.postcard-inner');
  if (!card || !journal || !inner) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const LABELS = {
    front: ['明信片：海边露台与海湾。点一下翻到背面', '点一下，翻到背面'],
    back: ['明信片背面：风从海上来，带来一点新的灵感。点一下翻回正面', '点一下，翻回正面'],
  };
  let timer = 0;

  function settle() {
    clearTimeout(timer);
    journal.classList.remove('is-turning');
  }

  card.addEventListener('click', () => {
    const flipped = card.classList.toggle('is-flipped');
    const [label, title] = LABELS[flipped ? 'back' : 'front'];
    card.setAttribute('aria-label', label);
    card.title = title;

    if (reduceMotion.matches) return;
    journal.classList.add('is-turning');
    clearTimeout(timer);
    timer = setTimeout(settle, 1100); // transitionend 未触发时兜底
  });

  inner.addEventListener('transitionend', (e) => {
    if (e.target === inner && e.propertyName === 'transform') settle();
  });
})();
