// Markdown → HTML for agent replies. The input is untrusted: every piece of it goes through esc(), and the
// only tags in the output are the ones written out in this file (no raw HTML, images, styles or scripts).
// Every scan below is linear: no regular expression here can backtrack over a long run of input.

const MAX_DEPTH = 8;                                  // nesting limit for emphasis, lists and blockquotes
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => s.replace(/[&<>"']/g, c => ESC[c]);
const text = s => esc(s).replace(/\n/g, '<br>\n');
const safeUrl = url => /^(?:https?:\/\/|mailto:)[^\s\x00-\x1f]+$/i.test(url);
const anchor = (url, html) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;

// ---------- inline ----------

const PUNCT = /[!-\/:-@\[-`{-~]/;                                    // what a backslash can escape
const TAGS = { '*1': ['em'], '*2': ['strong'], '*3': ['em', 'strong'], '~2': ['del'] };
const DEST = /\(<?((?:[^\s()<>]|\([^\s()<>]*\))*)>?\)/y;             // (url), one level of parentheses inside
const BARE = /https?:\/\/[^\s<>\0`]+/y;
const ANGLE = /<((?:https?:\/\/|mailto:)[^\s<>\0]+)>/y;

function inline(s) {
  const codes = [];
  return span(codeSpans(s, codes), codes, 0, false);
}

// Swaps each `code span` for a \0n\0 placeholder, so nothing inside it is read as emphasis or a link.
// (markdown() removes every \0 from the input, so a placeholder cannot be forged.)
function codeSpans(s, codes) {
  const dead = {};                                    // backtick run lengths with no closing run ahead
  let out = '', i = 0;
  for (let a; (a = s.indexOf('`', i)) >= 0;) {
    let b = a; while (s[b] === '`') b++;
    const n = b - a;
    let close = -1;
    if (s[a - 1] !== '\\' && !dead[n]) {
      for (let p = s.indexOf('`', b); p >= 0 && close < 0;) {
        let q = p; while (s[q] === '`') q++;
        if (q - p === n) close = p; else p = s.indexOf('`', q);
      }
      if (close < 0) dead[n] = true;
    }
    if (close < 0) { out += s.slice(i, b); i = b; continue; }
    let code = s.slice(b, close).replace(/\n/g, ' ');
    if (code[0] === ' ' && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
    out += `${s.slice(i, a)}\0${codes.push(`<code>${esc(code)}</code>`) - 1}\0`;
    i = close + n;
  }
  return out + s.slice(i);
}

// Index of each "[" → index of its matching "]".
function brackets(s) {
  const pair = new Map(), open = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '[') open.push(i);
    else if (s[i] === ']' && open.length) pair.set(open.pop(), i);
  }
  return pair;
}

// Where the run of n `c` characters that closes an opener ending at `from` starts, or -1.
function closer(s, from, c, n, dead) {
  if (dead[c + n]) return -1;
  for (let p = s.indexOf(c, from); p >= 0;) {
    let q = p; while (s[q] === c) q++;
    const run = q - p;                                // "*a **b** c*": a single * skips the ** pairs
    if (!/\s/.test(s[p - 1]) && (n === 1 ? run % 2 === 1 : run >= n)) return q - n;
    p = s.indexOf(c, q);
  }
  dead[c + n] = true;                                 // nothing ahead closes it, so stop looking in this string
  return -1;
}

// A bare URL starting at i, without the punctuation that trails it; '' when there is none.
function bareUrl(s, i) {
  BARE.lastIndex = i;
  const m = /\w/.test(s[i - 1] || '') ? null : BARE.exec(s);
  if (!m) return '';
  let end = m[0].length, extra = m[0].split(')').length - m[0].split('(').length;   // unmatched ")"
  for (; end > 0; end--) {
    const last = m[0][end - 1];
    if (last === ')' && extra > 0) extra--;
    else if (!'.,;:!?\'"*~]'.includes(last)) break;
  }
  const url = m[0].slice(0, end);
  return safeUrl(url) ? url : '';
}

function span(s, codes, depth, inLink) {
  const pair = s.includes('[') ? brackets(s) : null, dead = {};
  let out = '', from = 0, i = 0, m;                   // s[from..i) is plain text not yet written
  const put = (html, next) => { out += text(s.slice(from, i)) + html; from = i = next; };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && PUNCT.test(s[i + 1] || '')) put(esc(s[i + 1]), i + 2);
    else if (c === '\0') {
      const end = s.indexOf('\0', i + 1);
      put(codes[s.slice(i + 1, end)], end + 1);
    } else if (c === '*' || c === '~') {
      let n = 1; while (s[i + n] === c) n++;
      const tags = TAGS[c + n];
      const end = tags && depth < MAX_DEPTH && /\S/.test(s[i + n] || '') ? closer(s, i + n, c, n, dead) : -1;
      if (end < 0) i += n;
      else put(tags.map(t => `<${t}>`).join('') + span(s.slice(i + n, end), codes, depth + 1, inLink) + tags.map(t => `</${t}>`).reverse().join(''), end + n);
    } else if (c === '[' || (c === '!' && s[i + 1] === '[')) {       // an image becomes a link: nothing is ever loaded
      const open = c === '!' ? i + 1 : i, shut = pair.get(open);
      DEST.lastIndex = (shut ?? -1) + 1;
      m = shut === undefined ? null : DEST.exec(s);
      if (m && safeUrl(m[1])) {
        const next = DEST.lastIndex, label = span(s.slice(open + 1, shut), codes, depth + 1, true) || esc(m[1]);
        put(inLink ? label : anchor(m[1], label), next);
      } else i++;                                     // any other scheme: the source stays as plain text
    } else if (c === 'h' && !inLink && (m = bareUrl(s, i))) put(anchor(m, esc(m)), i + m.length);
    else if (c === '<' && !inLink && (ANGLE.lastIndex = i, m = ANGLE.exec(s)) && safeUrl(m[1])) put(anchor(m[1], esc(m[1])), i + m[0].length);
    else i++;
  }
  return out + text(s.slice(from));
}

