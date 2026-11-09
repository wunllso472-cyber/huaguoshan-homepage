import { CATEGORIES, catColor, esc, safeHref, fmtDate, api, isVideo, isImage } from './common.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  items: [],
  profile: {},
  editingId: null,
  media: { cover: '', images: [], videos: [] },
  dirty: false,
  uploading: 0,
};

/* ---------------------------------------------------------------- 通用 */

let toastT = 0;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

function confirmBox({ title, text, ok = '确认' }) {
  const d = $('#confirm');
  $('#cf-title').textContent = title;
  $('#cf-text').textContent = text || '';
  $('#cf-ok').textContent = ok;
  d.showModal();
  $('#cf-cancel').focus();
  return new Promise((resolve) => {
    const done = (v) => {
      d.close();
      $('#cf-ok').onclick = $('#cf-cancel').onclick = null;
      d.oncancel = null;
      resolve(v);
    };
    $('#cf-ok').onclick = () => done(true);
    $('#cf-cancel').onclick = () => done(false);
    d.oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
  });
}

async function call(path, opts) {
  try {
    return await api(path, opts);
  } catch (e) {
    if (e.status === 401 && path !== '/api/login') {
      showLogin('登录已失效，请重新登录。');
    }
    throw e;
  }
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/* ---------------------------------------------------------------- 登录 */

function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = msg;
  if ($('#editor').open) $('#editor').close();
  $('#login-form [name=password]').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = e.target.password.value;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: pwd } });
    e.target.reset();
    await showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin('已退出登录。');
});

async function showApp() {
  const data = await call('/api/site');
  state.items = data.achievements || [];
  state.profile = data.profile || {};
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderCatFilter();
  renderRows();
  fillProfile();
}

/* ---------------------------------------------------------------- 标签页 */

$$('[data-tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('[data-tab]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      $(`#tab-${t.dataset.tab}`).hidden = !on;
    });
  })
);

/* ---------------------------------------------------------------- 成果列表 */

