#include <pebble.h>

// Should I Fly? - drone flight conditions for Pebble (US only)
// All data fetching, unit conversion and logic lives in src/pkjs/index.js.
// This file only displays what the phone sends, plus vibration and sound alerts.

#define NUM_PAGES 6
#define PAGE_VERDICT 0
#define PAGE_WIND 1
#define PAGE_COND 2
#define PAGE_AIR 3
#define PAGE_ALERTS 4
#define PAGE_HOURS 5

#define BG_COLOR GColorBlack
#define COL_GO GColorGreen
#define COL_CAUTION GColorYellow
#define COL_NOGO GColorRed
#define COL_DIM GColorLightGray

static Window *s_window;
static Layer *s_canvas;

static int s_page = 0;

// Data from the phone
static char s_status[48];
static int s_verdict = -1;   // -1 = no data yet, 0 go, 1 caution, 2 no-go
static char s_reason[48];
static uint8_t s_wind[5];    // wind per row, top altitude first (display units)
static char s_wlbl[56] = "400 ft|300 ft|200 ft|100 ft|0 ft";
static char s_wunit[8] = "mph";
static int s_wmax = 30, s_wcaut = 15, s_wnogo = 24;
static int s_gust, s_wdir;
static char s_stat[48];
static char s_sevs[8] = "00000";   // severity per item: temp, rain, visibility, kp, gust
static char s_temptxt[12], s_preciptxt[16], s_vistxt[16], s_kptxt[12], s_cond[24];
static int s_sunrise, s_sunset;
static char s_ceiltxt[20], s_ceilsub[32], s_hlbl[12];
static int s_ceilsev;
static char s_zones[384];
static char s_alerts[384];
static int s_hstart;
static uint8_t s_hw[6], s_hv[6];
static bool s_have_hours = false;

// Alert settings (sent by the phone with every verdict)
static bool s_sound = false;
static bool s_vibe = true;
static int s_volume = 60;

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
static GPoint s_touch_start;
#endif

/* ----------------------------------------------------------------- sounds */
// GO: bright rising chime. CAUTION: two descending soft tones. NO-GO: low square-wave buzzer.
#if PBL_API_EXISTS(speaker_play_notes)
static const SpeakerNote SND_GO[] = {
  {72, SpeakerWaveformSine, 110, 0, 0},
  {76, SpeakerWaveformSine, 110, 0, 0},
  {79, SpeakerWaveformSine, 110, 0, 0},
  {84, SpeakerWaveformSine, 420, 0, 0},
};
static const SpeakerNote SND_CAUTION[] = {
  {76, SpeakerWaveformTriangle, 220, 0, 0},
  {0, SpeakerWaveformTriangle, 50, 0, 0},
  {69, SpeakerWaveformTriangle, 420, 0, 0},
};
static const SpeakerNote SND_NOGO[] = {
  {57, SpeakerWaveformSquare, 230, 0, 0},
  {0, SpeakerWaveformSquare, 90, 0, 0},
  {57, SpeakerWaveformSquare, 230, 0, 0},
  {0, SpeakerWaveformSquare, 90, 0, 0},
  {57, SpeakerWaveformSquare, 500, 0, 0},
};
#endif

static void play_alert(int verdict) {
  if (s_vibe) {
    if (verdict == 1) vibes_short_pulse();
    else if (verdict >= 2) vibes_double_pulse();
  }
#if PBL_API_EXISTS(speaker_play_notes)
  if (!s_sound || speaker_is_muted()) return;
  if (verdict == 0) speaker_play_notes(SND_GO, ARRAY_LENGTH(SND_GO), s_volume);
  else if (verdict == 1) speaker_play_notes(SND_CAUTION, ARRAY_LENGTH(SND_CAUTION), s_volume);
  else speaker_play_notes(SND_NOGO, ARRAY_LENGTH(SND_NOGO), s_volume);
#endif
}

/* ---------------------------------------------------------------- helpers */

