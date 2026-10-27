const startBounds = L.latLngBounds(
    L.latLng(44.0, 22.0),
    L.latLng(52.5, 40.5)
);

const bounds = L.latLngBounds(
    L.latLng(41.8, 12.4),
    L.latLng(55.0, 50.0)
);

const smallScreen = window.matchMedia('(max-width: 700px)');
const HIT_PAD = window.matchMedia('(pointer: coarse)').matches ? 16 : 8;

const map = L.map('map', {
    maxBounds: bounds,
    maxBoundsViscosity: 1.0,
    minZoom: smallScreen.matches ? 4 : 5.5,
    maxZoom: 12,
    zoomSnap: 0.5
});

function applyLayout() {
    map.setMinZoom(smallScreen.matches ? 4 : 5.5);
    map.invalidateSize();
    if (smallScreen.matches) {
        map.fitBounds(startBounds);
    } else {
        map.setView([48.3794, 31.1656], 5.5);
    }
}

applyLayout();
smallScreen.addEventListener('change', applyLayout);

map.createPane('pins');
map.getPane('pins').style.zIndex = 620;

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
}).addTo(map);

const MARKER_STYLES = {
  military: { color: '#CC0000', label: 'Military / Combat', short: 'Military' },
  diplomatic: { color: '#4A90D9', label: 'Diplomatic / Political', short: 'Diplomatic' },
  humanitarian: { color: '#E8A838', label: 'Humanitarian', short: 'Humanitarian' }
};

const PAGE_SIZE = 20;

const pinLayer = L.layerGroup().addTo(map);
let allArticles = [];
let activeFilter = 'all';
let currentCity = null;

const sidebarState = {
  mode: 'city',
  city: null,
  articles: [],
  exhausted: false,
  loading: false,
  token: 0
};

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Date unknown';
  const then = new Date(dateStr);
  if (isNaN(then)) return 'Date unknown';
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (diff < 60) return unit(diff, 'second');
  if (diff < 3600) return unit(Math.floor(diff / 60), 'minute');
  if (diff < 86400) return unit(Math.floor(diff / 3600), 'hour');
  return unit(Math.floor(diff / 86400), 'day');
}

function dateValue(article) {
  const t = new Date(article.date || 0).getTime();
  return isNaN(t) ? 0 : t;
}

function visibleArticles() {
  if (activeFilter === 'all') return allArticles;
  return allArticles.filter(a => a.type === activeFilter);
}

function groupByCity(list) {
  const groups = {};
  list.forEach(article => {
    if (!groups[article.city]) groups[article.city] = [];
    groups[article.city].push(article);
  });
  return groups;
}

function sortNewestFirst(a, b) {
  const diff = dateValue(b) - dateValue(a);
  if (diff !== 0) return diff;
  return (b.id || 0) - (a.id || 0);
}

function reportHref(article) {
  const query = new URLSearchParams({ title: article.title || '', link: article.link || '' });
  return escapeHTML('contact.html?' + query.toString());
}

function articleHTML(article) {
  const style = MARKER_STYLES[article.type] || MARKER_STYLES.military;
  const meta = [`<span style="color:${style.color}">${style.short}</span>`];
  if (article.source) meta.push(escapeHTML(article.source));
  meta.push(timeAgo(article.date));
  return `
    <div class="article-card">
      <div class="article-title">${escapeHTML(article.title)}</div>
      <div class="article-desc">${escapeHTML(article.description)}</div>
      <div class="article-footer">
        <span class="article-time">${meta.join(' · ')}</span>
        <span class="article-links">
          <a href="${reportHref(article)}" target="_blank" rel="noopener" class="article-link">Report</a>
          <a href="${escapeHTML(article.link)}" target="_blank" rel="noopener" class="article-link">Source</a>
        </span>
      </div>
    </div>
  `;
}

const tabMap = document.getElementById('tab-map');
const tabNews = document.getElementById('tab-news');

function setTab(name) {
  if (tabMap) tabMap.classList.toggle('active', name === 'map');
  if (tabNews) tabNews.classList.toggle('active', name === 'news');
}