function renderCatFilter() {
  const cats = [...new Set([...CATEGORIES.map((c) => c.name), ...state.items.map((a) => a.category).filter(Boolean)])];
  const cur = $('#cat-filter').value;
  $('#cat-filter').innerHTML = `<option value="">全部类别</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}`;
  $('#cat-filter').value = cats.includes(cur) ? cur : '';
  $('#cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
}

function renderRows() {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#cat-filter').value;
  const list = state.items.filter((a) => {
    if (cat && a.category !== cat) return false;
    if (!q) return true;
    return [a.title, a.org, a.award, a.summary, ...(a.tags || [])].join(' ').toLowerCase().includes(q);
  });
  $('#count').textContent = state.items.length;
  if (!state.items.length) {
    $('#rows').innerHTML = '<li class="empty">还没有成果。点右上角「新增成果」添加第一条。</li>';
    return;
  }
  if (!list.length) {
    $('#rows').innerHTML = '<li class="empty">没有符合条件的成果，换个关键词或类别试试。</li>';
    return;
  }
  $('#rows').innerHTML = list
    .map((a) => {
      const cover = safeHref(a.cover);
      return `
      <li class="row" style="--c:${catColor(a.category)}">
        ${cover ? `<img class="row-thumb" src="${esc(cover)}" alt="" loading="lazy">` : `<span class="row-thumb ph">${esc((a.title || '·').slice(0, 1))}</span>`}
        <div class="row-main">
          <strong>${esc(a.title)}</strong>
          <span>${[a.award, a.org].filter(Boolean).map(esc).join('　')}</span>
        </div>
        <span class="row-date">${esc(fmtDate(a.date))}</span>
        <span class="row-cat">${esc(a.category)}</span>
        <span class="row-flags">${a.featured ? '<i class="flag star">代表作</i>' : ''}${a.visible === false ? '<i class="flag off">未公开</i>' : ''}</span>
        <div class="row-actions">
          <a class="btn ghost small" href="/#a/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">预览</a>
          <button type="button" class="btn ghost small" data-edit="${esc(a.id)}">编辑</button>
          <button type="button" class="btn danger-ghost small" data-del="${esc(a.id)}">删除</button>
        </div>
      </li>`;
    })
    .join('');
}

$('#search').addEventListener('input', renderRows);
$('#cat-filter').addEventListener('change', renderRows);
$('#new-btn').addEventListener('click', () => openEditor(null));

$('#rows').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) return openEditor(state.items.find((a) => a.id === ed.dataset.edit));
  const del = e.target.closest('[data-del]');
  if (del) {
    const a = state.items.find((x) => x.id === del.dataset.del);
    if (!a) return;
    const ok = await confirmBox({
      title: `删除「${a.title}」？`,
      text: '删除后主页上不再显示。数据会保留在服务器自动备份里，图片等文件可在「设置」里清理。',
      ok: '删除',
    });
    if (!ok) return;
    try {
      await call(`/api/achievements/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      state.items = state.items.filter((x) => x.id !== a.id);
      renderRows();
      toast(`已删除「${a.title}」`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

/* ---------------------------------------------------------------- 链接行（编辑器与个人资料共用） */

function linkRow(label = '', url = '') {
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `
    <input class="l-label" placeholder="名称，如：路演页" maxlength="60" value="${esc(label)}" aria-label="链接名称">
    <input class="l-url" placeholder="https://… 或 /uploads/…" value="${esc(url)}" aria-label="链接地址">
    <button type="button" class="icon-btn small" data-remove aria-label="移除这条链接">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`;
  row.querySelector('[data-remove]').addEventListener('click', () => {
    row.remove();
    state.dirty = true;
  });
  return row;
}

function readLinks(containerId) {
  return $$(`#${containerId} .link-row`)
    .map((r) => ({ label: r.querySelector('.l-label').value.trim(), url: r.querySelector('.l-url').value.trim() }))
    .filter((l) => l.url);
}

function badLinks(containerId) {
  return readLinks(containerId).filter((l) => !safeHref(l.url));
}

$$('[data-add-link]').forEach((b) =>
  b.addEventListener('click', () => {
    const box = $(`#${b.dataset.addLink}`);
    const row = linkRow();
    box.append(row);
    row.querySelector('input').focus();
  })
);

/* ---------------------------------------------------------------- 编辑器 */

const editor = $('#editor');
const form = $('#ed-form');

function openEditor(a) {
  state.editingId = a?.id || null;
  form.reset();
  $('#ed-error').textContent = '';
  $('#ed-title').textContent = a ? '编辑成果' : '新增成果';
  $('#ed-save').textContent = a ? '保存修改' : '保存';
  $('#queue').innerHTML = '';

  form.title.value = a?.title || '';
  form.date.value = a?.date || new Date().toISOString().slice(0, 10);
  form.category.value = a?.category || '';
  form.award.value = a?.award || '';
  form.org.value = a?.org || '';
  form.summary.value = a?.summary || '';
  form.content.value = a?.content || '';
  form.tags.value = (a?.tags || []).join('，');
  form.featured.checked = Boolean(a?.featured);
  form.visible.checked = a ? a.visible !== false : true;

  state.media = {
    cover: a?.cover || '',
    images: structuredClone(a?.images || []),
    videos: structuredClone(a?.videos || []),
  };
  const links = $('#ed-links');
  links.innerHTML = '';
  (a?.links || []).forEach((l) => links.append(linkRow(l.label, l.url)));

  renderMedia();
  state.dirty = false;
  editor.showModal();
  editor.querySelector('.ed-body').scrollTop = 0;
  form.title.focus();
}

async function closeEditor() {
  if (state.uploading) {
    const ok = await confirmBox({ title: '还有文件在上传', text: '现在关闭会丢掉正在上传的文件。', ok: '仍然关闭' });
    if (!ok) return;
  } else if (state.dirty) {
    const ok = await confirmBox({ title: '放弃未保存的修改？', text: '关闭后，这次的改动不会保存。', ok: '放弃修改' });
    if (!ok) return;
  }
  editor.close();
}

form.addEventListener('input', () => (state.dirty = true));
$$('[data-ed-close]').forEach((b) => b.addEventListener('click', closeEditor));
editor.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});

