// 主页与后台共用的小工具

export const CATEGORIES = [
  { name: '竞赛获奖', color: '#F5C451' },
  { name: '黑客松', color: '#FF7E8E' },
  { name: '创作', color: '#FF9D5C' },
  { name: '项目', color: '#5BE0C0' },
  { name: '荣誉认证', color: '#B3A5FF' },
  { name: '活动分享', color: '#6FC3FF' },
];

const FALLBACK = '#A3A7CC';

export function catColor(name) {
  return CATEGORIES.find((c) => c.name === name)?.color || FALLBACK;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 只放行站内上传和 http(s) 链接
export function safeHref(u) {
  const s = String(u || '').trim();
  if (s.startsWith('/uploads/') || /^https?:\/\//i.test(s)) return s;
  return '';
}

export function fmtDate(d, { withYear = true } = {}) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (!m) return withYear ? `${y} 年` : '';
  if (!withYear) return day ? `${Number(m)}.${Number(day)}` : `${Number(m)} 月`;
  return day ? `${y}.${Number(m)}.${Number(day)}` : `${y}.${Number(m)}`;
}

export function yearOf(d) {
  return (d || '').slice(0, 4) || '未注明';
}

// 正文：空行分段，「- 」开头的行是列表
export function renderContent(text) {
  if (!text) return '';
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-•·]\s*/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-•·]\s*/, ''))}</li>`).join('')}</ul>`;
      }
      const out = [];
      let list = [];
      const flush = () => {
        if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
        list = [];
      };
      let para = [];
      const flushP = () => {
        if (para.length) out.push(`<p>${para.map(esc).join('<br>')}</p>`);
        para = [];
      };
      for (const l of lines) {
        if (/^-\s+/.test(l)) {
          flushP();
          list.push(l.replace(/^-\s+/, ''));
        } else {
          flush();
          para.push(l);
        }
      }
      flushP();
      flush();
      return out.join('');
    })
    .join('');
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function isVideo(url) {
  return /\.(mp4|m4v|webm|mov)$/i.test(url || '');
}

export function isImage(url) {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(url || '');
}