function paintSidebar() {
  const n = sidebarState.articles.length;
  const filterLabel = activeFilter === 'all' ? '' : ` · ${MARKER_STYLES[activeFilter].label}`;
  const noun = n === 1 ? 'report' : 'reports';
  const shown = sidebarState.exhausted ? '' : ' shown';

  document.getElementById('sidebar-updated').textContent =
    `${n} ${noun}${shown}${filterLabel}`;

  let footer;
  if (sidebarState.exhausted) {
    footer = '<div class="sidebar-end">No older reports</div>';
  } else {
    const label = sidebarState.loading ? 'Loading...' : 'Load older reports';
    footer = `<button id="load-older" class="load-older">${label}</button>`;
  }

  document.getElementById('sidebar-content').innerHTML =
    sidebarState.articles.map(articleHTML).join('') + footer;
}

function closeSidebar() {
  setTab('map');
  currentCity = null;
  sidebarState.mode = 'city';
  sidebarState.city = null;
  sidebarState.token++;
  document.getElementById('sidebar').classList.remove('open');
}

function openSidebar(city, articles) {
  setTab('map');
  sidebarState.mode = 'city';
  sidebarState.city = city;
  sidebarState.articles = [...articles].sort(sortNewestFirst);
  sidebarState.exhausted = false;
  sidebarState.loading = false;
  sidebarState.token++;

  document.getElementById('sidebar-title').textContent = city.toUpperCase();
  paintSidebar();
  document.getElementById('sidebar-content').scrollTop = 0;
  document.getElementById('sidebar').classList.add('open');
}

async function loadOlder() {
  if (sidebarState.loading || sidebarState.exhausted) return;
  if (!sidebarState.city) return;

  const token = sidebarState.token;
  const last = sidebarState.articles[sidebarState.articles.length - 1];
  const beforeDate = last ? last.date : new Date().toISOString();

  const scope = `city=${encodeURIComponent(sidebarState.city)}`;
  let url = `/api/news?${scope}&before=${encodeURIComponent(beforeDate)}&limit=${PAGE_SIZE}`;
  if (last && last.id) url += `&beforeId=${encodeURIComponent(last.id)}`;
  if (activeFilter !== 'all') url += `&type=${encodeURIComponent(activeFilter)}`;

  sidebarState.loading = true;
  paintSidebar();

  try {
    const res = await fetch(url);
    const older = await res.json();
    if (token !== sidebarState.token) return;
    sidebarState.articles = sidebarState.articles.concat(older);
    if (older.length < PAGE_SIZE) sidebarState.exhausted = true;
  } catch (err) {
    console.error('Failed to load older reports:', err);
  } finally {
    if (token === sidebarState.token) {
      sidebarState.loading = false;
      paintSidebar();
    }
  }
}

function render() {
  pinLayer.clearLayers();
  const groups = groupByCity(visibleArticles());

  Object.entries(groups).forEach(([city, list]) => {
    const radius = Math.min(5 + Math.sqrt(list.length) * 2.5, 18);
    const lat = list[0].lat;
    const lng = list[0].lng;

    L.circleMarker([lat, lng], {
      pane: 'pins',
      radius: radius,
      fillColor: '#ffffff',
      color: '#000000',
      weight: 1.5,
      fillOpacity: 0.95,
      interactive: false
    }).addTo(pinLayer);

    L.circleMarker([lat, lng], {
      pane: 'pins',
      radius: radius + HIT_PAD,
      fillColor: 'transparent',
      color: 'transparent',
      weight: 0,
      fillOpacity: 0,
      interactive: true,
      bubblingMouseEvents: false
    }).addTo(pinLayer).on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      currentCity = city;
      openSidebar(city, list);

      if (smallScreen.matches) {
        const point = map.latLngToContainerPoint([lat, lng]);
        if (point.y > window.innerHeight * 0.4) {
          map.panBy([0, point.y - window.innerHeight * 0.2]);
        }
      }
    });
  });

  if (currentCity) {
    if (groups[currentCity]) {
      openSidebar(currentCity, groups[currentCity]);
    } else {
      closeSidebar();
    }
  }
}

