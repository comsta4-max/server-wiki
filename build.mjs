// docs/*.md 를 dist/*.html 로 변환합니다.
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import MarkdownIt from 'markdown-it';

const SITE_TITLE = '서버 위키';
const DOCS = 'docs';
const DIST = 'dist';

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 문서의 원시 HTML은 허용하지 않습니다.
const md = new MarkdownIt({ html: false, linkify: true });

// 제목에 앵커 id를 붙입니다. 예: rules.html#채팅-규칙
md.core.ruler.push('heading_ids', (state) => {
  const seen = new Map();
  state.tokens.forEach((token, i) => {
    if (token.type !== 'heading_open') return;
    const base = state.tokens[i + 1].content.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    token.attrSet('id', count ? `${base}-${count}` : base);
  });
});

// 문서 간 링크 [규칙](rules.md) 를 rules.html 로 바꿉니다.
const renderLink = md.renderer.rules.link_open ?? ((t, i, o, e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href');
  if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    tokens[idx].attrSet('href', href.replace(/\.md(?=$|#)/, '.html'));
  }
  return renderLink(tokens, idx, options, env, self);
};

const files = (await readdir(DOCS)).filter((f) => f.endsWith('.md'));
if (!files.includes('index.md')) throw new Error('docs/index.md 가 필요합니다.');

const pages = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(join(DOCS, file), 'utf8');
    const slug = basename(file, '.md');
    const title = source.match(/^#\s+(.+?)\s*$/m)?.[1] ?? slug;
    return { slug, title, body: md.render(source) };
  }),
);

// 홈을 맨 앞에 두고 나머지는 제목순으로 정렬합니다.
pages.sort((a, b) => (b.slug === 'index') - (a.slug === 'index') || a.title.localeCompare(b.title, 'ko'));

const renderPage = (page) => {
  const nav = pages
    .map((p) => {
      const current = p.slug === page.slug ? ' aria-current="page"' : '';
      return `<li><a href="${encodeURI(p.slug)}.html"${current}>${escapeHtml(p.title)}</a></li>`;
    })
    .join('');
  const pageTitle = page.slug === 'index' ? SITE_TITLE : `${page.title} - ${SITE_TITLE}`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<nav>
<a class="site" href="index.html">${escapeHtml(SITE_TITLE)}</a>
<input id="q" type="search" placeholder="문서 찾기" aria-label="문서 제목 검색" hidden>
<ul id="pages">${nav}</ul>
</nav>
<main>${page.body}</main>
<script>
const q = document.getElementById('q');
q.hidden = false;
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase();
  for (const li of document.querySelectorAll('#pages li')) {
    li.hidden = !li.textContent.toLowerCase().includes(term);
  }
});
</script>
</body>
</html>
`;
};

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);
await copyFile('style.css', join(DIST, 'style.css'));
await Promise.all(pages.map((p) => writeFile(join(DIST, `${p.slug}.html`), renderPage(p))));
console.log(`${pages.length}개 문서를 ${DIST}/ 에 생성했습니다.`);
