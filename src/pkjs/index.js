// Should I Fly? - PebbleKit JS (US only)
// Weather: Open-Meteo. Space weather: NOAA SWPC. Airspace: FAA public ArcGIS + FAA TFR WFS.
// Advisory only - always verify in the FAA B4UFLY app / official sources before flying.

var Clay = require('@rebble/clay');
var clayConfig = require('./config.json');
var clay = new Clay(clayConfig); // saves settings to localStorage 'clay-settings'

var ARC = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
var SEARCH_MI = 5;      // search radius for airspace zones (setting)

var DEFAULTS = {
  SET_WUNIT: 'mph', SET_TUNIT: 'F', SET_DUNIT: 'imperial',
  SET_MAXALT: 400, SET_RADIUS: 5, SET_NIGHT: true, SET_STADIUM: true,
  SET_WCAUT: 15, SET_WNOGO: 24, SET_GCAUT: 20, SET_GNOGO: 30,
  SET_COLDC: 40, SET_COLDN: 14, SET_HOTC: 95, SET_HOTN: 104,
  SET_VISC: 3, SET_VISN: 1, SET_KPC: 5, SET_KPN: 7,
  SET_VIBE: true, SET_SOUND: false, SET_VOLUME: 60
};
var S = {};

function loadSettings() {
  var cs = {};
  try { cs = JSON.parse(localStorage.getItem('clay-settings') || '{}') || {}; } catch (e) { cs = {}; }
  for (var k in DEFAULTS) {
    var v = (cs[k] === undefined || cs[k] === null || cs[k] === '') ? DEFAULTS[k] : cs[k];
    if (typeof DEFAULTS[k] === 'number') { v = Number(v); if (isNaN(v)) v = DEFAULTS[k]; }
    else if (typeof DEFAULTS[k] === 'boolean') { v = (v === true || v === 'true' || v === 1 || v === '1'); }
    else v = String(v);
    S[k] = v;
  }
  SEARCH_MI = S.SET_RADIUS;
}
loadSettings();

/* ---------- units ---------- */
var WLABEL = { mph: 'mph', kt: 'kt', ms: 'm/s', kmh: 'km/h' };
function isMetric() { return S.SET_DUNIT === 'metric'; }
function wconv(mph) {
  switch (S.SET_WUNIT) {
    case 'kt': return mph * 0.868976;
    case 'ms': return mph * 0.44704;
    case 'kmh': return mph * 1.609344;
    default: return mph;
  }
}
function wr(mph) { return Math.round(wconv(mph)); }
function fmtWind(mph) { return wr(mph) + ' ' + WLABEL[S.SET_WUNIT]; }
function fmtAlt(ft) { return isMetric() ? (Math.round(ft * 0.3048 / 5) * 5) + ' m' : Math.round(ft) + ' ft'; }
function fmtTemp(f) { return Math.round(S.SET_TUNIT === 'C' ? (f - 32) * 5 / 9 : f) + S.SET_TUNIT; }
function fmtLen(mi) { // miles -> display distance
  var v = isMetric() ? mi * 1.609344 : mi;
  var r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return r + (isMetric() ? ' km' : ' mi');
}
function fmtRain(inch) { return isMetric() ? (inch * 25.4).toFixed(1) + ' mm' : inch.toFixed(2) + ' in'; }

var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
var sending = false;
var running = false;

/* ---------- send queue (AppMessage must be sent one at a time) ---------- */
var queue = [];
function enqueue(msg) { queue.push(msg); pump(); }
function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var m = queue.shift();
  Pebble.sendAppMessage(m, function () { sending = false; pump(); },
    function () { sending = false; pump(); });
}
function status(s) { enqueue({ STATUS: s }); }