// ---------- blocks ----------

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +|$)/;
const TASK = /^\[([ xX])\](?: +|$)/;

const indentOf = line => line.length - line.trimStart().length;
const strip = (line, n) => line.slice(Math.min(n, indentOf(line)));
const fence = line => { const m = FENCE.exec(line); return m && !(m[1][0] === '`' && m[2].includes('`')) ? m : null; };

// "| a | b \| c |" → ['a', 'b | c']
const cells = row => {
  const s = row.trim().replace(/\\\|/g, '\0');
  return s.slice(s[0] === '|' ? 1 : 0, s.endsWith('|') ? -1 : s.length).split('|').map(c => c.replace(/\0/g, '|').trim());
};

// The column alignments when a table starts at line i ('' = not set), else null.
function aligns(lines, i) {
  const head = lines[i], rule = lines[i + 1];
  if (!head.includes('|') || !rule?.includes('|')) return null;
  const cols = cells(rule);
  if (!cols.every(c => /^:?-+:?$/.test(c)) || cols.length !== cells(head).length) return null;
  return cols.map(c => (c[0] === ':' ? (c.endsWith(':') ? 'center' : 'left') : c.endsWith(':') ? 'right' : ''));
}

function startsBlock(lines, i, depth) {
  const line = lines[i], item = depth < MAX_DEPTH && ITEM.exec(line);
  return fence(line) || HEADING.test(line) || RULE.test(line) || (depth < MAX_DEPTH && QUOTE.test(line))
    || (item && line.length > item[0].length) || aligns(lines, i);
}

