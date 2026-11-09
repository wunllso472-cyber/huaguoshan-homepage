import { CATEGORIES, catColor, esc, safeHref, fmtDate, yearOf, renderContent, api, isVideo } from './common.js';
import { createHero, waitFonts } from './hero.js';

const $ = (s, el = document) => el.querySelector(s);
const state = { profile: {}, items: [], filter: '全部' };

/* ---------------------------------------------------------------- 启动 */

async function boot() {
  const dataP = api('/api/site').catch((e) => ({ error: e.message }));
  const data = await dataP;
  if (data.error) {
    $('#timeline').innerHTML = `<p class="empty">成果数据没有加载出来：${esc(data.error)}。刷新页面再试一次。</p>`;
  }
  state.profile = data.profile || {};
  state.items = (data.achievements || []).filter((a) => a.visible !== false);

  renderProfile();
  renderTally();
  renderFeatured();
  renderFilters();
  renderTimeline();
  renderReview();
  openFromHash();

  const p = state.profile;
  const words = p.heroWords?.length ? p.heroWords : [p.name || '花果山'];
  await waitFonts(words);
  createHero($('#hero-canvas'), words, { onWord: (i) => lightRole(i) });
}

/* ---------------------------------------------------------------- 个人信息 */

function renderProfile() {
  const p = state.profile;
  const name = p.name || '花果山';
  document.querySelectorAll('[data-name]').forEach((el) => (el.textContent = name));
  document.title = `${name} · 个人主页`;

  const roles = p.roles?.length ? p.roles : [];
  $('#roles').innerHTML = roles.map((r, i) => `<li class="${i === 0 ? 'on' : ''}">${esc(r)}</li>`).join('');

  $('#intro').innerHTML = (p.intro || '')
    .split('\n')
    .filter((s) => s.trim())
    .map((s) => `<p>${esc(s)}</p>`)
    .join('');

  const links = (p.links || [])
    .map((l) => ({ ...l, href: safeHref(l.url) }))
    .filter((l) => l.href)
    .map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label || l.href)}<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a></li>`)
    .join('');
  $('#links').innerHTML = links;
  $('#footer-links').innerHTML = links;
  $('#footer-line').textContent = p.footer || '';
  $('#copyright').textContent = `© ${new Date().getFullYear()} ${name}${p.location ? ' · ' + p.location : ''}`;
}

function lightRole(i) {
  const lis = document.querySelectorAll('#roles li');
  if (!lis.length) return;
  lis.forEach((li, k) => li.classList.toggle('on', k === i % lis.length));
}

/* ---------------------------------------------------------------- 计数 / 图例 */

function renderTally() {
  const items = state.items;
  if (!items.length) {
    $('#tally-lead').textContent = '';
    $('#tally').innerHTML = '';
    return;
  }
  const years = items.map((a) => yearOf(a.date)).filter((y) => /^\d{4}$/.test(y)).sort();
  const span = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]} – ${years.at(-1)}`) : '';
  $('#tally-lead').innerHTML = `${esc(span)}<span>共 ${items.length} 项记录</span>`;
  $('#tally').innerHTML = countByCat(items)
    .map(([name, n]) => `<li><button type="button" data-filter="${esc(name)}" style="--c:${catColor(name)}"><i></i>${esc(name)}<b>${n}</b></button></li>`)
    .join('');
}

