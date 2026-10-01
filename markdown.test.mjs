import { expect, test } from 'bun:test';
import { markdown } from './public/markdown.js';

const A = ' target="_blank" rel="noopener noreferrer"';
const link = (url, label) => `<a href="${url}"${A}>${label}</a>`;
const md = text => markdown(text).trim();

// ---------- the owner's sample ----------

const sample = `All five prototypes are running. **[Open the comparison](http://127.0.0.1:4401/?variant=flight)** and use the bottom selector or arrows to switch.

| Prototype | Character |
|---|---|
| [Flight deck queue](http://127.0.0.1:4401/?variant=flight) | Slate operational strips, aligned state fields, amber attention signals |
| [Packet capture workbench](http://127.0.0.1:4401/?variant=packet) | Teal inspection table with compact developer-tool navigation |

Each includes all six list views. **Sample data only; the production app is unchanged.**

Built with parallel subagents. Committed as \`c68f7aa\`.`;

test('the sample reply renders a bold link, a table with links, bold text and inline code', () => {
  const html = markdown(sample);
  expect(html).toContain(`<p>All five prototypes are running. <strong>${link('http://127.0.0.1:4401/?variant=flight', 'Open the comparison')}</strong> and use`);
  expect(html).toContain('<thead>\n<tr><th>Prototype</th><th>Character</th></tr>\n</thead>');
  expect(html).toContain(`<tr><td>${link('http://127.0.0.1:4401/?variant=flight', 'Flight deck queue')}</td><td>Slate operational strips, aligned state fields, amber attention signals</td></tr>`);
  expect(html).toContain(`<tr><td>${link('http://127.0.0.1:4401/?variant=packet', 'Packet capture workbench')}</td><td>Teal inspection table`);
  expect(html).toContain('<strong>Sample data only; the production app is unchanged.</strong>');
  expect(html).toContain('Committed as <code>c68f7aa</code>.</p>');
  expect(html.match(/<a /g)).toHaveLength(3);
  expect(html).not.toContain('**');
  expect(html).not.toContain('|');
});

// ---------- each construct ----------

test('paragraphs: a blank line separates them, a single newline is a line break', () => {
  expect(md('one\ntwo\n\nthree')).toBe('<p>one<br>\ntwo</p>\n<p>three</p>');
  expect(md('')).toBe('');
  expect(md(null)).toBe('');
  expect(md('a\r\nb\r\n\r\nc')).toBe('<p>a<br>\nb</p>\n<p>c</p>');
});

test('headings # to ######', () => {
  for (let n = 1; n <= 6; n++) expect(md(`${'#'.repeat(n)} Title *x*`)).toBe(`<h${n}>Title <em>x</em></h${n}>`);
  expect(md('####### seven')).toBe('<p>####### seven</p>');
  expect(md('#hashtag')).toBe('<p>#hashtag</p>');
  expect(md('text\n## Heading\nmore')).toBe('<p>text</p>\n<h2>Heading</h2>\n<p>more</p>');
});

test('bold, italic, strike and inline code, nested correctly', () => {
  expect(md('**bold** *italic* ~~strike~~ `code`')).toBe('<p><strong>bold</strong> <em>italic</em> <del>strike</del> <code>code</code></p>');
  expect(md('***both***')).toBe('<p><em><strong>both</strong></em></p>');
  expect(md('**bold with *italic* inside**')).toBe('<p><strong>bold with <em>italic</em> inside</strong></p>');
  expect(md('*italic with **bold** inside*')).toBe('<p><em>italic with <strong>bold</strong> inside</em></p>');
  expect(md('**`code` in bold**')).toBe('<p><strong><code>code</code> in bold</strong></p>');
  expect(md('~~**gone**~~')).toBe('<p><del><strong>gone</strong></del></p>');
});

