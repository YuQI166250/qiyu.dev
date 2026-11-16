// 代码高亮：在生成页面时就把代码块按语法上色（输出带 class 的 <span>），浏览器里不用再加载任何高亮库。
// 不追求完美，只认最常见的几类：注释、字符串、数字、关键字、函数名、true/false/null、
// CSS 属性、HTML 标签和属性、Shell 变量、Python 装饰器。认不出的语言只做注释、字符串和数字。
// 返回每一行的 HTML（已转义，标签在行内闭合），交给生成器包成一行一个 <span class="line">。

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = {
  comment: [/\/\/[^\n]*/y, /\/\*[\s\S]*?(?:\*\/|$)/y],
  string: [/"(?:\\.|[^"\\\n])*"?/y, /'(?:\\.|[^'\\\n])*'?/y, /`(?:\\.|[^`\\])*`?/y],
  keywords: words(`break case catch class const continue debugger default delete do else export extends finally for from
    function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await
    static get set enum interface implements package private protected public readonly type namespace declare abstract as
    struct impl fn pub mut use mod match loop where trait func go defer chan select range map val fun when object
    int float double char long short byte bool boolean string unsigned signed auto sizeof typedef include define`),
  literals: words('true false null undefined NaN Infinity nil None self'),
};
const PYTHON = {
  comment: [/#[^\n]*/y],
  string: [/[rRbBfFuU]{0,2}"""[\s\S]*?(?:"""|$)/y, /[rRbBfFuU]{0,2}'''[\s\S]*?(?:'''|$)/y,
    /[rRbBfFuU]{0,2}"(?:\\.|[^"\\\n])*"?/y, /[rRbBfFuU]{0,2}'(?:\\.|[^'\\\n])*'?/y],
  meta: [/@[\w.]+/y],
  keywords: words(`and as assert async await break class continue def del elif else except finally for from global if import in
    is lambda nonlocal not or pass raise return try while with yield match case`),
  literals: words('True False None self cls'),
};
const SHELL = {
  comment: [/#[^\n]*/y],
  string: [/"(?:\\.|[^"\\])*"?/y, /'[^']*'?/y],
  var: [/\$\{[^}]*\}/y, /\$\w+/y, /\$[@#?*!$-]/y],
  keywords: words(`if then else elif fi for while until do done case esac function return in select export local readonly
    unset shift exit source alias echo cd ls cat grep sed awk mkdir rm cp mv chmod sudo git npm npx node python pip curl`),
  literals: words('true false'),
};
const CSS = {
  comment: [/\/\*[\s\S]*?(?:\*\/|$)/y],
  string: [/"(?:\\.|[^"\\\n])*"?/y, /'(?:\\.|[^'\\\n])*'?/y],
  attr: [/[\w-]+(?=\s*:(?!:)[^{]*[;}])/y],
  number: [/#[0-9a-fA-F]{3,8}\b/y, /-?\d*\.?\d+(?:%|[a-zA-Z]+)?/y],
  meta: [/@[\w-]+/y],
  keywords: words('!important'),
  literals: words('none auto inherit initial unset transparent currentColor'),
};
const SQL = {
  comment: [/--[^\n]*/y, /\/\*[\s\S]*?(?:\*\/|$)/y],
  string: [/'(?:''|[^'])*'?/y, /"[^"]*"?/y],
  keywords: words(`select from where and or not insert into values update set delete create table drop alter add join left
    right inner outer full on as group by order having limit offset distinct union all case when then else end is like
    in between exists primary key foreign references index view default count sum avg min max`),
  caseless: true,
  literals: words('true false null'),
};
const JSON_ = {
  comment: [/\/\/[^\n]*/y, /\/\*[\s\S]*?(?:\*\/|$)/y],
  attr: [/"(?:\\.|[^"\\\n])*"(?=\s*:)/y],
  string: [/"(?:\\.|[^"\\\n])*"?/y],
  keywords: words(''),
  literals: words('true false null'),
};
const YAML = {
  comment: [/#[^\n]*/y],
  attr: [/[\w.-]+(?=\s*[:=](?:\s|$))/y],
  string: [/"(?:\\.|[^"\\\n])*"?/y, /'(?:''|[^'\n])*'?/y],
  keywords: words(''),
  literals: words('true false null yes no on off'),
};
const GENERIC = {
  comment: [/\/\/[^\n]*/y, /#[^\n]*/y, /\/\*[\s\S]*?(?:\*\/|$)/y],
  string: [/"(?:\\.|[^"\\\n])*"?/y, /'(?:\\.|[^'\\\n])*'?/y],
  keywords: words(''),
  literals: words('true false null'),
};

