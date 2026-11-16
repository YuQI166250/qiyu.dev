// 数学公式：把文章里的 LaTeX 写法（$…$ 行内、$$…$$ 单独成段）在生成页面时转成 MathML。
// MathML 是浏览器原生支持的数学排版（Chrome、Edge、Safari、Firefox 都能显示），不用加载任何公式库，也不用联网。
// 只实现写学习笔记常用的那部分：上下标、分数、根号、求和/连乘/积分/极限、希腊字母、常见运算符和关系符、
// 括号自动伸缩、矩阵和分段函数、\text、\mathbf、\mathbb、\hat 等。遇到不认识的命令会抛错，生成器就原样显示公式源码。

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const OPS = {
  cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙', oplus: '⊕', otimes: '⊗',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  ll: '≪', gg: '≫', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
  Leftrightarrow: '⇔', iff: '⇔', implies: '⇒', mapsto: '↦', gets: '←', uparrow: '↑', downarrow: '↓',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', mid: '∣', parallel: '∥', perp: '⊥',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', colon: ':', prime: '′',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖',
  lbrace: '{', rbrace: '}', '{': '{', '}': '}', '|': '‖', '%': '%', '$': '$', '#': '#', '&': '&amp;', _: '_',
};
const IDENT = { infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅', hbar: 'ℏ', ell: 'ℓ', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', angle: '∠', triangle: '△', degree: '°' };
const BIG = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
const FUNCS = 'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp det dim gcd deg arg ker Pr hom';
const LIMS = 'lim limsup liminf max min sup inf argmax argmin';
const FN = new Set(FUNCS.split(' ')), LIM = new Set(LIMS.split(' '));
const SPACES = { ',': '0.1667em', ':': '0.2222em', ';': '0.2778em', ' ': '0.25em', quad: '1em', qquad: '2em', '!': '-0.1667em', enspace: '0.5em' };
const ACCENTS = { hat: '^', widehat: '^', bar: '¯', overline: '¯', vec: '→', tilde: '~', widetilde: '~', dot: '˙', ddot: '¨', check: 'ˇ', breve: '˘' };
const FONTS = { mathbf: 'bold', mathbb: 'double-struck', mathcal: 'script', mathfrak: 'fraktur', mathsf: 'sans-serif', mathtt: 'monospace', mathrm: 'normal', mathit: 'italic', boldsymbol: 'bold-italic', bm: 'bold-italic' };
const ENVS = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''], aligned: ['', ''], align: ['', ''], 'align*': ['', ''], array: ['', ''] };
const FENCE = { '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '.': '', '\\{': '{', '\\}': '}', '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '\\|': '‖', '\\vert': '|', '\\Vert': '‖' };

function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+\*?|.)/.exec(src.slice(i));
      if (!m) throw new Error('trailing backslash');
      out.push({ t: 'cmd', v: m[1] }); i += m[0].length; continue;
    }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i)); out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z]/.test(c)) { out.push({ t: 'id', v: c }); i++; continue; }
    out.push({ t: 'ch', v: c }); i++;
  }
  return out;
}

