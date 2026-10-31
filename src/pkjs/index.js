// Should I Fly? - PebbleKit JS (US only)
// Weather: Open-Meteo. Space weather: NOAA SWPC. Airspace: FAA public ArcGIS + FAA TFR WFS.
// Advisory only - always verify in the FAA B4UFLY app / official sources before flying.

var ARC = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
var SEARCH_MI = 5;      // look for airspace zones this far away
var MAX_ALT_FT = 400;   // legal ceiling (AGL) for the drone

// Weather limits (mph). Edit to taste.
var LIM = {
  windCaution: 15, windNoGo: 24,
  gustCaution: 20, gustNoGo: 30,
  tempCautionLow: 40, tempNoGoLow: 14, tempCautionHigh: 95, tempNoGoHigh: 104,
  visCaution: 3, visNoGo: 1,
  kpCaution: 5, kpNoGo: 7
};

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
function fmtDist(d) { return d < 0.05 ? 'here' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' mi'; }

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
function gust120(w120, w10, g10) { return Math.round(w120 + Math.max(0, g10 - w10)); }
function hourVerdict(w120, g, precip, code) {
  if (w120 >= LIM.windNoGo || g >= LIM.gustNoGo || (code >= 95) || precip >= 0.05) return 2;
  if (w120 >= LIM.windCaution || g >= LIM.gustCaution || precip > 0) return 1;
  return 0;
}

