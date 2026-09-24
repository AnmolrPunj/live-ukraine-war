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

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  const then = new Date(dateStr);
  if (isNaN(then)) return null;
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function openSidebar(group) {
  const sidebar = document.getElementById('sidebar');
  const sidebarTitle = document.getElementById('sidebar-title');
  const sidebarContent = document.getElementById('sidebar-content');

  sidebarTitle.textContent = `${group.city} — ${group.articles.length} article${group.articles.length > 1 ? 's' : ''}`;

  const sorted = [...group.articles].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  sidebarContent.innerHTML = sorted.map(a => {
    const time = timeAgo(a.date);
    return `
      <div class="article-card">
        <div class="article-title">${a.title}</div>
        <div class="article-desc">${a.description}</div>
        <div class="article-footer">
          <span class="article-time">${time || ''}</span>
          <a href="${a.link}" target="_blank" class="article-link">Read Article</a>
        </div>
      </div>
    `;
  }).join('');

  sidebar.classList.add('open');
}

document.getElementById('sidebar-close').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
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
        } else {
          return { color: '#FF4444', weight: 2, fillOpacity: 0, fillColor: 'transparent' };
        }
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
    const grouped = {};
    articles.forEach(article => {
      const key = article.city;
      if (!grouped[key]) {
        grouped[key] = { lat: article.lat, lng: article.lng, city: article.city, articles: [] };
      }
      grouped[key].articles.push(article);
    });

    Object.values(grouped).forEach(group => {
      L.circleMarker([group.lat, group.lng], {
        radius: 5,
        fillColor: '#CC0000',
        color: '#fff',
        weight: 1,
        fillOpacity: 0.9,
        interactive: false
      }).addTo(map);

      L.circleMarker([group.lat, group.lng], {
        radius: 16,
        fillColor: 'transparent',
        color: 'transparent',
        weight: 0,
        fillOpacity: 0,
        interactive: true,
        bubblingMouseEvents: false
      }).addTo(map).on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        openSidebar(group);
      });
    });
  })
  .catch(err => console.error('Failed to load news:', err));