static GColor sev_color(int sev) {
  return sev >= 2 ? COL_NOGO : (sev == 1 ? COL_CAUTION : COL_GO);
}

static GColor wind_color(int v) {
  return v >= s_wnogo ? COL_NOGO : (v >= s_wcaut ? COL_CAUTION : COL_GO);
}

static int sev_at(int i) {
  return (s_sevs[i] >= '0' && s_sevs[i] <= '2') ? s_sevs[i] - '0' : 0;
}

static GColor value_color(int sev) {
  return sev == 0 ? GColorWhite : sev_color(sev);
}

static void draw_text(GContext *ctx, const char *s, const char *font_key, GRect r,
                      GTextAlignment align, GColor color) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, s, fonts_get_system_font(font_key), r,
                     GTextOverflowModeTrailingEllipsis, align, NULL);
}

static void fmt_minutes(int m, char *out, size_t n) {
  int h = (m / 60) % 24, mi = m % 60;
  if (clock_is_24h_style()) {
    snprintf(out, n, "%02d:%02d", h, mi);
  } else {
    int h12 = h % 12;
    if (h12 == 0) h12 = 12;
    snprintf(out, n, "%d:%02d %s", h12, mi, h < 12 ? "AM" : "PM");
  }
}

static const char *compass(int deg) {
  static const char *names[] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
  return names[(((deg % 360) + 360) % 360 + 22) / 45 % 8];
}

// Layout metrics shared by all pages
typedef struct {
  int w, h, pad, top, bottom;
} Metrics;

static Metrics metrics(GRect b) {
  Metrics m;
  m.w = b.size.w;
  m.h = b.size.h;
#ifdef PBL_ROUND
  m.pad = 34;
  m.top = 24;
  m.bottom = 26;
#else
  m.pad = 8;
  m.top = 4;
  m.bottom = 16;
#endif
  return m;
}

static void draw_header(GContext *ctx, Metrics m, const char *title) {
  draw_text(ctx, title, FONT_KEY_GOTHIC_14_BOLD, GRect(0, m.top, m.w, 18), GTextAlignmentCenter, COL_DIM);
}

static void draw_dots(GContext *ctx, Metrics m) {
  int gap = 12;
  int total = (NUM_PAGES - 1) * gap;
  int x0 = m.w / 2 - total / 2;
  int y = m.h - m.bottom + 4;
  for (int i = 0; i < NUM_PAGES; i++) {
    GPoint c = GPoint(x0 + i * gap, y);
    if (i == s_page) {
      graphics_context_set_fill_color(ctx, GColorWhite);
      graphics_fill_circle(ctx, c, 3);
    } else {
      graphics_context_set_fill_color(ctx, GColorDarkGray);
      graphics_fill_circle(ctx, c, 2);
    }
  }
}

static void draw_message(GContext *ctx, Metrics m, const char *msg) {
  draw_text(ctx, msg, FONT_KEY_GOTHIC_24_BOLD,
            GRect(m.pad, m.h / 2 - 40, m.w - 2 * m.pad, 90), GTextAlignmentCenter, GColorWhite);
}

// "<sev><title>\t<detail>\n..." list
static void draw_list(GContext *ctx, Metrics m, const char *text, int y, int max_y) {
  const int row_h = 40;
  const char *p = text;
  int x = m.pad;
  int w = m.w - 2 * m.pad;
  while (*p && y + row_h <= max_y + 4) {
    char line[96];
    int n = 0;
    while (p[n] && p[n] != '\n' && n < (int)sizeof(line) - 1) { line[n] = p[n]; n++; }
    line[n] = 0;
    p += n;
    if (*p == '\n') p++;
    if (n < 2) continue;

    int sev = line[0] - '0';
    char *title = line + 1;
    char *detail = "";
    char *tab = strchr(line, '\t');
    if (tab) { *tab = 0; detail = tab + 1; }

    graphics_context_set_fill_color(ctx, sev_color(sev));
    graphics_fill_circle(ctx, GPoint(x + 5, y + 12), 5);
    draw_text(ctx, title, FONT_KEY_GOTHIC_18_BOLD, GRect(x + 16, y - 3, w - 16, 22), GTextAlignmentLeft, GColorWhite);
    if (detail[0]) {
      draw_text(ctx, detail, FONT_KEY_GOTHIC_14, GRect(x + 16, y + 18, w - 16, 18), GTextAlignmentLeft, COL_DIM);
    }
    y += row_h;
  }
}