/* ---------- http ---------- */
function getJSON(url, cb, tried) {
  var done = false;
  var xhr = new XMLHttpRequest();
  xhr.timeout = 20000;
  function fin(v) {
    if (done) return;
    done = true;
    if (v === null && !tried) { setTimeout(function () { getJSON(url, cb, true); }, 800); return; } // one retry
    cb(v);
  }
  xhr.onload = function () {
    try { fin(JSON.parse(xhr.responseText)); }
    catch (e) { console.log('bad json (' + xhr.status + ') ' + url.substr(0, 110)); fin(null); }
  };
  xhr.onerror = function () { console.log('xhr error ' + url.substr(0, 110)); fin(null); };
  xhr.ontimeout = function () { console.log('xhr timeout ' + url.substr(0, 110)); fin(null); };
  xhr.open('GET', url);
  xhr.send();
}
function qs(o) {
  var p = [];
  for (var k in o) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]));
  return p.join('&');
}
function arcQuery(layer, lat, lon, where, fields, geom, cb) {
  var url = ARC + layer + '/FeatureServer/0/query?' + qs({
    geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326, outSR: 4326,
    distance: SEARCH_MI, units: 'esriSRUnit_StatuteMile', spatialRel: 'esriSpatialRelIntersects',
    where: where, outFields: fields, returnGeometry: geom ? 'true' : 'false',
    maxAllowableOffset: 0.0005, f: 'json'
  });
  getJSON(url, function (d) { cb(d && d.features ? d.features : null); });
}

/* ---------- geometry (rings = [[ [lon,lat], ... ], ...]) ---------- */
function project(lon, lat, lon0, lat0) {
  return [(lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 69.172, (lat - lat0) * 69.0];
}
function ringsInfo(rings, lat0, lon0) {
  // returns {inside, dist(mi), dir}
  var inside = false, best = 1e9, bx = 0, by = 0;
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r], n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = project(ring[i][0], ring[i][1], lon0, lat0);
      var b = project(ring[j][0], ring[j][1], lon0, lat0);
      if (((a[1] > 0) !== (b[1] > 0)) && (0 < (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
      // nearest point on segment a-b to origin
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      var t = l2 > 0 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2)) : 0;
      var px = a[0] + t * dx, py = a[1] + t * dy, d = Math.sqrt(px * px + py * py);
      if (d < best) { best = d; bx = px; by = py; }
    }
  }
  var ang = Math.atan2(bx, by) * 180 / Math.PI; if (ang < 0) ang += 360;
  return { inside: inside, dist: inside ? 0 : best, dir: DIRS[Math.round(ang / 45) % 8] };
}
function titleCase(s) {
  return (s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); })
    .replace(/\bIntl\b/g, 'Intl').replace(/\bFaa\b/g, 'FAA');
}
function cleanName(s) {
  s = (s || '').replace(/\b(CLASS [A-E]|AIRPORT|INTERNATIONAL|MODE C)\b/g, function (m) { return m === 'INTERNATIONAL' ? 'Intl' : ''; });
  return titleCase(s.replace(/\s+/g, ' ').trim());
}
function trunc(s, n) { s = s || ''; return s.length > n ? s.substring(0, n - 1) + '.' : s; }
function fmtDist(d) { return d < 0.05 ? 'here' : fmtLen(d); }

/* ---------- weather ---------- */
function minutes(iso) { return parseInt(iso.substr(11, 2), 10) * 60 + parseInt(iso.substr(14, 2), 10); }
function wcode(c) {
  if (c === 0) return 'Clear';
  if (c <= 2) return 'Partly cloudy';
  if (c === 3) return 'Overcast';
  if (c === 45 || c === 48) return 'Fog';
  if (c >= 51 && c <= 57) return 'Drizzle';
  if (c >= 61 && c <= 67) return 'Rain';
  if (c >= 71 && c <= 77) return 'Snow';
  if (c >= 80 && c <= 82) return 'Showers';
  if (c === 85 || c === 86) return 'Snow showers';
  if (c >= 95) return 'Thunderstorm';
  return 'Cloudy';
}
// Wind at height h (metres) from the model levels 10/80/120/180 m (linear interpolation)
function lerp(v0, h0, v1, h1, h) { return v0 + (v1 - v0) * (h - h0) / (h1 - h0); }
function windAt(l, h) {
  var pts = [[10, l[0]], [80, l[1]], [120, l[2]], [180, l[3]]];
  if (h <= pts[0][0]) return pts[0][1];
  for (var i = 1; i < pts.length; i++) {
    if (h <= pts[i][0]) return lerp(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0], h);
  }
  return pts[3][1];
}
function gustEst(wTop, w10, g10) { return Math.round(wTop + Math.max(0, g10 - w10)); }
function hourVerdict(wTop, g, precip, code) {
  if (wTop >= S.SET_WNOGO || g >= S.SET_GNOGO || code >= 95 || precip >= 0.05) return 2;
  if (wTop >= S.SET_WCAUT || g >= S.SET_GCAUT || precip > 0) return 1;
  return 0;
}

