const bounds = L.latLngBounds(
    L.latLng(44.0, 22.0),
    L.latLng(52.5, 40.5)
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
        map.fitBounds(bounds);
    } else {
        map.setView([48.3794, 31.1656], 5.5);
    }
}

applyLayout();
smallScreen.addEventListener('change', applyLayout);

map.createPane('pins');
map.getPane('pins').style.zIndex = 620;

L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    attribution: '© Stadia Maps © OpenStreetMap contributors',
}).addTo(map);

const MARKER_STYLES = {
  military: { color: '#CC0000', label: 'Military / Combat' },
  diplomatic: { color: '#4A90D9', label: 'Diplomatic / Political' },
  humanitarian: { color: '#E8A838', label: 'Humanitarian' }
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
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
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

function articleHTML(article) {
  const style = MARKER_STYLES[article.type] || MARKER_STYLES.military;
  return `
    <div class="article-card">
      <div class="article-type" style="color:${style.color}">${style.label}</div>
      <div class="article-title">${escapeHTML(article.title)}</div>
      <div class="article-desc">${escapeHTML(article.description)}</div>
      <div class="article-footer">
        <span class="article-time">${timeAgo(article.date)}${article.source ? ' · ' + escapeHTML(article.source) : ''}</span>
        <a href="${escapeHTML(article.link)}" target="_blank" rel="noopener" class="article-link">Source →</a>
      </div>
    </div>
  `;
}

function paintSidebar() {
  const n = sidebarState.articles.length;
  const filterLabel = activeFilter === 'all' ? '' : ` · ${MARKER_STYLES[activeFilter].label}`;
  const scopeLabel = sidebarState.mode === 'unlocated' ? ' · no place named' : '';
  const noun = n === 1 ? 'report' : 'reports';
  const shown = sidebarState.exhausted ? '' : ' shown';

  document.getElementById('sidebar-updated').textContent =
    `${n} ${noun}${shown}${filterLabel}${scopeLabel}`;

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
  currentCity = null;
  sidebarState.mode = 'city';
  sidebarState.city = null;
  sidebarState.token++;
  document.getElementById('sidebar').classList.remove('open');
}

function openSidebar(city, articles) {
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

async function openUnlocated() {
  currentCity = null;
  sidebarState.mode = 'unlocated';
  sidebarState.city = null;
  sidebarState.articles = [];
  sidebarState.exhausted = false;
  sidebarState.loading = true;
  const token = ++sidebarState.token;

  document.getElementById('sidebar-title').textContent = 'NO LOCATION';
  paintSidebar();
  document.getElementById('sidebar-content').scrollTop = 0;
  document.getElementById('sidebar').classList.add('open');

  let url = `/api/news?unlocated=1&days=7&limit=${PAGE_SIZE}`;
  if (activeFilter !== 'all') url += `&type=${encodeURIComponent(activeFilter)}`;

  try {
    const res = await fetch(url);
    const items = await res.json();
    if (token !== sidebarState.token) return;
    sidebarState.articles = items;
  } catch (err) {
    console.error('Failed to load reports with no location:', err);
  } finally {
    if (token === sidebarState.token) {
      sidebarState.loading = false;
      paintSidebar();
    }
  }
}

async function loadOlder() {
  if (sidebarState.loading || sidebarState.exhausted) return;
  const inCity = sidebarState.mode === 'city';
  if (inCity && !sidebarState.city) return;

  const token = sidebarState.token;
  const last = sidebarState.articles[sidebarState.articles.length - 1];
  const beforeDate = last ? last.date : new Date().toISOString();

  const scope = inCity ? `city=${encodeURIComponent(sidebarState.city)}` : 'unlocated=1';
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

document.getElementById('unlocated-link').addEventListener('click', openUnlocated);

document.querySelectorAll('.filter').forEach(el => {
  el.addEventListener('click', () => {
    activeFilter = el.dataset.filter;
    document.querySelectorAll('.filter').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    render();
    if (sidebarState.mode === 'unlocated' &&
        document.getElementById('sidebar').classList.contains('open')) {
      openUnlocated();
    }
  });
});

fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
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
          return { color: '#FFD700', weight: 2, fillOpacity: 0, fillColor: 'transparent' };
        }
        return { color: '#FF4444', weight: 2, fillOpacity: 0, fillColor: 'transparent' };
      },
      interactive: false
    }).addTo(map);
  })
  .catch(err => console.error('Failed to load borders:', err));

fetch('/api/frontline')
  .then(res => {
    if (!res.ok) throw new Error('Frontline unavailable');
    return res.json();
  })
  .then(data => {
    L.geoJSON(data, {
      style: {
        color: '#CC0000',
        weight: 1,
        fillOpacity: 0.5,
        fillColor: '#CC0000'
      },
      interactive: false
    }).addTo(map);
  })
  .catch(err => console.error('Failed to load frontline:', err));

fetch('/api/frontline-info')
  .then(res => res.json())
  .then(info => {
    document.getElementById('frontline-date').textContent =
      info.date ? `as of ${info.date}` : 'date unavailable';
  })
  .catch(() => {
    document.getElementById('frontline-date').textContent = 'date unavailable';
  });

fetch('/api/stats?days=7')
  .then(res => res.json())
  .then(stats => {
    document.getElementById('unlocated-count').textContent = stats.unlocated;
    document.getElementById('unlocated-total').textContent = stats.total;
  })
  .catch(() => {
    document.getElementById('unlocated-count').textContent = '?';
    document.getElementById('unlocated-total').textContent = '?';
  });

fetch('/api/news')
  .then(res => res.json())
  .then(articles => {
    allArticles = articles;
    render();
  })
  .catch(err => console.error('Failed to load news:', err));