/* ------------------------------------------------------------------ pages */

static void page_verdict(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "SHOULD I FLY?");
  if (s_verdict < 0) {
    draw_message(ctx, m, s_status[0] ? s_status : "Loading...");
    return;
  }
  const char *word = s_verdict == 0 ? "GO" : (s_verdict == 1 ? "CAUTION" : "NO-GO");
  GColor c = sev_color(s_verdict);
  int bx = m.pad, bw = m.w - 2 * m.pad;
  int by = m.top + 26;
  graphics_context_set_fill_color(ctx, c);
  graphics_fill_rect(ctx, GRect(bx, by, bw, 62), 10, GCornersAll);
  draw_text(ctx, word, FONT_KEY_BITHAM_30_BLACK, GRect(bx, by + 12, bw, 40), GTextAlignmentCenter, GColorBlack);

  draw_text(ctx, s_reason, FONT_KEY_GOTHIC_24_BOLD, GRect(m.pad, by + 70, bw, 58), GTextAlignmentCenter, GColorWhite);

  int y = m.h - m.bottom - 46;
  draw_text(ctx, s_stat, FONT_KEY_GOTHIC_18, GRect(m.pad, y, bw, 22), GTextAlignmentCenter, GColorWhite);
  if (s_status[0]) {
    draw_text(ctx, s_status, FONT_KEY_GOTHIC_14, GRect(m.pad, y + 22, bw, 18), GTextAlignmentCenter, COL_CAUTION);
  } else {
    draw_text(ctx, "tap or SELECT = refresh", FONT_KEY_GOTHIC_14, GRect(m.pad, y + 22, bw, 18), GTextAlignmentCenter, COL_DIM);
  }
}

static void page_wind(GContext *ctx, Metrics m) {
  char title[24];
  snprintf(title, sizeof(title), "WIND (%s)", s_wunit);
  draw_header(ctx, m, title);
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }

  // split "400 ft|300 ft|..." into 5 labels
  char lbl[5][12];
  memset(lbl, 0, sizeof(lbl));
  {
    int row = 0, k = 0;
    for (const char *p = s_wlbl; *p && row < 5; p++) {
      if (*p == '|') { row++; k = 0; }
      else if (k < 11) lbl[row][k++] = *p;
    }
  }

  int label_w = 58;
  int bar_x = m.pad + label_w;
  int bar_max_w = m.w - m.pad - bar_x - 34;
  int y = m.top + 22;
  const int row_h = 25;
  for (int i = 0; i < 5; i++) {
    bool key = (i == 0);
    draw_text(ctx, lbl[i], key ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_18,
              GRect(m.pad, y, label_w, 22), GTextAlignmentLeft, key ? GColorWhite : COL_DIM);
    int bw = s_wmax > 0 ? s_wind[i] * bar_max_w / s_wmax : 2;
    if (bw > bar_max_w) bw = bar_max_w;
    if (bw < 2) bw = 2;
    graphics_context_set_fill_color(ctx, wind_color(s_wind[i]));
    graphics_fill_rect(ctx, GRect(bar_x, y + 4, bw, 13), 3, GCornersAll);
    char b[8];
    snprintf(b, sizeof(b), "%d", s_wind[i]);
    draw_text(ctx, b, FONT_KEY_GOTHIC_18_BOLD, GRect(bar_x + bw + 3, y, 34, 22), GTextAlignmentLeft, GColorWhite);
    y += row_h;
  }
  char buf[48];
  y += 4;
  snprintf(buf, sizeof(buf), "Wind from the %s", compass(s_wdir));
  draw_text(ctx, buf, FONT_KEY_GOTHIC_18, GRect(m.pad, y, m.w - 2 * m.pad, 22), GTextAlignmentCenter, GColorWhite);
  snprintf(buf, sizeof(buf), "Gusts up to ~%d %s", s_gust, s_wunit);
  draw_text(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad, y + 24, m.w - 2 * m.pad, 22), GTextAlignmentCenter, sev_color(sev_at(4)));
}