function renderMedia() {
  const { images, videos } = state.media;
  if (state.media.cover && !images.some((im) => im.url === state.media.cover)) {
    // 封面图已被移除
    state.media.cover = images[0]?.url || '';
  }
  if (!state.media.cover && images[0]) state.media.cover = images[0].url;

  $('#img-count').textContent = images.length ? images.length : '';
  $('#img-empty').hidden = images.length > 0;
  $('#img-grid').innerHTML = images
    .map(
      (im, i) => `
    <li class="img-card${im.url === state.media.cover ? ' is-cover' : ''}">
      <div class="img-wrap">
        <img src="${esc(safeHref(im.url))}" alt="" loading="lazy">
        ${im.url === state.media.cover ? '<span class="cover-badge">封面</span>' : ''}
      </div>
      <input class="cap" data-i="${i}" placeholder="图片说明（可选）" maxlength="120" value="${esc(im.caption || '')}" aria-label="第 ${i + 1} 张图片说明">
      <div class="img-tools">
        <button type="button" data-act="cover" data-i="${i}" title="设为封面" aria-label="设为封面"${im.url === state.media.cover ? ' disabled' : ''}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="currentColor"/></svg>
        </button>
        <button type="button" data-act="left" data-i="${i}" title="前移" aria-label="前移"${i === 0 ? ' disabled' : ''}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" data-act="right" data-i="${i}" title="后移" aria-label="后移"${i === images.length - 1 ? ' disabled' : ''}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" data-act="remove" data-i="${i}" title="移除" aria-label="移除这张图片" class="rm">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    </li>`
    )
    .join('');

  $('#vid-count').textContent = videos.length ? videos.length : '';
  const posterOpts = (sel) =>
    `<option value="">不设置预览图</option>${images
      .map((im, i) => `<option value="${esc(im.url)}"${im.url === sel ? ' selected' : ''}>用第 ${i + 1} 张图片${im.caption ? '：' + esc(im.caption.slice(0, 12)) : ''}</option>`)
      .join('')}`;
  $('#vid-list').innerHTML = videos.length
    ? videos
        .map(
          (v, i) => `
    <li class="vid-row">
      <video src="${esc(safeHref(v.url))}#t=0.5" preload="metadata" muted playsinline></video>
      <div class="vid-fields">
        <input class="vcap" data-i="${i}" placeholder="视频说明，如：产品介绍" maxlength="120" value="${esc(v.caption || '')}" aria-label="第 ${i + 1} 个视频说明">
        <select class="vposter" data-i="${i}" aria-label="视频预览图">${posterOpts(v.poster)}</select>
      </div>
      <button type="button" class="icon-btn small" data-vremove="${i}" aria-label="移除这个视频">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </li>`
        )
        .join('')
    : '<li class="hint">还没有视频。</li>';
}

$('#img-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const i = Number(b.dataset.i);
  const imgs = state.media.images;
  if (b.dataset.act === 'cover') state.media.cover = imgs[i].url;
  if (b.dataset.act === 'left' && i > 0) [imgs[i - 1], imgs[i]] = [imgs[i], imgs[i - 1]];
  if (b.dataset.act === 'right' && i < imgs.length - 1) [imgs[i + 1], imgs[i]] = [imgs[i], imgs[i + 1]];
  if (b.dataset.act === 'remove') {
    const [gone] = imgs.splice(i, 1);
    state.media.videos.forEach((v) => {
      if (v.poster === gone.url) v.poster = '';
    });
  }
  state.dirty = true;
  renderMedia();
});

$('#img-grid').addEventListener('input', (e) => {
  if (e.target.matches('.cap')) state.media.images[Number(e.target.dataset.i)].caption = e.target.value;
});

$('#vid-list').addEventListener('input', (e) => {
  const i = Number(e.target.dataset.i);
  if (e.target.matches('.vcap')) state.media.videos[i].caption = e.target.value;
  if (e.target.matches('.vposter')) state.media.videos[i].poster = e.target.value;
  state.dirty = true;
});

$('#vid-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vremove]');
  if (!b) return;
  state.media.videos.splice(Number(b.dataset.vremove), 1);
  state.dirty = true;
  renderMedia();
});

/* ---------------------------------------------------------------- 上传 */

const MAX_SIDE = 2000;