// The list that starts at lines[start]. A line indented two or more past the marker belongs to the item above it.
function list(lines, start, depth) {
  const first = ITEM.exec(lines[start]), base = first[1].length, ordered = /\d/.test(first[2]);
  const items = [];
  let loose = false, i = start;
  for (;;) {
    let j = i; while (j < lines.length && !lines[j].trim()) j++;     // blank lines count only if the list goes on
    if (j === lines.length) break;
    const line = lines[j], indent = indentOf(line), m = indent < base + 2 ? ITEM.exec(line) : null;
    if (m && /\d/.test(m[2]) === ordered && !RULE.test(line)) items.push({ width: m[1].length + m[2].length + 1, lines: [line.slice(m[0].length)] });
    else if (indent >= base + 2) {
      const item = items.at(-1);
      for (let k = i; k < j; k++) item.lines.push('');
      item.lines.push(strip(line, item.width));
    } else break;
    if (j > i) loose = true;
    i = j + 1;
  }
  const html = items.map(item => {
    const task = TASK.exec(item.lines[0]);
    if (task) item.lines[0] = item.lines[0].slice(task[0].length);
    const box = task ? `<span class="box">${task[1] === ' ' ? '☐' : '☑'}</span> ` : '';
    return `<li${task ? ' class="task"' : ''}>${box}${blocks(item.lines, depth + 1, !loose).trim()}</li>\n`;
  }).join('');
  const tag = ordered ? 'ol' : 'ul', number = parseInt(first[2], 10);
  return { html: `<${tag}${ordered && number !== 1 ? ` start="${number}"` : ''}>\n${html}</${tag}>\n`, next: i };
}

// `tight` (inside a list with no blank lines) writes paragraphs without their <p>.
function blocks(lines, depth, tight) {
  let out = '', i = 0, m;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) i++;
    else if ((m = fence(line))) {                     // the language tag is accepted and dropped
      const close = new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},}[ \\t]*$`), indent = indentOf(line), body = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(strip(lines[i], indent));
      if (i === lines.length) while (body.length && !body.at(-1).trim()) body.pop();   // unclosed: runs to the end
      i++;
      out += `<pre><code>${esc(body.join('\n'))}</code></pre>\n`;
    } else if ((m = HEADING.exec(line))) {
      const h = `h${m[1].length}`;
      out += `<${h}>${inline(line.slice(m[0].length).trim())}</${h}>\n`;
      i++;
    } else if (RULE.test(line)) { out += '<hr>\n'; i++; }
    else if (depth < MAX_DEPTH && QUOTE.test(line)) {
      const inner = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(lines[i].replace(QUOTE, ''));
      out += `<blockquote>\n${blocks(inner, depth + 1, false)}</blockquote>\n`;
    } else if (depth < MAX_DEPTH && ITEM.test(line)) {
      const found = list(lines, i, depth);
      out += found.html;
      i = found.next;
    } else if ((m = aligns(lines, i))) {
      const cols = m;
      const row = (line, tag) => {
        const values = cells(line);
        return `<tr>${cols.map((align, k) => `<${tag}${align && ` class="${align}"`}>${inline(values[k] ?? '')}</${tag}>`).join('')}</tr>\n`;
      };
      let body = '';
      const head = row(line, 'th');
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) body += row(lines[i], 'td');
      out += `<div class="table"><table>\n<thead>\n${head}</thead>\n${body && `<tbody>\n${body}</tbody>\n`}</table></div>\n`;
    } else {
      const para = [line.trim()];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i, depth); i++) para.push(lines[i].trim());
      out += tight ? `${inline(para.join('\n'))}\n` : `<p>${inline(para.join('\n'))}</p>\n`;
    }
  }
  return out;
}

// The one entry point: Markdown text in, HTML out. Safe to assign to innerHTML.
export function markdown(source) {
  const lines = String(source ?? '')
    .replace(/\0/g, '\uFFFD')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]+/gm, space => space.replace(/\t/g, '    '))
    .split('\n');
  return blocks(lines, 0, false);
}