function fetchWeather(lat, lon, cb) {
  var url = 'https://api.open-meteo.com/v1/forecast?' + qs({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_speed_180m,wind_direction_10m,wind_gusts_10m',
    hourly: 'wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_speed_180m,wind_gusts_10m,precipitation,weather_code,visibility',
    daily: 'sunrise,sunset', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph',
    precipitation_unit: 'inch', timezone: 'auto', forecast_days: 2
  });
  getJSON(url, cb);
}
function fetchKp(cb) {
  getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', function (d) {
    if (!d || !d.length) return cb(null);
    var last = d[d.length - 1];
    var kp = (last && last.Kp !== undefined) ? last.Kp : (last && last[1]);
    cb(parseFloat(kp));
  });
}

/* ---------- airspace ---------- */
function fetchTfrs(lat, lon, cb) {
  var url = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json';
  getJSON(url, function (d) {
    if (!d || !d.features) return cb(null);
    var out = [];
    d.features.forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Polygon') return;
      var info = ringsInfo(f.geometry.coordinates, lat, lon);
      if (info.dist <= SEARCH_MI) {
        var p = f.properties || {};
        var t = (p.LEGAL || 'TFR');
        var city = (p.TITLE || '').split(',')[0];
        out.push({ kind: 'tfr', label: 'TFR', name: titleCase(t) + ' - ' + titleCase(city) + (p.STATE ? ' ' + p.STATE : ''), info: info });
      }
    });
    cb(out);
  });
}

function buildAirspace(lat, lon, cb) {
  var res = { zones: [], ceil: -1, ok: true, pending: 6 };
  var okFlags = { fac: false, cls: false, sua: false, dod: false, tfr: false, std: false };
  function done() {
    if (--res.pending > 0) return;
    res.ok = okFlags.fac && okFlags.cls && okFlags.tfr && okFlags.sua;
    res.missing = [];
    var nm = { fac: 'ceiling', cls: 'class', sua: 'restricted', tfr: 'TFR', dod: 'military', std: 'stadium' };
    for (var k in nm) if (!okFlags[k]) res.missing.push(nm[k]);
    cb(res);
  }
  // 1) LAANC facility map ceiling at the exact point
  getJSON(ARC + 'FAA_UAS_FacilityMap_Data/FeatureServer/0/query?' + qs({
    geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects', outFields: 'CEILING,APT1_NAME', returnGeometry: 'false', f: 'json'
  }), function (d) {
    if (d && d.features) {
      okFlags.fac = true;
      if (d.features.length) {
        var c = 99999;
        d.features.forEach(function (f) { c = Math.min(c, f.attributes.CEILING); });
        res.ceil = c;
        res.apt = cleanName(d.features[0].attributes.APT1_NAME);
      }
    }
    done();
  });
  // 2) Controlled airspace reaching the surface
  arcQuery('Class_Airspace', lat, lon, "LOWER_VAL<=400 AND LOCAL_TYPE<>'MODE C'", 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL', true, function (fs) {
    if (fs) {
      okFlags.cls = true;
      fs.forEach(function (f) {
        var a = f.attributes, lt = a.LOCAL_TYPE || '';
        var cl = a.CLASS || (lt.indexOf('CLASS_') === 0 ? lt.substr(6, 1) : '?');
        res.zones.push({ kind: 'cls', label: 'Class ' + cl, name: cleanName(a.NAME), info: ringsInfo(f.geometry.rings, lat, lon) });
      });
    }
    done();
  });
  // 3) Prohibited / Restricted
  arcQuery('Special_Use_Airspace', lat, lon, "TYPE_CODE IN ('P','R') AND LOWER_VAL<=400", 'NAME,TYPE_CODE', true, function (fs) {
    if (fs) {
      okFlags.sua = true;
      fs.forEach(function (f) {
        var p = f.attributes.TYPE_CODE === 'P';
        res.zones.push({ kind: 'sua', label: p ? 'Prohibited' : 'Restricted', name: titleCase(f.attributes.NAME), info: ringsInfo(f.geometry.rings, lat, lon) });
      });
    }
    done();
  });
  // 4) Military / national security UAS restrictions
  arcQuery('DoD_Mar_13', lat, lon, '1=1', 'Base,Facility', true, function (fs) {
    if (fs) {
      okFlags.dod = true;
      fs.forEach(function (f) {
        var a = f.attributes;
        res.zones.push({ kind: 'dod', label: 'Military', name: titleCase(a.Base || a.Facility || 'Base'), info: ringsInfo(f.geometry.rings, lat, lon) });
      });
    }
    done();
  });
  // 5) Stadiums (3 mi restriction during events)
  if (!S.SET_STADIUM) { okFlags.std = true; done(); } else arcQuery('Stadiums', lat, lon, '1=1', 'NAME', true, function (fs) {
    if (fs) {
      okFlags.std = true;
      fs.forEach(function (f) {
        if (!f.geometry) return;
        var p = project(f.geometry.x, f.geometry.y, lon, lat), d = Math.sqrt(p[0] * p[0] + p[1] * p[1]);
        var ang = Math.atan2(p[0], p[1]) * 180 / Math.PI; if (ang < 0) ang += 360;
        res.zones.push({ kind: 'std', label: 'Stadium', name: titleCase(f.attributes.NAME), info: { inside: d <= 3, dist: d <= 3 ? 0 : d - 3, dir: DIRS[Math.round(ang / 45) % 8], center: d } });
      });
    }
    done();
  });
  // 6) TFRs
  fetchTfrs(lat, lon, function (list) {
    if (list) { okFlags.tfr = true; res.zones = res.zones.concat(list); }
    done();
  });
}