document.getElementById('sidebar-close').addEventListener('click', closeSidebar);

document.getElementById('sidebar-content').addEventListener('click', (e) => {
  if (e.target && e.target.id === 'load-older') loadOlder();
});

const legend = document.getElementById('legend');
L.DomEvent.disableClickPropagation(legend);

const newsPage = document.getElementById('news-page');
const newsBody = document.getElementById('news-body');
const newsRange = document.getElementById('news-range');
const newsSearch = document.getElementById('news-search');
const newsState = { articles: [], filter: 'all', loaded: false };

function startOfLocalDay(daysBack) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayHeading(ms) {
  if (dayKey(ms) === dayKey(startOfLocalDay(0))) return 'Today';
  if (dayKey(ms) === dayKey(startOfLocalDay(1))) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function paintNews() {
  const days = parseInt(newsRange.value, 10);
  const cutoff = startOfLocalDay(days - 1);
  const query = newsSearch.value.trim().toLowerCase();

  const list = newsState.articles
    .filter(a => dateValue(a) >= cutoff)
    .filter(a => newsState.filter === 'all' || a.type === newsState.filter)
    .filter(a => !query || (a.title + ' ' + (a.description || '')).toLowerCase().includes(query))
    .sort(sortNewestFirst);

  if (!newsState.loaded) {
    newsBody.innerHTML = '<div class="news-empty">Loading...</div>';
    return;
  }
  if (!list.length) {
    newsBody.innerHTML = '<div class="news-empty">No stories in this range.</div>';
    return;
  }

  const groups = [];
  list.forEach(article => {
    const key = dayKey(dateValue(article));
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, ms: dateValue(article), items: [] };
      groups.push(group);
    }
    group.items.push(article);
  });

  newsBody.innerHTML = groups.map(g =>
    `<div class="news-day">${escapeHTML(dayHeading(g.ms))}</div>` +
    `<div class="news-list">${g.items.map(articleHTML).join('')}</div>`
  ).join('');
}

async function openNews() {
  closeSidebar();
  setTab('news');
  document.body.classList.add('news-open');
  newsPage.hidden = false;
  newsPage.scrollTop = 0;
  newsState.loaded = false;
  paintNews();
  try {
    const res = await fetch('/api/news?unlocated=1&days=7&limit=1000');
    newsState.articles = await res.json();
  } catch (err) {
    console.error('Failed to load news:', err);
    newsState.articles = [];
  }
  newsState.loaded = true;
  paintNews();
}

function closeNews() {
  newsPage.hidden = true;
  document.body.classList.remove('news-open');
  setTab('map');
}