test('delimiters that do not pair up stay as typed', () => {
  expect(md('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  expect(md('**open only')).toBe('<p>**open only</p>');
  expect(md('a ~ b ~~ c')).toBe('<p>a ~ b ~~ c</p>');
  expect(md('\\*not italic\\* and \\[not a link\\](http://x)')).toContain('<p>*not italic* and [not a link](');
});

test('underscores are never emphasis', () => {
  for (const text of ['snake_case_name', '__init__', '_private_', 'a_b and c_d', '__dunder__ and _x_'])
    expect(md(text)).toBe(`<p>${text}</p>`);
});

test('inline code is not interpreted', () => {
  expect(md('`**not bold** [x](http://y) <b>`')).toBe('<p><code>**not bold** [x](http://y) &lt;b&gt;</code></p>');
  expect(md('``a ` b``')).toBe('<p><code>a ` b</code></p>');
  expect(md('*a `*` b*')).toBe('<p><em>a <code>*</code> b</em></p>');
  expect(md('`unclosed')).toBe('<p>`unclosed</p>');
});

test('fenced code blocks are not interpreted', () => {
  expect(md('```js\nconst a = "**x**";\n<script>alert(1)</script>\n# not a heading\n```\nafter'))
    .toBe('<pre><code>const a = &quot;**x**&quot;;\n&lt;script&gt;alert(1)&lt;/script&gt;\n# not a heading</code></pre>\n<p>after</p>');
  expect(md('~~~\n- not a list\n```\n~~~')).toBe('<pre><code>- not a list\n```</code></pre>');
  expect(md('````\n```\ninner\n```\n````')).toBe('<pre><code>```\ninner\n```</code></pre>');
  expect(md('text\n```\ncode\n```')).toBe('<p>text</p>\n<pre><code>code</code></pre>');
});

test('an unclosed fence runs to the end', () => {
  expect(md('```\nline 1\n\n**line 3**\n')).toBe('<pre><code>line 1\n\n**line 3**</code></pre>');
});

test('links: only http, https and mailto, always in a new tab', () => {
  expect(md('[text](http://x.test/a?b=1&c=2)')).toBe(`<p>${link('http://x.test/a?b=1&amp;c=2', 'text')}</p>`);
  expect(md('[secure](HTTPS://x.test)')).toBe(`<p>${link('HTTPS://x.test', 'secure')}</p>`);
  expect(md('[mail](mailto:a@b.test)')).toBe(`<p>${link('mailto:a@b.test', 'mail')}</p>`);
  expect(md('[`code` and **bold**](http://x.test)')).toBe(`<p>${link('http://x.test', '<code>code</code> and <strong>bold</strong>')}</p>`);
  expect(md('[wiki](https://x.test/Foo_(bar))')).toBe(`<p>${link('https://x.test/Foo_(bar)', 'wiki')}</p>`);
  expect(md('[a [b] c](http://x.test)')).toBe(`<p>${link('http://x.test', 'a [b] c')}</p>`);
  expect(md('[todo] and [ref](http://x.test)')).toBe(`<p>[todo] and ${link('http://x.test', 'ref')}</p>`);
  expect(md('**[label](http://x)**')).toBe(`<p><strong>${link('http://x', 'label')}</strong></p>`);
});

test('a link to any other scheme, or to a relative path, stays plain text', () => {
  for (const text of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,<script>alert(1)</script>)', '[x](file:///etc/passwd)',
    '[x](vbscript:msgbox(1))', '[x](//evil.test)', '[x](/relative/path)', '[x](src/app.js)', '[x]( javascript:alert(1))', '[x](java\tscript:alert(1))', '![x](javascript:alert(1))']) {
    const html = markdown(text);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<script');
    expect(html).toContain('[x](');                    // the source is still there to read
  }
  expect(md('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  expect(md('<javascript:alert(1)>')).toBe('<p>&lt;javascript:alert(1)&gt;</p>');
});

test('bare URLs become links without their trailing punctuation', () => {
  expect(md('see http://x.test/a.')).toBe(`<p>see ${link('http://x.test/a', 'http://x.test/a')}.</p>`);
  expect(md('(https://x.test/a), then')).toBe(`<p>(${link('https://x.test/a', 'https://x.test/a')}), then</p>`);
  expect(md('https://x.test/Foo_(bar) ok')).toBe(`<p>${link('https://x.test/Foo_(bar)', 'https://x.test/Foo_(bar)')} ok</p>`);
  expect(md('is it https://x.test/a?b=1&c=2?!')).toBe(`<p>is it ${link('https://x.test/a?b=1&amp;c=2', 'https://x.test/a?b=1&amp;c=2')}?!</p>`);
  expect(md('**https://x.test/snake_case_path**')).toBe(`<p><strong>${link('https://x.test/snake_case_path', 'https://x.test/snake_case_path')}</strong></p>`);
  expect(md('<https://x.test/a>')).toBe(`<p>${link('https://x.test/a', 'https://x.test/a')}</p>`);
  expect(md('xhttp://x.test and http:// and ftp://x.test')).toBe('<p>xhttp://x.test and http:// and ftp://x.test</p>');
  expect(md('[http://a.test](http://b.test)')).toBe(`<p>${link('http://b.test', 'http://a.test')}</p>`);
});

test('an image is a link with its alt text, never an <img>', () => {
  expect(md('![a diagram](https://x.test/d.png)')).toBe(`<p>${link('https://x.test/d.png', 'a diagram')}</p>`);
  expect(md('![](https://x.test/d.png)')).toBe(`<p>${link('https://x.test/d.png', 'https://x.test/d.png')}</p>`);
  expect(md('[![badge](https://x.test/b.svg)](https://x.test/ci)')).toBe(`<p>${link('https://x.test/ci', 'badge')}</p>`);
  expect(markdown('![x](https://x.test/d.png) ![y](data:image/png;base64,AAAA)')).not.toContain('<img');
});

test('unordered and ordered lists', () => {
  expect(md('- a\n- b\n- c')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>');
  expect(md('* a\n* b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  expect(md('+ a\n+ b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  expect(md('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  expect(md('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  expect(md('Steps:\n- **a**\n- [b](http://x)')).toBe(`<p>Steps:</p>\n<ul>\n<li><strong>a</strong></li>\n<li>${link('http://x', 'b')}</li>\n</ul>`);
  expect(md('- a\n1. b')).toBe('<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  expect(md('- a\n\nafter')).toBe('<ul>\n<li>a</li>\n</ul>\n<p>after</p>');
});

test('lists nest by indentation', () => {
  expect(md('- a\n  - b\n    - c\n- d')).toBe('<ul>\n<li>a\n<ul>\n<li>b\n<ul>\n<li>c</li>\n</ul></li>\n</ul></li>\n<li>d</li>\n</ul>');
  expect(md('1. a\n   - b\n2. c')).toBe('<ol>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ol>');
  expect(md('1. a\n  - two spaces\n2. c')).toBe('<ol>\n<li>a\n<ul>\n<li>two spaces</li>\n</ul></li>\n<li>c</li>\n</ol>');
  expect(md('- a\n  continued')).toBe('<ul>\n<li>a<br>\ncontinued</li>\n</ul>');
  expect(md('- a\n  ```\n  code\n  ```\n- b')).toBe('<ul>\n<li>a\n<pre><code>code</code></pre></li>\n<li>b</li>\n</ul>');
  expect(md('- a\n\n  second\n\n- b')).toBe('<ul>\n<li><p>a</p>\n<p>second</p></li>\n<li><p>b</p></li>\n</ul>');
});

test('task items show a box character', () => {
  expect(md('- [ ] todo\n- [x] done\n- [X] also done\n- plain'))
    .toBe('<ul>\n<li class="task"><span class="box">☐</span> todo</li>\n<li class="task"><span class="box">☑</span> done</li>\n<li class="task"><span class="box">☑</span> also done</li>\n<li>plain</li>\n</ul>');
  expect(md('- [link](http://x)')).toBe(`<ul>\n<li>${link('http://x', 'link')}</li>\n</ul>`);
});

test('tables: alignment as classes, inline syntax in cells, ragged rows', () => {
  expect(md('| L | C | R | N |\n|:--|:-:|--:|---|\n| **a** | `b` | 1 | [d](http://x) |\n| only |'))
    .toBe(`<div class="table"><table>\n<thead>\n<tr><th class="left">L</th><th class="center">C</th><th class="right">R</th><th>N</th></tr>\n</thead>\n<tbody>\n`
      + `<tr><td class="left"><strong>a</strong></td><td class="center"><code>b</code></td><td class="right">1</td><td>${link('http://x', 'd')}</td></tr>\n`
      + '<tr><td class="left">only</td><td class="center"></td><td class="right"></td><td></td></tr>\n</tbody>\n</table></div>');
  expect(md('a | b\n--- | ---\n1 | 2')).toContain('<tr><td>1</td><td>2</td></tr>');
  expect(md('| a \\| b | c |\n|---|---|')).toContain('<tr><th>a | b</th><th>c</th></tr>');
  expect(md('intro\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter')).toMatch(/^<p>intro<\/p>\n<div class="table">[^]*<\/div>\n<p>after<\/p>$/);
  expect(markdown('| a | b |\n|---|---|')).not.toContain('style=');
});

test('pipes without a separator row are just text', () => {
  expect(md('a | b\nc | d')).toBe('<p>a | b<br>\nc | d</p>');
  expect(md('| a | b |\n|---|')).toBe('<p>| a | b |<br>\n|---|</p>');
});

test('blockquotes and horizontal rules', () => {
  expect(md('> quoted **text**\n> second line\n\nafter')).toBe('<blockquote>\n<p>quoted <strong>text</strong><br>\nsecond line</p>\n</blockquote>\n<p>after</p>');
  expect(md('> a\n> > nested')).toBe('<blockquote>\n<p>a</p>\n<blockquote>\n<p>nested</p>\n</blockquote>\n</blockquote>');
  expect(md('> - item')).toBe('<blockquote>\n<ul>\n<li>item</li>\n</ul>\n</blockquote>');
  for (const rule of ['---', '***', '___', '- - -', '----------']) expect(md(`a\n\n${rule}\n\nb`)).toBe('<p>a</p>\n<hr>\n<p>b</p>');
});

// ---------- security ----------

// Every tag in the output must be one of these, written exactly this way.
const ALLOWED = /^<(?:\/?(?:p|h[1-6]|strong|em|del|code|pre|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|a|span|div)|br|hr|ol start="\d+"|li class="task"|span class="box"|div class="table"|t[hd] class="(?:left|center|right)"|a href="(?:https?:\/\/|mailto:)[^"<>\s]*" target="_blank" rel="noopener noreferrer")>$/i;
function violations(html) {
  const found = (html.match(/<[^>]*>/g) || []).filter(tag => !ALLOWED.test(tag));
  if (/[<>]/.test(html.replace(/<[^>]*>/g, ''))) found.push('stray < or >');
  return found;
}

test('the tag check itself rejects what it should', () => {
  for (const html of ['<img src=x>', '<p onclick="x">', '<a href="javascript:x" target="_blank" rel="noopener noreferrer">', '<a href="http://x" onclick="y">', '<td style="x">', '<script>', 'a < b', '<p>a</p> >'])
    expect(violations(html)).not.toEqual([]);
  expect(violations(markdown(sample))).toEqual([]);
});

test('raw HTML is shown as text', () => {
  expect(md('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  expect(md('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  expect(md('a <b onclick="x()">b</b> & <!-- c --> &lt;')).toBe('<p>a &lt;b onclick=&quot;x()&quot;&gt;b&lt;/b&gt; &amp; &lt;!-- c --&gt; &amp;lt;</p>');
  for (const text of ['# <script>alert(1)</script>', '- <img src=x onerror=alert(1)>', '> <svg onload=alert(1)>', '| <iframe src=x> |\n|---|\n| <style>*{}</style> |',
    '**<script>alert(1)</script>**', '[<img src=x onerror=alert(1)>](http://x)', '```<script>\n</code></pre><script>alert(1)</script>\n```', '`</code><script>alert(1)</script>`']) {
    const html = markdown(text);
    expect(violations(html)).toEqual([]);
    expect(html).not.toMatch(/<(script|img|svg|iframe|style)/i);
  }
});

test('a URL cannot break out of the href attribute', () => {
  for (const url of ['http://x/"onmouseover="alert(1)', "http://x/'onmouseover='alert(1)", 'http://x/"><script>alert(1)</script>', 'http://x/&quot;onmouseover=alert(1)', 'http://x/\u0000"x', 'http://x/"style="color:red']) {
    for (const text of [`[label](${url})`, `![alt](${url})`, url, `<${url}>`, `**[label](${url})**`, `| [label](${url}) |\n|---|`]) {
      const html = markdown(text);
      expect(violations(html)).toEqual([]);
      expect(html).not.toMatch(/\son\w+=|\sstyle=/i);            // no attribute was injected
    }
  }
  expect(md('[x](http://x/"onmouseover="alert(1))')).toBe(`<p>${link('http://x/&quot;onmouseover=&quot;alert(1)', 'x')}</p>`);
  expect(md("http://x/'a'b")).toBe(`<p>${link('http://x/&#39;a&#39;b', 'http://x/&#39;a&#39;b')}</p>`);
});

test('the output never holds a style attribute, an event handler, an image or a script', () => {
  const html = markdown(`${sample}\n\n# h\n- [x] a\n1. b\n> q\n\n![i](http://x/i.png) <img src=x> <b style="x" onclick="y">\n\n| a |\n|:-:|\n| b |\n\n\`\`\`\n<style>\n\`\`\``);
  expect(violations(html)).toEqual([]);
  expect(html).not.toMatch(/<(img|script|style|iframe|object|embed|link|meta|form|input|svg)\b/i);
  expect(html).not.toMatch(/<[^>]*\s(style|on\w+|src|srcset|id)=/i);
});

test('NUL characters cannot forge an inline code placeholder', () => {
  expect(md('a \u00000\u0000 b `c`')).toBe('<p>a \uFFFD0\uFFFD b <code>c</code></p>');
});

// A small deterministic generator, so a failure can be reproduced from its seed.
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const PIECES = ['*', '**', '***', '~~', '`', '``', '```', '[', ']', '(', ')', '](', '![', '<', '>', '"', "'", '&', '\\', '|', '\n', '\n\n', ' ', '  ', '- ', '1. ', '> ', '# ', '---', '|---|',
  'http://x.test/', 'https://', 'javascript:alert(1)', 'data:text/html,', 'mailto:', '<script>', '</script>', '<img src=x onerror=alert(1)>', '" onclick="alert(1)', 'a', 'word', '_', '[x]', '[ ]', '\t', '\u0000', '=', ':'];

test('random input only ever produces the tags this renderer writes', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const next = rng(seed);
    let text = '';
    for (let n = 5 + Math.floor(next() * 60); n > 0; n--) text += PIECES[Math.floor(next() * PIECES.length)];
    const bad = violations(markdown(text));
    if (bad.length) throw new Error(`seed ${seed}: ${JSON.stringify(text)} produced ${JSON.stringify(bad)}`);
  }
});

// ---------- pathological input ----------

function timed(text) {
  const start = performance.now();
  const html = markdown(text);
  return { html, ms: performance.now() - start };
}
const SIZE = 200_000, fill = unit => unit.repeat(Math.ceil(SIZE / unit.length));

test('10,000 stars return at once', () => {
  expect(timed('*'.repeat(10_000)).html).toBe('<hr>\n');
  const { html, ms } = timed(`a${'*'.repeat(10_000)}b`);
  expect(html).toBe(`<p>a${'*'.repeat(10_000)}b</p>\n`);
  expect(ms).toBeLessThan(200);
});

test('deeply nested lists and quotes stop nesting instead of overflowing the stack', () => {
  const lists = timed(Array.from({ length: 600 }, (_, k) => `${' '.repeat(k * 2)}- item ${k}`).join('\n'));
  expect(lists.ms).toBeLessThan(500);
  expect(lists.html.match(/<ul>/g).length).toBeLessThan(20);
  expect(lists.html).toContain('item 599');
  const quotes = timed(`${'>'.repeat(10_000)} deep`);
  expect(quotes.ms).toBeLessThan(500);
  expect(quotes.html.match(/<blockquote>/g).length).toBeLessThan(20);
  const emphasis = timed(`${'*a **b '.repeat(5_000)}${' b** a*'.repeat(5_000)}`);
  expect(emphasis.ms).toBeLessThan(500);
});

test('a 200 KB reply renders in well under a second', () => {
  const reply = `${sample}\n\n## Details\n\n- item with \`code\` and a [link](https://x.test/a)\n  - nested *item*\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n> quote\n\n`;
  const { html, ms } = timed(fill(reply));
  expect(html.length).toBeGreaterThan(SIZE);
  expect(ms).toBeLessThan(500);
  expect(timed(fill('one long line of ordinary prose with no line breaks at all ')).ms).toBeLessThan(500);
});

test('no input shape makes the scan quadratic', () => {
  const units = ['*', '*a', '**a', '*a ', '*a **', '***a', '~~a', '`', '``a`', '[', '[a', '[a](', '[a](x', '[a](x(y)', '[a]((', '![a](', '<', '<http://x', 'http://', 'http://x)', '\\', '|', '|-', '> ', '- ', '# ', ' ', '\t', '\n', ' \n', '- a\n', '|a|b|\n', '|-|-|\n', '```\n', '(', '[[a](http://x)', '**`a`', 'x]('];
  const shaped = [
    ' '.repeat(SIZE) + 'x', `# ${' '.repeat(SIZE)}x #`, `-- ${' '.repeat(SIZE)}x`, `|a|${' '.repeat(SIZE)}|\n|-|${' '.repeat(SIZE)}x`, `[a](${' '.repeat(SIZE)}x y`,
    `*a${' *a'.repeat(SIZE / 3)}*`, `${'['.repeat(SIZE)}]`, '['.repeat(SIZE / 2) + ']'.repeat(SIZE / 2), Array.from({ length: 630 }, (_, k) => '`'.repeat(k + 1)).join(' a '),
    `http://x${'('.repeat(SIZE)}`, `http://x${'.'.repeat(SIZE)}`, `- a\n${'\n'.repeat(SIZE)}  b`, `|${'a|'.repeat(SIZE / 4)}\n|${'-|'.repeat(SIZE / 4)}\n`,
  ];
  for (const text of [...units.map(fill), ...shaped]) {
    const { ms } = timed(text);
    if (ms > 500) throw new Error(`${ms.toFixed(0)} ms for ${JSON.stringify(text.slice(0, 40))}…`);
  }
});