function countByCat(items) {
  const m = new Map();
  for (const a of items) m.set(a.category || '其他', (m.get(a.category || '其他') || 0) + 1);
  const order = CATEGORIES.map((c) => c.name);
  return [...m.entries()].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/* ---------------------------------------------------------------- 代表作 */

function coverHtml(a, cls = '') {
  const src = safeHref(a.cover);
  if (src) return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
  return `<span class="${cls} placeholder" aria-hidden="true">${esc((a.title || '·').slice(0, 1))}</span>`;
}

function renderFeatured() {
  const list = state.items.filter((a) => a.featured).slice(0, 6);
  const sec = $('#featured');
  sec.hidden = !list.length;
  $('#featured-list').innerHTML = list
    .map((a) => {
      const hasVideo = (a.videos || []).some((v) => isVideo(v.url));
      return `
      <article class="feat" style="--c:${catColor(a.category)}">
        <button type="button" class="feat-media" data-open="${esc(a.id)}" aria-label="查看「${esc(a.title)}」详情">
          ${coverHtml(a)}
          ${hasVideo ? '<span class="has-video"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>有视频</span>' : ''}
        </button>
        <div class="feat-body">
          <p class="meta"><span class="cat">${esc(a.category)}</span><time datetime="${esc(a.date)}">${esc(fmtDate(a.date))}</time></p>
          <h3 class="feat-title">${esc(a.title)}</h3>
          ${a.award || a.org ? `<p class="feat-award">${a.award ? `<strong>${esc(a.award)}</strong>` : ''}${a.org ? `<span>${esc(a.org)}</span>` : ''}</p>` : ''}
          ${a.summary ? `<p class="feat-summary">${esc(a.summary)}</p>` : ''}
          ${tagsHtml(a.tags)}
          <button type="button" class="btn" data-open="${esc(a.id)}">查看详情</button>
        </div>
      </article>`;
    })
    .join('');
}

function tagsHtml(tags) {
  if (!tags?.length) return '';
  return `<ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

/* ---------------------------------------------------------------- 年表 */

function renderFilters() {
  const counts = countByCat(state.items);
  const chips = [['全部', state.items.length], ...counts];
  $('#filters').innerHTML = chips
    .map(([name, n]) => `<button type="button" class="chip" data-filter="${esc(name)}" aria-pressed="${state.filter === name}" style="--c:${name === '全部' ? 'var(--text)' : catColor(name)}">${esc(name)}<b>${n}</b></button>`)
    .join('');
}

function renderTimeline() {
  const items = state.items.filter((a) => state.filter === '全部' || a.category === state.filter);
  if (!items.length) {
    if (!$('#timeline .empty')) $('#timeline').innerHTML = '<p class="empty">这里还没有成果。到后台「新增成果」添加第一条吧。</p>';
    return;
  }
  const groups = new Map();
  for (const a of items) {
    const y = yearOf(a.date);
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(a);
  }
  $('#timeline').innerHTML = [...groups.entries()]
    .map(
      ([year, list]) => `
    <section class="year" aria-label="${esc(year)} 年">
      <h3 class="year-label">${esc(year)}<span>${list.length} 项</span></h3>
      <ol class="year-items">
        ${list
          .map(
            (a) => `
          <li class="item" style="--c:${catColor(a.category)}">
            <button type="button" class="item-btn" data-open="${esc(a.id)}">
              <span class="item-date">${esc(fmtDate(a.date, { withYear: false }))}</span>
              <span class="item-main">
                <span class="item-title">${esc(a.title)}</span>
                <span class="item-sub">${a.award ? `<b>${esc(a.award)}</b>` : ''}${a.org ? `<span>${esc(a.org)}</span>` : ''}</span>
              </span>
              <span class="item-cat">${esc(a.category)}</span>
              ${coverHtml(a, 'item-thumb')}
            </button>
          </li>`
          )
          .join('')}
      </ol>
    </section>`
    )
    .join('');
}

function setFilter(name) {
  state.filter = name;
  renderFilters();
  renderTimeline();
}

/* ---------------------------------------------------------------- 年度总结 */

function renderReview() {
  const r = state.profile.yearReview;
  const sec = $('#review');
  const has = r && (r.items || []).length;
  sec.hidden = !has;
  document.querySelector('[data-review-nav]')?.closest('li')?.toggleAttribute('hidden', !has);
  if (!has) return;
  $('#review-title').textContent = r.title || '年度总结';
  $('#review-intro').textContent = r.intro || '';
  $('#review-list').innerHTML = r.items
    .map((it) => `<li><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></li>`)
    .join('');
}

/* ---------------------------------------------------------------- 详情弹窗 */

const detail = $('#detail');
let current = null;

function openDetail(id, { updateHash = true } = {}) {
  const a = state.items.find((x) => x.id === id);
  if (!a) return;
  current = a;
  const videos = (a.videos || []).filter((v) => safeHref(v.url));
  const images = (a.images || []).filter((im) => safeHref(im.url));
  const links = (a.links || []).filter((l) => safeHref(l.url));

  $('#detail-body').innerHTML = `
    <header class="d-head" style="--c:${catColor(a.category)}">
      <p class="meta"><span class="cat">${esc(a.category)}</span><time datetime="${esc(a.date)}">${esc(fmtDate(a.date))}</time></p>
      <h2 id="detail-title">${esc(a.title)}</h2>
      ${a.award || a.org ? `<p class="d-award">${a.award ? `<strong>${esc(a.award)}</strong>` : ''}${a.org ? `<span>${esc(a.org)}</span>` : ''}</p>` : ''}
      ${a.summary ? `<p class="d-summary">${esc(a.summary)}</p>` : ''}
      ${links.length ? `<p class="d-links">${links.map((l) => `<a class="btn" href="${esc(safeHref(l.url))}" target="_blank" rel="noopener">${esc(l.label || '打开链接')}</a>`).join('')}</p>` : ''}
    </header>
    ${videos
      .map(
        (v) => `<figure class="d-video">
          <video controls playsinline preload="metadata"${safeHref(v.poster) ? ` poster="${esc(safeHref(v.poster))}"` : ''}>
            <source src="${esc(safeHref(v.url))}">
            你的浏览器不支持视频播放，<a href="${esc(safeHref(v.url))}">点此下载</a>。
          </video>
          ${v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ''}
        </figure>`
      )
      .join('')}
    ${a.content ? `<div class="d-content">${renderContent(a.content)}</div>` : ''}
    ${images.length
      ? `<div class="d-gallery">${images
          .map((im, i) => `<button type="button" class="g-item" data-lb="${i}" aria-label="查看大图${im.caption ? '：' + esc(im.caption) : ''}"><img src="${esc(safeHref(im.url))}" alt="${esc(im.caption || '')}" loading="lazy" decoding="async"></button>`)
          .join('')}</div>`
      : ''}
    ${tagsHtml(a.tags)}
  `;
  detail.querySelector('.detail-inner').scrollTop = 0;
  if (!detail.open) detail.showModal();
  if (updateHash) history.replaceState(null, '', `#a/${encodeURIComponent(a.id)}`);
}

function closeDetail() {
  detail.querySelectorAll('video').forEach((v) => v.pause());
  if (detail.open) detail.close();
}

detail.addEventListener('close', () => {
  detail.querySelectorAll('video').forEach((v) => v.pause());
  current = null;
  if (location.hash.startsWith('#a/')) history.replaceState(null, '', location.pathname + location.search);
});

detail.addEventListener('click', (e) => {
  if (e.target === detail || e.target.closest('[data-close]')) closeDetail();
  const g = e.target.closest('[data-lb]');
  if (g) openLightbox(Number(g.dataset.lb));
});

function openFromHash() {
  const m = /^#a\/(.+)$/.exec(location.hash);
  if (m) openDetail(decodeURIComponent(m[1]), { updateHash: false });
}
window.addEventListener('hashchange', openFromHash);

/* ---------------------------------------------------------------- 看大图 */

const lb = $('#lightbox');
let lbIndex = 0;

function lbImages() {
  return (current?.images || []).filter((im) => safeHref(im.url));
}

function showLb() {
  const list = lbImages();
  if (!list.length) return;
  lbIndex = (lbIndex + list.length) % list.length;
  const im = list[lbIndex];
  $('#lb-img').src = safeHref(im.url);
  $('#lb-img').alt = im.caption || '';
  $('#lb-cap').textContent = im.caption || '';
  $('#lb-count').textContent = list.length > 1 ? `${lbIndex + 1} / ${list.length}` : '';
  $('#lb-prev').hidden = $('#lb-next').hidden = list.length < 2;
}

function openLightbox(i) {
  lbIndex = i;
  showLb();
  lb.showModal();
}

$('#lb-prev').addEventListener('click', () => { lbIndex--; showLb(); });
$('#lb-next').addEventListener('click', () => { lbIndex++; showLb(); });
$('#lb-close').addEventListener('click', () => lb.close());
lb.addEventListener('click', (e) => {
  if (e.target === lb || e.target.tagName === 'FIGURE') lb.close();
});
lb.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { lbIndex--; showLb(); }
  if (e.key === 'ArrowRight') { lbIndex++; showLb(); }
});
let touchX = null;
lb.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) { lbIndex += dx < 0 ? 1 : -1; showLb(); }
  touchX = null;
});

/* ---------------------------------------------------------------- 全局点击 */

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) {
    openDetail(open.dataset.open);
    return;
  }
  const f = e.target.closest('[data-filter]');
  if (f) {
    setFilter(f.dataset.filter);
    if (f.closest('#tally')) $('#works').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
});

boot();