if (tabNews) tabNews.addEventListener('click', openNews);
if (tabMap) tabMap.addEventListener('click', closeSidebar);
document.getElementById('news-tab-map').addEventListener('click', closeNews);
newsRange.addEventListener('change', paintNews);
newsSearch.addEventListener('input', paintNews);
document.querySelectorAll('.nfilter').forEach(el => {
  el.addEventListener('click', () => {
    newsState.filter = el.dataset.newsFilter;
    document.querySelectorAll('.nfilter').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    paintNews();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !newsPage.hidden) closeNews();
});

document.querySelectorAll('.filter').forEach(el => {
  el.addEventListener('click', () => {
    activeFilter = el.dataset.filter;
    document.querySelectorAll('.filter').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    render();
  });
});

fetch('borders.json')
  .then(res => res.json())
  .then(data => {
    L.geoJSON(data, {
      filter: (feature) => {
        const name = feature.properties.ADMIN || feature.properties.name;
        return ['Ukraine', 'Russia'].includes(name);
      },
      style: (feature) => {
        const name = feature.properties.ADMIN || feature.properties.name;
        if (name === 'Ukraine') {
          return { color: '#0057B7', weight: 2, fillOpacity: 0, fillColor: 'transparent' };
        }
        return { color: '#FF4444', weight: 2, fillOpacity: 0, fillColor: 'transparent' };
      },
      interactive: false
    }).addTo(map);
  })
  .catch(err => console.error('Failed to load borders:', err));

const FRONTLINE_STYLE = {
  color: '#CC0000',
  weight: 1,
  fillOpacity: 0.5,
  fillColor: '#CC0000'
};

const frontlinePane = map.createPane('frontline');
frontlinePane.style.zIndex = 410;
frontlinePane.style.pointerEvents = 'none';

const FRAME_MS = 70;
const MAX_FRAMES_PER_MOVE = 30;
const PREFETCH_AHEAD = 4;
const CACHE_LIMITS = { lite: 150, full: 10 };

let frontlineLayer = null;
const frontlineCache = { lite: new Map(), full: new Map() };
const frontlineInflight = new Map();
let frontlineDates = [];
let playhead = -1;
let target = -1;
let moveStride = 1;
let running = false;
let settleTimer = null;
let settleToken = 0;
let shownQuality = null;
let animate = true;
let jumpTimer = null;
let dateTimer = null;
let runId = 0;

try {
  animate = localStorage.getItem('frontlineAnimate') !== 'off';
} catch (err) {}

const tlSlider = document.getElementById('tl-slider');
const tlDate = document.getElementById('tl-date');
const tlAnim = document.getElementById('tl-anim');
const tlRow = document.getElementById('timeline-row');

function setFrontlineLabel(text) {
  document.getElementById('frontline-date').textContent = text;
}

function getSnapshot(date, quality) {
  const cache = frontlineCache[quality];
  if (cache.has(date)) return Promise.resolve(cache.get(date));
  const key = date + '|' + quality;
  if (frontlineInflight.has(key)) return frontlineInflight.get(key);
  const url = `/api/frontline?date=${encodeURIComponent(date)}` + (quality === 'lite' ? '&quality=lite' : '');
  const request = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('Frontline unavailable');
      return res.json();
    })
    .then(data => {
      cache.set(date, data);
      if (cache.size > CACHE_LIMITS[quality]) cache.delete(cache.keys().next().value);
      return data;
    })
    .finally(() => frontlineInflight.delete(key));
  frontlineInflight.set(key, request);
  return request;
}

function swapFrontline(data, quality) {
  const next = L.geoJSON(data, {
    pane: 'frontline',
    style: FRONTLINE_STYLE,
    interactive: false
  }).addTo(map);
  if (frontlineLayer) map.removeLayer(frontlineLayer);
  frontlineLayer = next;
  shownQuality = quality;
}

function showDate(i) {
  const date = frontlineDates[i];
  if (tlDate) tlDate.value = date;
  setFrontlineLabel(`as of ${date}`);
}

function prefetchAhead(from, stride) {
  for (let k = 1; k <= PREFETCH_AHEAD; k++) {
    const idx = from + k * stride;
    if (idx < 0 || idx >= frontlineDates.length) break;
    getSnapshot(frontlineDates[idx], 'lite').catch(() => {});
  }
}

function settle() {
  const i = playhead;
  if (i < 0 || shownQuality === 'full') return;
  const token = ++settleToken;
  getSnapshot(frontlineDates[i], 'full')
    .then(data => {
      if (running || token !== settleToken || playhead !== i) return;
      swapFrontline(data, 'full');
    })
    .catch(() => {});
}

function step(id) {
  if (id !== runId) return;
  if (!animate) {
    running = false;
    return;
  }
  if (playhead === target) {
    running = false;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 300);
    return;
  }
  const dist = target - playhead;
  const dir = Math.sign(dist);
  const stride = moveStride;
  let next = playhead + dir * stride;
  if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
  prefetchAhead(next, dir * stride);
  getSnapshot(frontlineDates[next], 'lite')
    .then(data => {
      if (id !== runId) return;
      if (!animate) {
        running = false;
        return;
      }
      swapFrontline(data, 'lite');
      playhead = next;
      setTimeout(() => step(id), FRAME_MS);
    })
    .catch(err => {
      if (id !== runId) return;
      running = false;
      console.error('Failed to load frontline:', err);
      setFrontlineLabel('snapshot unavailable');
    });
}