static void row(GContext *ctx, Metrics m, int y, const char *label, const char *value, GColor vc) {
  int w = m.w - 2 * m.pad;
  draw_text(ctx, label, FONT_KEY_GOTHIC_18, GRect(m.pad, y, w, 22), GTextAlignmentLeft, COL_DIM);
  draw_text(ctx, value, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad + 70, y, w - 70, 22), GTextAlignmentRight, vc);
}

static void page_cond(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "CONDITIONS");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }
  char b[24];
  int y = m.top + 22;
  const int rh = 25;

  row(ctx, m, y, "Temp", s_temptxt, value_color(sev_at(0))); y += rh;
  row(ctx, m, y, "Sky", s_cond, GColorWhite); y += rh;
  row(ctx, m, y, "Rain", s_preciptxt, value_color(sev_at(1))); y += rh;
  row(ctx, m, y, "Visibility", s_vistxt, value_color(sev_at(2))); y += rh;
  row(ctx, m, y, "GPS storm", s_kptxt, value_color(sev_at(3))); y += rh;
  fmt_minutes(s_sunrise, b, sizeof(b));
  row(ctx, m, y, "Sunrise", b, GColorWhite); y += rh;
  fmt_minutes(s_sunset, b, sizeof(b));
  row(ctx, m, y, "Sunset", b, GColorWhite);
}

static void page_air(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "AIRSPACE");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }
  int bw = m.w - 2 * m.pad;
  int y = m.top + 22;
  draw_text(ctx, s_ceiltxt, FONT_KEY_GOTHIC_28_BOLD, GRect(m.pad, y - 4, bw, 34), GTextAlignmentCenter, sev_color(s_ceilsev));
  draw_text(ctx, s_ceilsub, FONT_KEY_GOTHIC_14, GRect(m.pad, y + 28, bw, 18), GTextAlignmentCenter, COL_DIM);
  draw_list(ctx, m, s_zones, y + 52, m.h - m.bottom - 10);
}

static void page_alerts(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "WARNINGS");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }
  draw_list(ctx, m, s_alerts, m.top + 28, m.h - m.bottom - 8);
}