/* ---------- verdict ---------- */
function assess(w, kp, air) {
  var alerts = []; // {sev, text, detail}
  function add(sev, text, detail) { alerts.push({ sev: sev, text: text, detail: detail || '' }); }
  var c = w.current, h = w.hourly;
  var hi = 0;
  for (var i = 0; i < h.time.length; i++) { if (h.time[i].substr(0, 13) === c.time.substr(0, 13)) { hi = i; break; } }
  var vis = (h.visibility[hi] || 16000) / 1609.34;   // miles
  var maxAlt = S.SET_MAXALT, topM = maxAlt * 0.3048;
  var lv = [c.wind_speed_10m, c.wind_speed_80m, c.wind_speed_120m, c.wind_speed_180m];
  var wTop = windAt(lv, topM), w10 = c.wind_speed_10m;
  var g = gustEst(wTop, w10, c.wind_gusts_10m);
  var precip = c.precipitation, code = c.weather_code;
  var t = Math.round(c.temperature_2m);
  var now = minutes(c.time), rise = minutes(w.daily.sunrise[0]), set = minutes(w.daily.sunset[0]);
  var atTop = ' at ' + fmtAlt(maxAlt);

  if (wTop >= S.SET_WNOGO) add(2, 'Wind too strong', fmtWind(wTop) + atTop);
  else if (wTop >= S.SET_WCAUT) add(1, 'Windy aloft', fmtWind(wTop) + atTop);
  if (g >= S.SET_GNOGO) add(2, 'Dangerous gusts', 'Gusts up to ~' + fmtWind(g));
  else if (g >= S.SET_GCAUT) add(1, 'Gusty', 'Gusts up to ~' + fmtWind(g));
  if (code >= 95) add(2, 'Thunderstorm', 'Do not fly');
  else if (precip >= 0.05) add(2, wcode(code), 'Drones are not waterproof');
  else if (precip > 0 || (code >= 51 && code <= 86)) add(1, wcode(code), 'Light precipitation');
  if (t <= S.SET_COLDN) add(2, 'Too cold', fmtTemp(t) + ' - battery failure risk');
  else if (t <= S.SET_COLDC) add(1, 'Cold battery', fmtTemp(t) + ' - warm batteries first');
  if (t >= S.SET_HOTN) add(2, 'Too hot', fmtTemp(t) + ' - overheating risk');
  else if (t >= S.SET_HOTC) add(1, 'Hot', fmtTemp(t) + ' - watch motor/battery temp');
  if (vis < S.SET_VISN) add(2, 'Low visibility', fmtLen(vis) + ' - need ' + fmtLen(3) + ' (VLOS)');
  else if (vis < S.SET_VISC) add(1, 'Reduced visibility', fmtLen(vis) + ' - need ' + fmtLen(3));
  if (code === 45 || code === 48) add(1, 'Fog', 'Keep your drone in sight');
  if (kp >= S.SET_KPN) add(2, 'Geomagnetic storm', 'Kp ' + kp.toFixed(0) + ' - GPS unreliable');
  else if (kp >= S.SET_KPC) add(1, 'Geomagnetic activity', 'Kp ' + kp.toFixed(0) + ' - GPS may drift');
  if (S.SET_NIGHT) {
    if (now < rise - 30 || now > set + 30) add(1, 'Night flight', 'Anti-collision light required');
    else if (now < rise || now > set) add(0, 'Twilight', 'Anti-collision light required');
  }

  // airspace -> zone lines
  var zones = air.zones.slice().sort(function (a, b) {
    if (a.info.inside !== b.info.inside) return a.info.inside ? -1 : 1;
    return a.info.dist - b.info.dist;
  });
  var zlines = [], zseen = {};
  var inCtrl = false;
  zones.forEach(function (z) {
    var i = z.info, sev = 0, loc = i.inside ? 'inside' : fmtDist(i.dist) + ' ' + i.dir;
    if (z.kind === 'tfr' || z.kind === 'sua' || z.kind === 'dod') sev = i.inside ? 2 : (i.dist < 1 ? 1 : 0);
    else if (z.kind === 'std') sev = i.inside ? 1 : 0;
    else if (z.kind === 'cls' && i.inside) {
      inCtrl = true;
      if (air.ceil === 0) sev = 2; else if (air.ceil > 0 && air.ceil < maxAlt) sev = 1; else if (air.ceil < 0) sev = 1; else sev = 0;
    }
    z.sev = sev;
    var zk = z.label + z.name + loc;
    if (zlines.length < 5 && !zseen[zk]) { zseen[zk] = 1; zlines.push('' + sev + trunc(z.label, 11) + ' ' + loc + '\t' + trunc(z.name, 30)); }
  });
  zones.forEach(function (z) {
    if (z.sev > 0) {
      var det = z.name + (z.info.inside ? ' (inside)' : ', ' + fmtDist(z.info.dist) + ' ' + z.info.dir);
      var txt = z.kind === 'tfr' ? 'Flight restriction' : z.kind === 'cls' ? 'Controlled airspace' : z.kind === 'sua' ? z.label + ' area' : z.kind === 'dod' ? 'Military restriction' : 'Stadium zone';
      add(z.sev, txt, det);
    }
  });
  var ceilSev = 0;
  if (air.ceil >= 0) {
    if (air.ceil === 0) { add(2, 'No-fly grid', 'Ceiling 0 - need authorization'); ceilSev = 2; }
    else if (air.ceil < maxAlt) { add(1, 'Altitude ceiling', 'Max ' + fmtAlt(air.ceil) + ' AGL without approval'); ceilSev = 1; }
  } else if (inCtrl) {
    add(1, 'Authorization needed', 'Controlled airspace - use LAANC');
    ceilSev = 1;
  }
  if (!air.ok) add(1, 'Airspace data incomplete', 'Missing: ' + (air.missing || []).join(', '));
  var seen = {};
  alerts = alerts.filter(function (a) { var k = a.text + a.detail; if (seen[k]) return false; seen[k] = 1; return true; });
  alerts.sort(function (a, b) { return b.sev - a.sev; });

  var verdict = 0;
  alerts.forEach(function (a) { if (a.sev > verdict) verdict = a.sev; });
  var reason = verdict === 0 ? 'Conditions look good' : alerts[0].text;

  // 6-hour window (wind at the max altitude)
  var hw = [], hv = [];
  for (var k = 0; k < 6; k++) {
    var ix = Math.min(hi + k, h.time.length - 1);
    var hl = [h.wind_speed_10m[ix], h.wind_speed_80m[ix], h.wind_speed_120m[ix], h.wind_speed_180m[ix]];
    var ww = windAt(hl, topM), gg = gustEst(ww, h.wind_speed_10m[ix], h.wind_gusts_10m[ix]);
    hw.push(Math.min(255, wr(ww)));
    hv.push(hourVerdict(ww, gg, h.precipitation[ix], h.weather_code[ix]));
  }

  // wind rows, top altitude first
  var wind = [], lbl = [];
  for (var r = 0; r < 5; r++) {
    var ft = maxAlt * (4 - r) / 4;
    wind.push(Math.min(255, wr(windAt(lv, ft * 0.3048))));
    lbl.push(fmtAlt(ft));
  }
  var vsev = vis < S.SET_VISN ? 2 : (vis < S.SET_VISC ? 1 : 0);
  var tsev = (t <= S.SET_COLDN || t >= S.SET_HOTN) ? 2 : ((t <= S.SET_COLDC || t >= S.SET_HOTC) ? 1 : 0);
  var ksev = kp >= S.SET_KPN ? 2 : (kp >= S.SET_KPC ? 1 : 0);
  var gsev = g >= S.SET_GNOGO ? 2 : (g >= S.SET_GCAUT ? 1 : 0);
  var csev = (precip >= 0.05 || code >= 95) ? 2 : ((precip > 0) ? 1 : 0);
  var effCeil = air.ceil < 0 ? maxAlt : Math.min(air.ceil, maxAlt);

  return {
    verdict: verdict, reason: reason, alerts: alerts, zlines: zlines, hw: hw, hv: hv,
    m1: {
      VERDICT: verdict, REASON: trunc(reason, 40), WIND: wind, WLBL: lbl.join('|'), WUNIT: WLABEL[S.SET_WUNIT],
      WMAX: wr(30), WCAUT: wr(S.SET_WCAUT), WNOGO: wr(S.SET_WNOGO), GUST: wr(g), WDIR: c.wind_direction_10m,
      STAT: fmtWind(wTop) + ' @ ' + fmtAlt(maxAlt) + '  |  ' + fmtTemp(t),
      SEVS: '' + tsev + csev + vsev + ksev + gsev,
      SOUND: S.SET_SOUND ? 1 : 0, VOLUME: S.SET_VOLUME, VIBE: S.SET_VIBE ? 1 : 0
    },
    m2: {
      TEMPTXT: fmtTemp(t), PRECIPTXT: fmtRain(precip), VISTXT: fmtLen(vis), KPTXT: 'Kp ' + kp.toFixed(1), COND: wcode(code),
      SUNRISE: rise, SUNSET: set,
      CEILTXT: air.ceil === 0 ? 'NO FLY' : 'Max ' + fmtAlt(effCeil),
      CEILSUB: (air.ceil >= 0 && air.ceil < maxAlt) ? 'FAA grid ceiling here' : (maxAlt === 400 ? 'legal limit, above ground' : 'your limit, above ground'),
      CEILSEV: ceilSev, HSTART: Math.floor(now / 60), HLBL: fmtAlt(maxAlt).toUpperCase()
    }
  };
}

