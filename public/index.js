const bounds = L.latLngBounds(
    L.latLng(44.0, 22.0),  
    L.latLng(52.5, 40.5) 
);

const map = L.map('map', {
    maxBounds: bounds,
    maxBoundsViscosity: 1.0,
    minZoom: 6,
    maxZoom: 12
}).setView([48.3794, 31.1656], 7);

L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    attribution: '© Stadia Maps © OpenStreetMap contributors',
}).addTo(map);

fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
  .then(res => res.json())
  .then(data => {
    console.log(data.features[0].properties);
    
    L.geoJSON(data, {
      filter: (feature) => {
        const name = feature.properties.ADMIN || feature.properties.name;
        return ['Ukraine', 'Russia'].includes(name);
      },
      style: (feature) => {
        const name = feature.properties.ADMIN || feature.properties.name;
        if (name === 'Ukraine') {
          return { color: '#FFD700', weight: 3, fillOpacity: 0.15, fillColor: '#FFD700' };
        } else {
          return { color: '#FF4444', weight: 3, fillOpacity: 0.15, fillColor: '#FF4444' };
        }
      }
    }).addTo(map);
  });