static void page_hours(GContext *ctx, Metrics m) {
  char title[32];
  snprintf(title, sizeof(title), "NEXT 6 HOURS @ %s", s_hlbl);
  draw_header(ctx, m, title);
  if (!s_have_hours) { draw_message(ctx, m, "No data yet"); return; }
  int area_w = m.w - 2 * m.pad;
  int col_w = area_w / 6;
  int base_y = m.h - m.bottom - 56;
  int max_h = base_y - (m.top + 50);
  int best = -1;
  for (int i = 0; i < 6; i++) { if (s_hv[i] == 0) { best = i; break; } }
  char b[40];
  if (best < 0) snprintf(b, sizeof(b), "No good weather soon");
  else if (best == 0) snprintf(b, sizeof(b), "Weather OK now");
  else {
    int hr = (s_hstart + best) % 24;
    int h12 = hr % 12; if (h12 == 0) h12 = 12;
    if (clock_is_24h_style()) snprintf(b, sizeof(b), "Weather OK from %02d:00", hr);
    else snprintf(b, sizeof(b), "Weather OK from %d %s", h12, hr < 12 ? "AM" : "PM");
  }
  draw_text(ctx, b, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad, m.top + 20, area_w, 22), GTextAlignmentCenter,
            best < 0 ? COL_NOGO : (best == 0 ? COL_GO : COL_CAUTION));

  for (int i = 0; i < 6; i++) {
    int x = m.pad + i * col_w;
    int hgt = s_wmax > 0 ? s_hw[i] * max_h / s_wmax : 3;
    if (hgt > max_h) hgt = max_h;
    if (hgt < 3) hgt = 3;
    graphics_context_set_fill_color(ctx, sev_color(s_hv[i]));
    graphics_fill_rect(ctx, GRect(x + 4, base_y - hgt, col_w - 8, hgt), 3, GCornersAll);
    char v[6];
    snprintf(v, sizeof(v), "%d", s_hw[i]);
    draw_text(ctx, v, FONT_KEY_GOTHIC_14_BOLD, GRect(x, base_y - hgt - 18, col_w, 18), GTextAlignmentCenter, GColorWhite);
    int hr = (s_hstart + i) % 24;
    char t[6];
    if (clock_is_24h_style()) snprintf(t, sizeof(t), "%02d", hr);
    else { int h12 = hr % 12; if (h12 == 0) h12 = 12; snprintf(t, sizeof(t), "%d%c", h12, hr < 12 ? 'a' : 'p'); }
    draw_text(ctx, t, FONT_KEY_GOTHIC_14, GRect(x, base_y + 2, col_w, 18), GTextAlignmentCenter, COL_DIM);
  }
  snprintf(b, sizeof(b), "bar = wind %s", s_wunit);
  draw_text(ctx, b, FONT_KEY_GOTHIC_14, GRect(m.pad, base_y + 22, area_w, 18), GTextAlignmentCenter, COL_DIM);
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  Metrics m = metrics(b);
  graphics_context_set_fill_color(ctx, BG_COLOR);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  switch (s_page) {
    case PAGE_VERDICT: page_verdict(ctx, m); break;
    case PAGE_WIND: page_wind(ctx, m); break;
    case PAGE_COND: page_cond(ctx, m); break;
    case PAGE_AIR: page_air(ctx, m); break;
    case PAGE_ALERTS: page_alerts(ctx, m); break;
    case PAGE_HOURS: page_hours(ctx, m); break;
  }
  draw_dots(ctx, m);
}

/* ------------------------------------------------------------------ input */

static void change_page(int delta) {
  s_page = (s_page + delta + NUM_PAGES) % NUM_PAGES;
  layer_mark_dirty(s_canvas);
}

static void request_refresh(void) {
  snprintf(s_status, sizeof(s_status), "Refreshing...");
  layer_mark_dirty(s_canvas);
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) == APP_MSG_OK) {
    dict_write_uint8(iter, MESSAGE_KEY_REQUEST, 1);
    app_message_outbox_send();
  }
}

static void up_handler(ClickRecognizerRef r, void *c) { change_page(-1); }
static void down_handler(ClickRecognizerRef r, void *c) { change_page(1); }
static void select_handler(ClickRecognizerRef r, void *c) { request_refresh(); }

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_handler);
}

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
static void touch_handler(const TouchEvent *event, void *context) {
  if (event->type == TouchEvent_Touchdown) {
    s_touch_start = GPoint(event->x, event->y);
  } else if (event->type == TouchEvent_Liftoff) {
    int dx = event->x - s_touch_start.x;
    int dy = event->y - s_touch_start.y;
    int adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
    if (adx > 40 && adx >= ady) change_page(dx < 0 ? 1 : -1);
    else if (ady > 40) change_page(dy < 0 ? 1 : -1);
    else if (adx < 15 && ady < 15) request_refresh();  // tap
  }
}
#endif

/* --------------------------------------------------------------- messages */

static void copy_str(char *dst, size_t n, Tuple *t) {
  if (t && t->type == TUPLE_CSTRING) {
    strncpy(dst, t->value->cstring, n - 1);
    dst[n - 1] = 0;
  }
}

#define GET_INT(KEY, VAR) do { Tuple *_t = dict_find(it, MESSAGE_KEY_##KEY); if (_t) VAR = (int)_t->value->int32; } while (0)