async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1048576) {
    bmp.close?.();
    return file;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

function upload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) showLogin('登录已失效，请重新登录。');
        reject(new Error(data.error || `上传失败（${xhr.status}）`));
      }
    };
    xhr.onerror = () => reject(new Error('网络中断，上传失败'));
    xhr.send(file);
  });
}

async function handleFiles(files) {
  for (const original of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="q-name">${esc(original.name)}</span><span class="q-bar"><i></i></span><span class="q-state">准备中</span>`;
    $('#queue').append(li);
    const bar = li.querySelector('i');
    const st = li.querySelector('.q-state');
    state.uploading++;
    try {
      const file = await prepareImage(original);
      st.textContent = fmtSize(file.size);
      const res = await upload(file, (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        st.textContent = `${Math.round(p * 100)}%`;
      });
      if (isImage(res.url)) state.media.images.push({ url: res.url, caption: '' });
      else if (isVideo(res.url)) state.media.videos.push({ url: res.url, caption: '', poster: '' });
      else $('#ed-links').append(linkRow(original.name.replace(/\.[^.]+$/, ''), res.url));
      state.dirty = true;
      renderMedia();
      li.remove();
    } catch (err) {
      li.classList.add('failed');
      st.textContent = err.message;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'q-dismiss';
      x.textContent = '知道了';
      x.onclick = () => li.remove();
      li.append(x);
    } finally {
      state.uploading--;
    }
  }
}

$('#file-input').addEventListener('change', (e) => {
  handleFiles([...e.target.files]);
  e.target.value = '';
});

const drop = $('#drop');
['dragenter', 'dragover'].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]);
});

/* ---------------------------------------------------------------- 保存 */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#ed-error');
  err.textContent = '';
  const title = form.title.value.trim();
  const date = form.date.value.trim();
  if (!title) {
    err.textContent = '请填写标题。';
    form.title.focus();
    return;
  }
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) {
    err.textContent = '日期格式应为 2026-11-05、2026-11 或 2026。';
    form.date.focus();
    return;
  }
  if (state.uploading) {
    err.textContent = '还有文件在上传，等上传完成再保存。';
    return;
  }
  const bad = badLinks('ed-links');
  if (bad.length) {
    err.textContent = `链接「${bad[0].label || bad[0].url}」的地址需要以 http://、https:// 或 /uploads/ 开头。`;
    return;
  }

  const payload = {
    title,
    date,
    category: form.category.value.trim() || '其他',
    award: form.award.value.trim(),
    org: form.org.value.trim(),
    summary: form.summary.value.trim(),
    content: form.content.value,
    tags: form.tags.value,
    cover: state.media.cover,
    images: state.media.images,
    videos: state.media.videos,
    links: readLinks('ed-links'),
    featured: form.featured.checked,
    visible: form.visible.checked,
  };

  const btn = $('#ed-save');
  btn.disabled = true;
  try {
    let saved;
    if (state.editingId) {
      saved = await call(`/api/achievements/${encodeURIComponent(state.editingId)}`, { method: 'PUT', body: payload });
      state.items = state.items.map((a) => (a.id === saved.id ? saved : a));
    } else {
      saved = await call('/api/achievements', { method: 'POST', body: payload });
      state.items.push(saved);
    }
    state.items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    state.dirty = false;
    editor.close();
    renderCatFilter();
    renderRows();
    toast(state.editingId ? `已保存「${saved.title}」` : `已新增「${saved.title}」`);
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- 个人资料 */

const pf = $('#profile-form');

function yrRow(it = { title: '', text: '' }) {
  const li = document.createElement('li');
  li.className = 'yr-row';
  li.innerHTML = `
    <input class="yr-t" placeholder="小标题" maxlength="40" value="${esc(it.title)}" aria-label="小标题">
    <textarea class="yr-x" rows="3" placeholder="内容" maxlength="800" aria-label="内容">${esc(it.text)}</textarea>
    <div class="yr-tools">
      <button type="button" class="icon-btn small" data-yr="up" aria-label="上移">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" class="icon-btn small" data-yr="del" aria-label="删除这一条">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>`;
  return li;
}

function fillProfile() {
  const p = state.profile;
  pf.name.value = p.name || '';
  pf.location.value = p.location || '';
  pf.roles.value = (p.roles || []).join('，');
  pf.heroWords.value = (p.heroWords || []).join('，');
  pf.intro.value = p.intro || '';
  pf.footer.value = p.footer || '';
  pf.yrTitle.value = p.yearReview?.title || '';
  pf.yrIntro.value = p.yearReview?.intro || '';
  const links = $('#profile-links');
  links.innerHTML = '';
  (p.links || []).forEach((l) => links.append(linkRow(l.label, l.url)));
  const yr = $('#yr-items');
  yr.innerHTML = '';
  (p.yearReview?.items || []).forEach((it) => yr.append(yrRow(it)));
}

$('#yr-add').addEventListener('click', () => {
  const row = yrRow();
  $('#yr-items').append(row);
  row.querySelector('input').focus();
});

$('#yr-items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-yr]');
  if (!b) return;
  const li = b.closest('li');
  if (b.dataset.yr === 'del') li.remove();
  if (b.dataset.yr === 'up' && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
});

pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#profile-error');
  err.textContent = '';
  const bad = badLinks('profile-links');
  if (bad.length) {
    err.textContent = `链接「${bad[0].label || bad[0].url}」的地址需要以 http:// 或 https:// 开头。`;
    return;
  }
  const words = pf.heroWords.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  const long = words.find((w) => w.length > 8);
  if (long) {
    err.textContent = `首屏变换的词「${long}」超过 8 个字，请缩短。`;
    return;
  }
  const body = {
    name: pf.name.value,
    location: pf.location.value,
    roles: pf.roles.value,
    heroWords: words,
    intro: pf.intro.value,
    footer: pf.footer.value,
    avatar: state.profile.avatar || '',
    links: readLinks('profile-links'),
    yearReview: {
      title: pf.yrTitle.value,
      intro: pf.yrIntro.value,
      items: $$('#yr-items .yr-row').map((r) => ({ title: r.querySelector('.yr-t').value, text: r.querySelector('.yr-x').value })),
    },
  };
  const btn = pf.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    state.profile = await call('/api/profile', { method: 'PUT', body });
    fillProfile();
    toast('个人资料已保存');
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- 设置 */

$('#pwd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#pwd-error');
  err.textContent = '';
  if (f.newPassword.value !== f.confirm.value) {
    err.textContent = '两次输入的新密码不一致。';
    return;
  }
  try {
    await call('/api/password', { method: 'POST', body: { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value } });
    f.reset();
    toast('密码已修改');
  } catch (e2) {
    err.textContent = e2.message;
  }
});