const ALIASES = [
  [C_LIKE, 'js javascript ts typescript jsx tsx mjs cjs java c h cpp c++ cc hpp cs csharp go rust rs swift kotlin kt php dart scala'],
  [PYTHON, 'py python python3'],
  [SHELL, 'sh bash shell zsh console powershell ps1 ps bat cmd'],
  [CSS, 'css scss sass less'],
  [SQL, 'sql mysql postgres postgresql sqlite'],
  [JSON_, 'json jsonc json5'],
  [YAML, 'yaml yml toml ini conf'],
  ['markup', 'html htm xml svg vue'],
];
const BY_LANG = new Map(ALIASES.flatMap(([rules, names]) => names.split(' ').map((n) => [n, rules])));
const rulesFor = (lang) => BY_LANG.get((lang || '').toLowerCase()) || GENERIC;

// HTML / XML：注释、标签名、属性名、属性值
function markupTokens(code) {
  const out = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[\w:-]+|\s[\w:@.-]+(?==)|"[^"]*"|'[^']*'/y;
  let i = 0, text = '';
  while (i < code.length) {
    re.lastIndex = i;
    const m = re.exec(code);
    if (!m) { text += code[i++]; continue; }
    if (text) { out.push(['', text]); text = ''; }
    const t = m[0];
    if (t.startsWith('<!--')) out.push(['comment', t]);
    else if (t.startsWith('<')) { const n = t.startsWith('</') ? 2 : 1; out.push(['', t.slice(0, n)], ['tag', t.slice(n)]); }
    else if (/^\s/.test(t)) out.push(['', t[0]], ['attr', t.slice(1)]);
    else out.push(['string', t]);
    i += t.length;
  }
  if (text) out.push(['', text]);
  return out;
}

const NUMBER = [/0[xX][0-9a-fA-F_]+\b/y, /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y];
const ORDER = ['comment', 'meta', 'attr', 'string', 'var', 'number'];

function tokens(code, rules) {
  if (rules === 'markup') return markupTokens(code);
  const out = [];
  let i = 0, text = '';
  const flush = () => { if (text) { out.push(['', text]); text = ''; } };
  outer: while (i < code.length) {
    for (const type of ORDER) {
      const list = type === 'number' ? rules.number || NUMBER : rules[type];
      if (!list) continue;
      // 数字前面紧挨着字母时是变量名的一部分（x2、h1），不算数字
      if (type === 'number' && /[\w$]/.test(code[i - 1] || '') && code[i] !== '#') continue;
      for (const re of list) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (m && m[0]) { flush(); out.push([type, m[0]]); i += m[0].length; continue outer; }
      }
    }
    if (/[A-Za-z_$!]/.test(code[i])) {
      const id = rules === CSS || rules === SHELL ? /!?[A-Za-z_$][\w$-]*/y : /[A-Za-z_$][\w$]*/y;
      id.lastIndex = i;
      const m = id.exec(code);
      if (m) {
        const w = m[0];
        const key = rules.caseless ? w.toLowerCase() : w;
        let type = '';
        if (rules.keywords.has(key)) type = 'keyword';
        else if (rules.literals.has(key)) type = 'literal';
        else if (/^\s*\(/.test(code.slice(i + w.length))) type = 'fn';
        if (type) { flush(); out.push([type, w]); } else text += w;
        i += w.length;
        continue;
      }
    }
    text += code[i++];
  }
  flush();
  return out;
}

export function highlight(code, lang) {
  const html = tokens(code, rulesFor(lang))
    .map(([type, t]) => t.split('\n').map((piece) => (type && piece ? `<span class="tok-${type}">${esc(piece)}</span>` : esc(piece))).join('\n'))
    .join('');
  return html.split('\n');
}