/* ---------- main flow ---------- */
function run() {
  if (running) return;
  running = true;
  loadSettings();
  status('Finding you...');
  navigator.geolocation.getCurrentPosition(function (pos) {
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    status('Checking weather...');
    var weather = null, kp = null, air = null, left = 3;
    function check() {
      if (--left > 0) return;
      running = false;
      if (!weather || !weather.current) { status('No weather data. Check connection.'); return; }
      var r;
      try { r = assess(weather, kp === null || isNaN(kp) ? 0 : kp, air || { zones: [], ceil: -1, ok: false, missing: ['all'] }); }
      catch (e) { status('Error: ' + e.message); return; }
      enqueue(r.m2);
      enqueue({ HW: r.hw, HV: r.hv });
      enqueue({ ZONES: r.zlines.length ? r.zlines.join('\n') : '0No restricted zones\twithin ' + fmtLen(SEARCH_MI) });
      var al = r.alerts.slice(0, 6).map(function (a) { return '' + a.sev + a.text + '\t' + trunc(a.detail, 34); });
      enqueue({ ALERTS: al.length ? al.join('\n') : '0All clear\tNo warnings' });
      enqueue(r.m1); // verdict last: it triggers the vibration / sound
    }
    fetchWeather(lat, lon, function (d) { weather = d; check(); });
    fetchKp(function (k) { kp = k; check(); });
    buildAirspace(lat, lon, function (a) { air = a; check(); });
  }, function () {
    running = false;
    status('Location unavailable. Enable location for Pebble.');
  }, { timeout: 20000, maximumAge: 120000 });
}

Pebble.addEventListener('ready', function () { run(); });
Pebble.addEventListener('appmessage', function (e) { if (e.payload && e.payload.REQUEST !== undefined) run(); });
// Settings saved in the Pebble app: Clay stores them, then refresh with the new limits.
Pebble.addEventListener('webviewclosed', function () { setTimeout(run, 600); });