let unused = [];
$('#scan-btn').addEventListener('click', async () => {
  const btn = $('#scan-btn');
  btn.disabled = true;
  try {
    const { files } = await call('/api/files/unused');
    unused = files;
    const total = files.reduce((s, f) => s + f.size, 0);
    $('#file-list').innerHTML = files.length
      ? files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a><span>${fmtSize(f.size)}</span></li>`).join('')
      : '<li class="hint">没有未使用的文件。</li>';
    const clean = $('#clean-btn');
    clean.hidden = !files.length;
    clean.textContent = `删除这 ${files.length} 个文件（${fmtSize(total)}）`;
  } catch (e2) {
    toast(e2.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#clean-btn').addEventListener('click', async () => {
  const ok = await confirmBox({ title: `删除 ${unused.length} 个未使用的文件？`, text: '文件删除后无法恢复。', ok: '删除文件' });
  if (!ok) return;
  try {
    const r = await call('/api/files/unused', { method: 'DELETE' });
    $('#file-list').innerHTML = '';
    $('#clean-btn').hidden = true;
    toast(`已删除 ${r.removed} 个文件，释放 ${fmtSize(r.bytes)}`);
  } catch (e2) {
    toast(e2.message, 'error');
  }
});

/* ---------------------------------------------------------------- 启动 */

window.addEventListener('beforeunload', (e) => {
  if ((editor.open && state.dirty) || state.uploading) e.preventDefault();
});

(async () => {
  try {
    const { authed } = await api('/api/session');
    if (authed) await showApp();
    else showLogin();
  } catch (e) {
    showLogin(`连接服务器失败：${e.message}`);
  }
})();
