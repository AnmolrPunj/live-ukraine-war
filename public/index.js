const bounds = L.latLngBounds(
    L.latLng(44.0, 22.0),
    L.latLng(52.5, 40.5)
);

const map = L.map('map', {
    maxBounds: bounds,
    maxBoundsViscosity: 1.0,
    minZoom: 5.5,
    maxZoom: 12
}).setView([48.3794, 31.1656], 5.5);

L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    attribution: '© Stadia Maps © OpenStreetMap contributors',
}).addTo(map);

const MARKER_STYLES = {
  military: { color: '#CC0000', label: 'Military / Combat' },
  diplomatic: { color: '#4A90D9', label: 'Diplomatic / Political' },
  humanitarian: { color: '#E8A838', label: 'Humanitarian' }
};

const pinLayer = L.layerGroup().addTo(map);
let allArticles = [];
let activeFilter = 'all';
let currentCity = null;

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
  const diff = Math.floor((Date.now() - then) / 1000);
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

function closeSidebar() {
  currentCity = null;
  document.getElementById('sidebar').classList.remove('open');
}

function openSidebar(city, articles) {
  const sorted = [...articles].sort((a, b) => dateValue(b) - dateValue(a));
  const filterLabel = activeFilter === 'all' ? '' : ` · ${MARKER_STYLES[activeFilter].label}`;

  document.getElementById('sidebar-title').textContent = city.toUpperCase();
  document.getElementById('sidebar-updated').textContent =
    `${sorted.length} ${sorted.length === 1 ? 'report' : 'reports'}${filterLabel}`;

  document.getElementById('sidebar-content').innerHTML = sorted.map(article => {
    const style = MARKER_STYLES[article.type] || MARKER_STYLES.military;
    return `
      <div class="article-card">
        <div class="article-type" style="color:${style.color}">${style.label}</div>
        <div class="article-title">${escapeHTML(article.title)}</div>
        <div class="article-desc">${escapeHTML(article.description)}</div>
        <div class="article-footer">
          <span class="article-time">${timeAgo(article.date)}</span>
          <a href="${escapeHTML(article.link)}" target="_blank" rel="noopener" class="article-link">Source →</a>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('sidebar-content').scrollTop = 0;
  document.getElementById('sidebar').classList.add('open');
}

function render() {
  pinLayer.clearLayers();
  const groups = groupByCity(visibleArticles());

  Object.entries(groups).forEach(([city, list]) => {
    const radius = Math.min(5 + Math.sqrt(list.length) * 2.5, 18);
    const lat = list[0].lat;
    const lng = list[0].lng;

    L.circleMarker([lat, lng], {
      radius: radius,
      fillColor: '#ffffff',
      color: '#000000',
      weight: 1.5,
      fillOpacity: 0.9,
      interactive: false
    }).addTo(pinLayer);

    L.circleMarker([lat, lng], {
      radius: radius + 8,
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

const legend = document.getElementById('legend');
L.DomEvent.disableClickPropagation(legend);

document.querySelectorAll('.filter').forEach(el => {
  el.addEventListener('click', () => {
    activeFilter = el.dataset.filter;
    document.querySelectorAll('.filter').forEach(f => f.classList.remove('active'));
    el.classList.add('active');
    render();
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
  });

fetch('/api/frontline')
  .then(res => res.json())
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

fetch('/api/news')
  .then(res => res.json())
  .then(articles => {
    allArticles = articles;
    render();
  })
  .catch(err => console.error('Failed to load news:', err));