static void inbox_received(DictionaryIterator *it, void *context) {
  Tuple *t;
  copy_str(s_status, sizeof(s_status), dict_find(it, MESSAGE_KEY_STATUS));

  // Alert settings come first so the verdict below uses them
  if ((t = dict_find(it, MESSAGE_KEY_SOUND))) s_sound = t->value->int32 != 0;
  if ((t = dict_find(it, MESSAGE_KEY_VIBE))) s_vibe = t->value->int32 != 0;
  GET_INT(VOLUME, s_volume);

  copy_str(s_reason, sizeof(s_reason), dict_find(it, MESSAGE_KEY_REASON));
  if ((t = dict_find(it, MESSAGE_KEY_WIND)) && t->length >= 5) memcpy(s_wind, t->value->data, 5);
  copy_str(s_wlbl, sizeof(s_wlbl), dict_find(it, MESSAGE_KEY_WLBL));
  copy_str(s_wunit, sizeof(s_wunit), dict_find(it, MESSAGE_KEY_WUNIT));
  GET_INT(WMAX, s_wmax);
  GET_INT(WCAUT, s_wcaut);
  GET_INT(WNOGO, s_wnogo);
  GET_INT(GUST, s_gust);
  GET_INT(WDIR, s_wdir);
  copy_str(s_stat, sizeof(s_stat), dict_find(it, MESSAGE_KEY_STAT));
  copy_str(s_sevs, sizeof(s_sevs), dict_find(it, MESSAGE_KEY_SEVS));

  copy_str(s_temptxt, sizeof(s_temptxt), dict_find(it, MESSAGE_KEY_TEMPTXT));
  copy_str(s_preciptxt, sizeof(s_preciptxt), dict_find(it, MESSAGE_KEY_PRECIPTXT));
  copy_str(s_vistxt, sizeof(s_vistxt), dict_find(it, MESSAGE_KEY_VISTXT));
  copy_str(s_kptxt, sizeof(s_kptxt), dict_find(it, MESSAGE_KEY_KPTXT));
  copy_str(s_cond, sizeof(s_cond), dict_find(it, MESSAGE_KEY_COND));
  GET_INT(SUNRISE, s_sunrise);
  GET_INT(SUNSET, s_sunset);
  copy_str(s_ceiltxt, sizeof(s_ceiltxt), dict_find(it, MESSAGE_KEY_CEILTXT));
  copy_str(s_ceilsub, sizeof(s_ceilsub), dict_find(it, MESSAGE_KEY_CEILSUB));
  GET_INT(CEILSEV, s_ceilsev);
  copy_str(s_hlbl, sizeof(s_hlbl), dict_find(it, MESSAGE_KEY_HLBL));
  GET_INT(HSTART, s_hstart);
  if ((t = dict_find(it, MESSAGE_KEY_HW)) && t->length >= 6) { memcpy(s_hw, t->value->data, 6); s_have_hours = true; }
  if ((t = dict_find(it, MESSAGE_KEY_HV)) && t->length >= 6) memcpy(s_hv, t->value->data, 6);
  copy_str(s_zones, sizeof(s_zones), dict_find(it, MESSAGE_KEY_ZONES));
  copy_str(s_alerts, sizeof(s_alerts), dict_find(it, MESSAGE_KEY_ALERTS));

  if ((t = dict_find(it, MESSAGE_KEY_VERDICT))) {
    s_verdict = (int)t->value->int32;
    s_status[0] = 0;
    play_alert(s_verdict);
  }
  if (s_canvas) layer_mark_dirty(s_canvas);
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", (int)reason);
}

/* ----------------------------------------------------------------- window */

static void window_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  s_canvas = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
  touch_service_subscribe(touch_handler, NULL);
#endif
}

static void window_unload(Window *w) {
#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
  touch_service_unsubscribe();
#endif
  layer_destroy(s_canvas);
  s_canvas = NULL;
}

static void init(void) {
  snprintf(s_status, sizeof(s_status), "Starting...");
  s_window = window_create();
  window_set_background_color(s_window, BG_COLOR);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});

  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_open(512, 64);

  window_stack_push(s_window, true);
}

static void deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