function jumpTo(i) {
  runId++;
  running = false;
  target = i;
  playhead = i;
  clearTimeout(settleTimer);
  settleToken++;
  showDate(i);
  clearTimeout(jumpTimer);
  const date = frontlineDates[i];
  jumpTimer = setTimeout(() => {
    getSnapshot(date, 'full')
      .then(data => {
        if (playhead !== i) return;
        swapFrontline(data, 'full');
      })
      .catch(() => setFrontlineLabel('snapshot unavailable'));
  }, frontlineCache.full.has(date) ? 0 : 120);
}

function setTarget(index) {
  if (!frontlineDates.length) return;
  target = Math.max(0, Math.min(frontlineDates.length - 1, index));
  if (!animate) {
    jumpTo(target);
    return;
  }
  moveStride = Math.max(1, Math.ceil(Math.abs(target - playhead) / MAX_FRAMES_PER_MOVE));
  showDate(target);
  clearTimeout(settleTimer);
  settleToken++;
  if (!running) {
    running = true;
    step(runId);
  }
}

function loadLatestFrontline() {
  fetch('/api/frontline')
    .then(res => {
      if (!res.ok) throw new Error('Frontline unavailable');
      return res.json();
    })
    .then(data => swapFrontline(data, 'full'))
    .catch(err => {
      console.error('Failed to load frontline:', err);
      setFrontlineLabel('date unavailable');
    });
}

let lastInputAt = 0;

if (tlSlider) {
  tlSlider.addEventListener('input', () => {
    const now = Date.now();
    const index = parseInt(tlSlider.value, 10);
    const startsGesture = now - lastInputAt > 250;
    lastInputAt = now;
    const from = target < 0 ? playhead : target;
    if (startsGesture && Math.abs(index - from) > 2) {
      jumpTo(index);
      return;
    }
    setTarget(index);
  });
}

if (tlAnim) {
  tlAnim.checked = animate;
  tlAnim.addEventListener('change', () => {
    animate = tlAnim.checked;
    try {
      localStorage.setItem('frontlineAnimate', animate ? 'on' : 'off');
    } catch (err) {}
    if (!animate && frontlineDates.length) jumpTo(target < 0 ? playhead : target);
  });
}

if (tlDate) {
  tlDate.addEventListener('change', () => {
    clearTimeout(dateTimer);
    dateTimer = setTimeout(() => {
      if (!frontlineDates.length) return;
      const wanted = Date.parse(tlDate.value);
      const first = Date.parse(frontlineDates[0]);
      const last = Date.parse(frontlineDates[frontlineDates.length - 1]);
      if (isNaN(wanted) || wanted < first || wanted > last) {
        showDate(playhead);
        return;
      }
      let best = 0;
      let bestGap = Infinity;
      frontlineDates.forEach((d, i) => {
        const gap = Math.abs(Date.parse(d) - wanted);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      if (tlSlider) tlSlider.value = best;
      jumpTo(best);
    }, 400);
  });
}

fetch('/api/frontline-dates')
  .then(res => res.json())
  .then(dates => {
    frontlineDates = Array.isArray(dates) ? dates : [];
    if (!frontlineDates.length) {
      setFrontlineLabel('date unavailable');
      loadLatestFrontline();
      return;
    }
    const last = frontlineDates.length - 1;
    if (tlDate) {
      tlDate.min = frontlineDates[0];
      tlDate.max = frontlineDates[last];
    }
    if (tlSlider) {
      tlSlider.max = last;
      tlSlider.value = last;
    }
    if (tlRow) tlRow.hidden = false;
    playhead = last;
    target = last;
    showDate(last);
    getSnapshot(frontlineDates[last], 'full')
      .then(data => swapFrontline(data, 'full'))
      .catch(err => {
        console.error('Failed to load frontline:', err);
        setFrontlineLabel('snapshot unavailable');
      });
  })
  .catch(() => {
    setFrontlineLabel('date unavailable');
    loadLatestFrontline();
  });

fetch('/api/news')
  .then(res => res.json())
  .then(articles => {
    allArticles = articles;
    render();
  })
  .catch(err => console.error('Failed to load news:', err));