function parse(tokens, display) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isCh = (tok, v) => tok && tok.t === 'ch' && tok.v === v;
  const isCmd = (tok, v) => tok && tok.t === 'cmd' && tok.v === v;

  const row = (items) => (items.length === 1 ? items[0] : `<mrow>${items.join('')}</mrow>`);
  const textArg = () => {
    if (!isCh(next(), '{')) throw new Error('expected {');
    let depth = 1, s = '';
    for (;;) {
      const tok = next();
      if (!tok) throw new Error('unclosed {');
      if (isCh(tok, '{')) depth++;
      if (isCh(tok, '}') && --depth === 0) break;
      s += tok.t === 'cmd' ? (tok.v === ' ' || tok.v === ',' ? ' ' : '\\' + tok.v) : tok.v;
    }
    return s;
  };
  const group = () => { // 一个参数：{…} 或单个记号
    const tok = peek();
    if (isCh(tok, '{')) { next(); const items = list((t) => isCh(t, '}')); next(); return row(items); }
    return atom();
  };
  const fence = () => {
    const tok = next();
    const key = tok.t === 'cmd' ? '\\' + tok.v : tok.v;
    if (!(key in FENCE)) throw new Error('bad fence ' + key);
    return FENCE[key];
  };
  const op = (v, attrs = '') => `<mo${attrs}>${v}</mo>`;

  function env(name) {
    if (!(name in ENVS)) throw new Error('unknown env ' + name);
    if (name === 'array' && isCh(peek(), '{')) textArg(); // 列格式，不管
    const rows = [[[]]];
    for (;;) {
      const tok = peek();
      if (!tok) throw new Error('unclosed env');
      if (isCmd(tok, 'end')) { next(); if (textArg() !== name) throw new Error('env mismatch'); break; }
      if (isCh(tok, '&')) { next(); rows.at(-1).push([]); continue; }
      if (isCmd(tok, '\\')) { next(); rows.push([[]]); continue; }
      rows.at(-1).at(-1).push(...list((t) => !t || isCh(t, '&') || isCmd(t, '\\') || isCmd(t, 'end'), true));
    }
    if (!rows.at(-1).some((c) => c.length)) rows.pop();
    const left = name === 'cases' || name.startsWith('align') ? ' columnalign="left" columnspacing="1.2em"' : '';
    const table = `<mtable${left}>${rows.map((r) => `<mtr>${r.map((c) => `<mtd>${row(c.length ? c : ['<mrow></mrow>'])}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
    const [l, r] = ENVS[name];
    return l || r ? `<mrow>${l ? op(l, ' fence="true" stretchy="true"') : ''}${table}${r ? op(r, ' fence="true" stretchy="true"') : ''}</mrow>` : table;
  }

  function atom() {
    const tok = next();
    if (!tok) throw new Error('unexpected end');
    if (tok.t === 'num') return `<mn>${tok.v}</mn>`;
    if (tok.t === 'id') return `<mi>${tok.v}</mi>`;
    if (tok.t === 'ch') {
      if (tok.v === '{') { const items = list((t) => isCh(t, '}')); next(); return row(items); }
      if (tok.v === "'") return op('′');
      if (tok.v === '-') return op('−');
      if (tok.v === '<') return op('&lt;');
      if (tok.v === '>') return op('&gt;');
      if (tok.v === '&') throw new Error('stray &');
      if (/[()[\]|]/.test(tok.v)) return op(tok.v, ' stretchy="false"');
      if (/[+=*/,;:!?.]/.test(tok.v)) return op(tok.v === '*' ? '∗' : tok.v);
      return `<mi>${esc(tok.v)}</mi>`;
    }
    const c = tok.v;
    if (c in GREEK) return `<mi${/[A-Z]/.test(c[0]) ? ' mathvariant="normal"' : ''}>${GREEK[c]}</mi>`;
    if (c in IDENT) return `<mi mathvariant="normal">${IDENT[c]}</mi>`;
    if (c === '{' || c === '}' || c === 'lbrace' || c === 'rbrace') return op(OPS[c], ' stretchy="false"'); // 不用 \left 时括号不伸缩
    if (c in OPS) return op(OPS[c]);
    if (c in BIG) return op(BIG[c], ' largeop="true"');
    if (FN.has(c)) return `<mi>${c}</mi>`;
    if (LIM.has(c)) return `<mo movablelimits="true" form="prefix">${c}</mo>`;
    if (c in SPACES) return `<mspace width="${SPACES[c]}"></mspace>`;
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') return `<mfrac>${group()}${group()}</mfrac>`;
    if (c === 'binom') return `<mrow>${op('(')}<mfrac linethickness="0">${group()}${group()}</mfrac>${op(')')}</mrow>`;
    if (c === 'sqrt') {
      if (isCh(peek(), '[')) { next(); const idx = list((t) => isCh(t, ']')); next(); return `<mroot>${group()}${row(idx)}</mroot>`; }
      return `<msqrt>${group()}</msqrt>`;
    }
    if (c === 'text' || c === 'textrm' || c === 'mbox' || c === 'textit' || c === 'textbf') return `<mtext>${esc(textArg())}</mtext>`;
    if (c === 'operatorname') return `<mi>${esc(textArg())}</mi>`;
    if (c in FONTS) return `<mstyle mathvariant="${FONTS[c]}">${group()}</mstyle>`;
    if (c in ACCENTS) return `<mover accent="true">${group()}${op(ACCENTS[c], ' stretchy="true"')}</mover>`;
    if (c === 'underline') return `<munder>${group()}${op('_', ' stretchy="true"')}</munder>`;
    if (c === 'overset' || c === 'stackrel') { const over = group(); return `<mover>${group()}${over}</mover>`; }
    if (c === 'underset') { const under = group(); return `<munder>${group()}${under}</munder>`; }
    if (c === 'left') {
      const l = fence();
      const items = list((t) => isCmd(t, 'right'));
      next();
      const r = fence();
      return `<mrow>${l ? op(l, ' fence="true" stretchy="true"') : ''}${items.join('')}${r ? op(r, ' fence="true" stretchy="true"') : ''}</mrow>`;
    }
    if (c === 'begin') return env(textArg());
    if (['big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr'].includes(c)) return op(fence());
    if (c === 'displaystyle') return '';
    throw new Error('unknown command \\' + c);
  }

  // 一串式子，到 stop 为止；处理上下标
  function list(stop, inEnv = false) {
    const items = [];
    while (peek() && !stop(peek())) {
      if (inEnv && (isCh(peek(), '&') || isCmd(peek(), '\\'))) break;
      if (isCh(peek(), '}') && !stop(peek())) throw new Error('unbalanced }');
      let base = atom();
      if (base === '') continue;
      let sub = null, sup = null;
      for (;;) {
        if (isCh(peek(), '_') && sub === null) { next(); sub = group(); continue; }
        if (isCh(peek(), '^') && sup === null) { next(); sup = group(); continue; }
        if (isCh(peek(), "'")) { next(); sup = sup ? row([sup, op('′')]) : op('′'); continue; }
        break;
      }
      if (sub !== null || sup !== null) {
        const under = display && /largeop|movablelimits/.test(base);
        if (sub !== null && sup !== null) base = under ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
        else if (sub !== null) base = under ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
        else base = under ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
      }
      items.push(base);
    }
    return items;
  }

  const items = list(() => false);
  if (p < tokens.length) throw new Error('unexpected ' + tokens[p].v);
  return row(items.length ? items : ['<mrow></mrow>']);
}

export function tex2mathml(tex, display = false) {
  const body = parse(lex(tex), display);
  return `<math${display ? ' display="block"' : ''}><semantics>${body}<annotation encoding="application/x-tex">${esc(tex)}</annotation></semantics></math>`;
}