function fetchWeather(lat, lon, cb) {
  var url = 'https://api.open-meteo.com/v1/forecast?' + qs({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_speed_180m,wind_direction_10m,wind_gusts_10m',
    hourly: 'wind_speed_10m,wind_speed_120m,wind_gusts_10m,precipitation,weather_code,visibility',
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
  arcQuery('Stadiums', lat, lon, '1=1', 'NAME', true, function (fs) {
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
  var vis = (h.visibility[hi] || 16000) / 1609.34;
  var w120 = c.wind_speed_120m, w10 = c.wind_speed_10m;
  var g = gust120(w120, w10, c.wind_gusts_10m);
  var precip = c.precipitation, code = c.weather_code;
  var t = Math.round(c.temperature_2m);
  var now = minutes(c.time), rise = minutes(w.daily.sunrise[0]), set = minutes(w.daily.sunset[0]);

  if (w120 >= LIM.windNoGo) add(2, 'Wind too strong', Math.round(w120) + ' mph at 400 ft');
  else if (w120 >= LIM.windCaution) add(1, 'Windy aloft', Math.round(w120) + ' mph at 400 ft');
  if (g >= LIM.gustNoGo) add(2, 'Dangerous gusts', 'Gusts up to ~' + g + ' mph');
  else if (g >= LIM.gustCaution) add(1, 'Gusty', 'Gusts up to ~' + g + ' mph');
  if (code >= 95) add(2, 'Thunderstorm', 'Do not fly');
  else if (precip >= 0.05) add(2, wcode(code), 'Drones are not waterproof');
  else if (precip > 0 || (code >= 51 && code <= 86)) add(1, wcode(code), 'Light precipitation');
  if (t <= LIM.tempNoGoLow) add(2, 'Too cold', t + 'F - battery failure risk');
  else if (t <= LIM.tempCautionLow) add(1, 'Cold battery', t + 'F - warm batteries first');
  if (t >= LIM.tempNoGoHigh) add(2, 'Too hot', t + 'F - overheating risk');
  else if (t >= LIM.tempCautionHigh) add(1, 'Hot', t + 'F - watch motor/battery temp');
  if (vis < LIM.visNoGo) add(2, 'Low visibility', vis.toFixed(1) + ' mi - need 3 mi (VLOS)');
  else if (vis < LIM.visCaution) add(1, 'Reduced visibility', vis.toFixed(1) + ' mi - need 3 mi');
  if (code === 45 || code === 48) add(1, 'Fog', 'Keep your drone in sight');
  if (kp >= LIM.kpNoGo) add(2, 'Geomagnetic storm', 'Kp ' + kp.toFixed(0) + ' - GPS unreliable');
  else if (kp >= LIM.kpCaution) add(1, 'Geomagnetic activity', 'Kp ' + kp.toFixed(0) + ' - GPS may drift');
  if (now < rise - 30 || now > set + 30) add(1, 'Night flight', 'Anti-collision light required');
  else if (now < rise || now > set) add(0, 'Twilight', 'Anti-collision light required');

  // airspace -> zones lines
  var zones = air.zones.slice().sort(function (a, b) {
    if (a.info.inside !== b.info.inside) return a.info.inside ? -1 : 1;
    return a.info.dist - b.info.dist;
  });
  var zlines = [], zseen = {};
  var ceilTxt = '';
  var inCtrl = false;
  zones.forEach(function (z) {
    var i = z.info, sev = 0, loc = i.inside ? 'inside' : fmtDist(i.dist) + ' ' + i.dir;
    if (z.kind === 'tfr' || z.kind === 'sua' || z.kind === 'dod') sev = i.inside ? 2 : (i.dist < 1 ? 1 : 0);
    else if (z.kind === 'std') sev = i.inside ? 1 : 0;
    else if (z.kind === 'cls' && i.inside) {
      inCtrl = true;
      if (air.ceil === 0) sev = 2; else if (air.ceil > 0 && air.ceil < MAX_ALT_FT) sev = 1; else if (air.ceil < 0) sev = 1; else sev = 0;
    }
    z.sev = sev;
    var zk = z.label + z.name + loc;
    if (zlines.length < 5 && !zseen[zk]) { zseen[zk] = 1; zlines.push('' + sev + trunc(z.label, 11) + ' ' + loc + '\t' + trunc(z.name, 30)); }
  });
  // dedupe / drop class zones that duplicate nothing special; add alerts from zones
  zones.forEach(function (z) {
    if (z.sev > 0) {
      var det = z.name + (z.info.inside ? ' (inside)' : ', ' + fmtDist(z.info.dist) + ' ' + z.info.dir);
      var txt = z.kind === 'tfr' ? 'Flight restriction' : z.kind === 'cls' ? 'Controlled airspace' : z.kind === 'sua' ? z.label + ' area' : z.kind === 'dod' ? 'Military restriction' : 'Stadium zone';
      add(z.sev, txt, det);
    }
  });
  if (air.ceil >= 0) {
    if (air.ceil === 0) add(2, 'No-fly grid', 'FAA grid ceiling 0 ft - need authorization');
    else if (air.ceil < MAX_ALT_FT) add(1, 'Altitude ceiling', 'Max ' + air.ceil + ' ft AGL without approval');
  } else if (inCtrl) {
    add(1, 'Authorization needed', 'Controlled airspace - use LAANC');
  }
  if (!air.ok) add(1, 'Airspace data incomplete', 'Missing: ' + (air.missing || []).join(', '));
  var seen = {};
  alerts = alerts.filter(function (a) { var k = a.text + a.detail; if (seen[k]) return false; seen[k] = 1; return true; });
  alerts.sort(function (a, b) { return b.sev - a.sev; });

  var verdict = 0;
  alerts.forEach(function (a) { if (a.sev > verdict) verdict = a.sev; });
  var reason = verdict === 0 ? 'Conditions look good' : alerts[0].text;
  if (verdict > 0 && alerts[0].detail) reason = alerts[0].text;

  // 6-hour window
  var hw = [], hv = [];
  for (var k = 0; k < 6; k++) {
    var ix = Math.min(hi + k, h.time.length - 1);
    var ww = h.wind_speed_120m[ix], gg = gust120(ww, h.wind_speed_10m[ix], h.wind_gusts_10m[ix]);
    hw.push(Math.min(255, Math.round(ww)));
    hv.push(hourVerdict(ww, gg, h.precipitation[ix], h.weather_code[ix]));
  }
  return {
    verdict: verdict, reason: reason, alerts: alerts, zlines: zlines, hw: hw, hv: hv,
    vals: {
      W10: Math.round(w10), W80: Math.round(c.wind_speed_80m), W120: Math.round(w120), W180: Math.round(c.wind_speed_180m),
      GUST: g, WDIR: c.wind_direction_10m, TEMP: t, PRECIP: Math.round(precip * 100), COND: wcode(code),
      VIS: Math.round(vis * 10), CLOUD: c.cloud_cover, KP: Math.round(kp * 10),
      SUNRISE: rise, SUNSET: set, NOWMIN: now, CEIL: air.ceil < 0 ? MAX_ALT_FT : Math.min(air.ceil, MAX_ALT_FT),
      HSTART: Math.floor(now / 60)
    }
  };
}

/* ---------- main flow ---------- */
function run() {
  if (running) return;
  running = true;
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
      try { r = assess(weather, kp === null || isNaN(kp) ? 0 : kp, air || { zones: [], ceil: -1, ok: false }); }
      catch (e) { status('Error: ' + e.message); return; }
      var v = r.vals;
      enqueue({ VERDICT: r.verdict, REASON: r.reason, W10: v.W10, W80: v.W80, W120: v.W120, W180: v.W180,
        GUST: v.GUST, WDIR: v.WDIR, TEMP: v.TEMP });
      enqueue({ PRECIP: v.PRECIP, COND: v.COND, VIS: v.VIS, CLOUD: v.CLOUD, KP: v.KP,
        SUNRISE: v.SUNRISE, SUNSET: v.SUNSET, NOWMIN: v.NOWMIN, CEIL: v.CEIL });
      enqueue({ HSTART: v.HSTART, HW: r.hw, HV: r.hv });
      enqueue({ ZONES: r.zlines.length ? r.zlines.join('\n') : '0No restricted zones within ' + SEARCH_MI + ' mi' });
      var al = r.alerts.slice(0, 6).map(function (a) { return '' + a.sev + a.text + '\t' + trunc(a.detail, 34); });
      enqueue({ ALERTS: al.length ? al.join('\n') : '0All clear\tNo warnings' });
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
