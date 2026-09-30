// assets/mapolis-globe.js
// Single unified globe instance for Mapolis (Title, Continent Picker, H2H Queue)
(function() {
  const SIZE = 500;
  let svgEl = null;
  let svg = null;
  let projection = null;
  let pathGen = null;
  let gratPath = null;
  let landPath = null;
  let pingG = null;
  let landReady = false;
  let currentMode = 'title';
  let isRunning = false;
  let lastTime = performance.now();
  let suspendedUntil = 0;
  let isDragging = false;
  let hasMoved = false;
  let downX = 0, downY = 0;
  let startRotation = [0, -10, 0];

  const PINGS = [
    [139.69, 35.69],[77.21, 28.61],[121.47, 31.23],[-46.63,-23.55],[-99.13, 19.43],
    [31.24, 30.04],[72.88, 19.08],[116.41, 39.90],[90.41, 23.81],[135.50, 34.69],
    [-74.01, 40.71],[67.01, 24.86],[-58.38,-34.60],[106.55, 29.56],[28.98, 41.01],
    [88.36, 22.57],[120.98, 14.60],[3.38, 6.52],[-43.17,-22.91],[117.36, 39.34],
    [106.83,-6.21],[113.26, 23.13],[74.34, 31.55],[77.59, 12.97],[114.06, 22.54],
    [37.62, 55.75],[80.27, 13.08],[-74.07, 4.71],[-77.04,-12.05],[100.50, 13.76],
    [-0.13, 51.51],[2.35, 48.86],[-3.70, 40.42],[13.40, 52.52],[15.27,-4.33],
    [28.05,-26.20],[13.23,-8.84],[-118.24, 34.05],[-87.63, 41.88],[151.21,-33.87],
    [36.82,-1.29],[38.74, 9.03],[-7.59, 33.57],[18.42,-33.92],[39.28,-6.79],
    [82.93, 55.04],[131.89, 43.12],[115.86,-31.95],[-79.38, 43.65],[-95.37, 29.76],
    [-70.65,-33.45]
  ];

  const CONTINENT_CENTROIDS = [
    { key: 'africa',        c: [20, 5] },
    { key: 'asia',          c: [90, 35] },
    { key: 'europe',        c: [15, 50] },
    { key: 'north-america', c: [-100, 45] },
    { key: 'south-america', c: [-60, -15] },
    { key: 'oceania',       c: [140, -25] }
  ];

  function nearestContinent(lon, lat) {
    let best = null, bestD = Infinity;
    const lat1 = lat * Math.PI / 180;
    for (const cc of CONTINENT_CENTROIDS) {
      const lat2 = cc.c[1] * Math.PI / 180;
      const dLon = (cc.c[0] - lon) * Math.PI / 180;
      const cosD = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
      const d = Math.acos(Math.max(-1, Math.min(1, cosD)));
      if (d < bestD) { bestD = d; best = cc.key; }
    }
    return best;
  }

  function init() {
    if (svgEl) return;
    if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
      setTimeout(init, 50);
      return;
    }

    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.id = 'mapolis-unified-globe';
    svgEl.setAttribute('viewBox', '0 0 ' + SIZE + ' ' + SIZE);
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.display = 'block';

    svg = d3.select(svgEl);
    projection = d3.geoOrthographic()
      .scale(SIZE / 2 - 6)
      .translate([SIZE / 2, SIZE / 2])
      .clipAngle(90);
    pathGen = d3.geoPath(projection);

    // Ocean sphere
    svg.append('circle')
      .attr('cx', SIZE / 2).attr('cy', SIZE / 2).attr('r', SIZE / 2 - 6)
      .attr('fill', '#1a3a70')
      .attr('stroke', 'rgba(142,218,118,0.4)')
      .attr('stroke-width', 0.9);

    // Graticule lines
    gratPath = svg.append('path').datum(d3.geoGraticule10())
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.09)')
      .attr('stroke-width', 0.4);

    // Land polygons
    landPath = svg.append('path')
      .attr('fill', 'rgba(100,190,80,0.78)')
      .attr('stroke', 'rgba(142,218,118,0.95)')
      .attr('stroke-width', 0.6);

    // Metro city pings
    pingG = svg.append('g');

    setupInteractions();
    tryLoadLand();
    render();
  }

  function tryLoadLand() {
    if (landReady) return;
    if (typeof WORLD_TOPO !== 'undefined' && WORLD_TOPO && WORLD_TOPO.objects && WORLD_TOPO.objects.countries) {
      try {
        const merged = topojson.merge(WORLD_TOPO, WORLD_TOPO.objects.countries.geometries);
        landPath.datum(merged);
        landReady = true;
      } catch (e) {
        try {
          landPath.datum(topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries));
          landReady = true;
        } catch (e2) {}
      }
      render();
    } else {
      setTimeout(tryLoadLand, 120);
    }
  }

  let frameCount = 0;
  function render() {
    if (!pathGen) return;
    gratPath.attr('d', pathGen);
    if (landReady) {
      if (frameCount % 2 === 0 || isDragging) {
        landPath.attr('d', pathGen);
      }
    }
    frameCount++;

    // Metro pings
    const r = projection.rotate();
    const lam = -r[0] * Math.PI / 180, phi = -r[1] * Math.PI / 180;
    const cx = Math.cos(phi) * Math.cos(lam);
    const cy = Math.cos(phi) * Math.sin(lam);
    const cz = Math.sin(phi);

    const visible = PINGS.filter(p => {
      const px = Math.cos(p[1] * Math.PI / 180) * Math.cos(p[0] * Math.PI / 180);
      const py = Math.cos(p[1] * Math.PI / 180) * Math.sin(p[0] * Math.PI / 180);
      const pz = Math.sin(p[1] * Math.PI / 180);
      return (px * cx + py * cy + pz * cz) > 0.05;
    });

    const sel = pingG.selectAll('circle').data(visible, d => d[0] + ',' + d[1]);
    sel.enter().append('circle')
      .attr('r', 2.2).attr('fill', '#ffd54f').attr('opacity', 0.95)
      .merge(sel)
      .attr('cx', d => projection(d)[0])
      .attr('cy', d => projection(d)[1]);
    sel.exit().remove();
  }

  function loop(now) {
    if (!isRunning) return;
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    if (!isDragging && now > suspendedUntil) {
      const speed = (currentMode === 'title') ? 0.012 : 0.02;
      const r = projection.rotate();
      projection.rotate([r[0] + dt * speed, r[1], r[2]]);
      render();
    }

    requestAnimationFrame(loop);
  }

  function setupInteractions() {
    svgEl.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    svgEl.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp, { passive: false });
  }

  function onDown(e) {
    if (currentMode !== 'picker') return;
    if (e.cancelable) e.preventDefault();
    isDragging = true;
    hasMoved = false;
    const t = (e.touches && e.touches[0]) || e;
    downX = t.clientX;
    downY = t.clientY;
    startRotation = projection.rotate();
  }

  function onMove(e) {
    if (!isDragging || currentMode !== 'picker') return;
    if (e.cancelable) e.preventDefault();
    const t = (e.touches && e.touches[0]) || e;
    const dx = t.clientX - downX;
    const dy = t.clientY - downY;
    if (Math.abs(dx) + Math.abs(dy) > 5) hasMoved = true;
    if (!hasMoved) return;

    const k = 0.4;
    projection.rotate([
      startRotation[0] + dx * k,
      Math.max(-85, Math.min(85, startRotation[1] - dy * k)),
      startRotation[2]
    ]);
    render();
  }

  function onUp(e) {
    if (!isDragging || currentMode !== 'picker') return;
    isDragging = false;
    suspendedUntil = performance.now() + 2500; // Brief pause after user releases

    if (!hasMoved) {
      // Tap on continent
      const rect = svgEl.getBoundingClientRect();
      const px = ((downX - rect.left) / rect.width) * SIZE;
      const py = ((downY - rect.top) / rect.height) * SIZE;
      const r = SIZE / 2;
      const dx = px - r, dy = py - r;
      if (dx * dx + dy * dy > (r - 6) * (r - 6)) return;

      const inv = projection.invert([px, py]);
      if (!inv) return;
      const key = nearestContinent(inv[0], inv[1]);
      if (!key) return;

      // Flash feedback
      const flash = document.createElement('div');
      flash.className = 'gp-flash';
      flash.style.left = (downX - rect.left) + 'px';
      flash.style.top = (downY - rect.top) + 'px';
      flash.style.width = '50px';
      flash.style.height = '50px';
      if (svgEl.parentNode) svgEl.parentNode.appendChild(flash);
      setTimeout(() => { try { flash.remove(); } catch (err) {} }, 600);

      if (typeof AudioMgr !== 'undefined' && AudioMgr.slideIn) AudioMgr.slideIn();
      if (typeof setupState !== 'undefined') {
        setupState.view = key;
        setTimeout(() => {
          if (typeof renderSetupSubPage === 'function') renderSetupSubPage(key);
        }, 120);
      }
    }
  }

  window.MapolisGlobe = {
    init: init,
    onWorldLoaded: function() {
      tryLoadLand();
    },
    mount: function(containerId, mode) {
      init();
      tryLoadLand();
      currentMode = mode || 'title';
      const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (container && svgEl) {
        if (svgEl.parentNode !== container) {
          container.appendChild(svgEl);
        }
        svgEl.style.display = 'block';
        if (currentMode === 'picker') {
          container.style.cursor = 'grab';
          container.style.touchAction = 'none';
        } else {
          container.style.cursor = 'default';
          container.style.touchAction = 'auto';
        }
      }
      this.start();
    },
    start: function() {
      if (!isRunning) {
        isRunning = true;
        lastTime = performance.now();
        requestAnimationFrame(loop);
      }
    },
    stop: function() {
      isRunning = false;
      if (svgEl) svgEl.style.display = 'none';
    },
    getSvg: function() {
      init();
      return svgEl;
    }
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
