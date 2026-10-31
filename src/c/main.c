#include <pebble.h>

// Should I Fly? - drone flight conditions for Pebble (US only)
// All data fetching/logic lives in src/pkjs/index.js; this file only displays it.

#define NUM_PAGES 6
#define PAGE_VERDICT 0
#define PAGE_WIND 1
#define PAGE_COND 2
#define PAGE_AIR 3
#define PAGE_ALERTS 4
#define PAGE_HOURS 5

#define BG_COLOR GColorOxfordBlue
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
static int s_w10, s_w80, s_w120, s_w180, s_gust, s_wdir, s_temp;
static int s_precip, s_vis, s_cloud, s_kp, s_sunrise, s_sunset, s_nowmin, s_ceil = 400;
static char s_cond[24];
static char s_zones[384];
static char s_alerts[384];
static int s_hstart;
static uint8_t s_hw[6], s_hv[6];
static bool s_have_hours = false;

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)
static GPoint s_touch_start;
#endif

/* ---------------------------------------------------------------- helpers */

static GColor sev_color(int sev) {
  return sev >= 2 ? COL_NOGO : (sev == 1 ? COL_CAUTION : COL_GO);
}

static GColor wind_color(int mph) {
  return mph >= 24 ? COL_NOGO : (mph >= 15 ? COL_CAUTION : COL_GO);
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

// "<sev><title>\t<detail>\n..." list. Returns rows drawn.
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
  draw_text(ctx, word, FONT_KEY_BITHAM_30_BLACK, GRect(bx, by + 8, bw, 40), GTextAlignmentCenter, GColorBlack);

  draw_text(ctx, s_reason, FONT_KEY_GOTHIC_24_BOLD, GRect(m.pad, by + 70, bw, 58), GTextAlignmentCenter, GColorWhite);

  char buf[48];
  int y = m.h - m.bottom - 46;
  snprintf(buf, sizeof(buf), "%d mph @ 400 ft  |  %dF", s_w120, s_temp);
  draw_text(ctx, buf, FONT_KEY_GOTHIC_18, GRect(m.pad, y, bw, 22), GTextAlignmentCenter, GColorWhite);
  if (s_status[0]) {
    draw_text(ctx, s_status, FONT_KEY_GOTHIC_14, GRect(m.pad, y + 22, bw, 18), GTextAlignmentCenter, COL_CAUTION);
  } else {
    draw_text(ctx, "SELECT = refresh", FONT_KEY_GOTHIC_14, GRect(m.pad, y + 22, bw, 18), GTextAlignmentCenter, COL_DIM);
  }
}

static void page_wind(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "WIND (MPH)");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }

  static const char *labels[] = {"590 ft", "400 ft", "260 ft", "33 ft"};
  int vals[4] = {s_w180, s_w120, s_w80, s_w10};
  int bar_x = m.pad + 52;
  int bar_max_w = m.w - m.pad - bar_x - 34;
  int y = m.top + 28;
  const int row_h = 30;
  for (int i = 0; i < 4; i++) {
    bool key = (i == 1);
    draw_text(ctx, labels[i], key ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_18,
              GRect(m.pad, y, 56, 22), GTextAlignmentLeft, key ? GColorWhite : COL_DIM);
    int bw = vals[i] * bar_max_w / 30;
    if (bw > bar_max_w) bw = bar_max_w;
    if (bw < 2) bw = 2;
    graphics_context_set_fill_color(ctx, wind_color(vals[i]));
    graphics_fill_rect(ctx, GRect(bar_x, y + 4, bw, 14), 3, GCornersAll);
    char b[8];
    snprintf(b, sizeof(b), "%d", vals[i]);
    draw_text(ctx, b, FONT_KEY_GOTHIC_18_BOLD, GRect(bar_x + bw + 3, y, 34, 22), GTextAlignmentLeft, GColorWhite);
    y += row_h;
  }
  // direction + gusts
  char buf[48];
  y += 6;
  snprintf(buf, sizeof(buf), "Wind from the %s", compass(s_wdir));
  draw_text(ctx, buf, FONT_KEY_GOTHIC_18, GRect(m.pad, y, m.w - 2 * m.pad, 22), GTextAlignmentCenter, GColorWhite);
  snprintf(buf, sizeof(buf), "Gusts up to ~%d mph", s_gust);
  draw_text(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad, y + 24, m.w - 2 * m.pad, 22), GTextAlignmentCenter, wind_color(s_gust - 4));
}

static void row(GContext *ctx, Metrics m, int y, const char *label, const char *value, GColor vc) {
  int w = m.w - 2 * m.pad;
  draw_text(ctx, label, FONT_KEY_GOTHIC_18, GRect(m.pad, y, w, 22), GTextAlignmentLeft, COL_DIM);
  draw_text(ctx, value, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad + 70, y, w - 70, 22), GTextAlignmentRight, vc);
}

static void page_cond(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "CONDITIONS");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }
  char b[40];
  int y = m.top + 22;
  const int rh = 25;

  snprintf(b, sizeof(b), "%dF", s_temp);
  row(ctx, m, y, "Temp", b, s_temp <= 40 || s_temp >= 95 ? COL_CAUTION : GColorWhite); y += rh;

  snprintf(b, sizeof(b), "%s", s_cond);
  row(ctx, m, y, "Sky", b, GColorWhite); y += rh;

  snprintf(b, sizeof(b), "%d.%02d in", s_precip / 100, s_precip % 100);
  row(ctx, m, y, "Rain", b, s_precip > 0 ? COL_CAUTION : GColorWhite); y += rh;

  if (s_vis >= 100) snprintf(b, sizeof(b), "%d mi", s_vis / 10);
  else snprintf(b, sizeof(b), "%d.%d mi", s_vis / 10, s_vis % 10);
  row(ctx, m, y, "Visibility", b, s_vis < 30 ? COL_CAUTION : GColorWhite); y += rh;

  snprintf(b, sizeof(b), "Kp %d.%d", s_kp / 10, s_kp % 10);
  row(ctx, m, y, "GPS storm", b, s_kp >= 50 ? COL_CAUTION : GColorWhite); y += rh;

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

  GColor c = s_ceil == 0 ? COL_NOGO : (s_ceil < 400 ? COL_CAUTION : COL_GO);
  char b[32];
  if (s_ceil == 0) snprintf(b, sizeof(b), "NO FLY");
  else snprintf(b, sizeof(b), "Max %d ft", s_ceil);
  draw_text(ctx, b, FONT_KEY_GOTHIC_28_BOLD, GRect(m.pad, y - 4, bw, 34), GTextAlignmentCenter, c);
  draw_text(ctx, s_ceil >= 400 ? "legal limit, above ground" : "FAA grid ceiling here",
            FONT_KEY_GOTHIC_14, GRect(m.pad, y + 28, bw, 18), GTextAlignmentCenter, COL_DIM);
  draw_list(ctx, m, s_zones, y + 52, m.h - m.bottom - 10);
}

static void page_alerts(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "WARNINGS");
  if (s_verdict < 0) { draw_message(ctx, m, "No data yet"); return; }
  draw_list(ctx, m, s_alerts, m.top + 28, m.h - m.bottom - 8);
}

static void page_hours(GContext *ctx, Metrics m) {
  draw_header(ctx, m, "NEXT 6 HOURS @ 400 FT");
  if (!s_have_hours) { draw_message(ctx, m, "No data yet"); return; }
  int area_w = m.w - 2 * m.pad;
  int col_w = area_w / 6;
  int base_y = m.h - m.bottom - 56;
  int max_h = base_y - (m.top + 50);
  // best window text
  int best = -1;
  for (int i = 0; i < 6; i++) { if (s_hv[i] == 0) { best = i; break; } }
  char b[40];
  if (best < 0) snprintf(b, sizeof(b), "No good window soon");
  else if (best == 0) snprintf(b, sizeof(b), "Good right now");
  else {
    int hr = (s_hstart + best) % 24;
    int h12 = hr % 12; if (h12 == 0) h12 = 12;
    if (clock_is_24h_style()) snprintf(b, sizeof(b), "Best from %02d:00", hr);
    else snprintf(b, sizeof(b), "Best from %d %s", h12, hr < 12 ? "AM" : "PM");
  }
  draw_text(ctx, b, FONT_KEY_GOTHIC_18_BOLD, GRect(m.pad, m.top + 20, area_w, 22), GTextAlignmentCenter,
            best < 0 ? COL_NOGO : (best == 0 ? COL_GO : COL_CAUTION));

  for (int i = 0; i < 6; i++) {
    int x = m.pad + i * col_w;
    int hgt = s_hw[i] * max_h / 30;
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
  draw_text(ctx, "bar = wind mph", FONT_KEY_GOTHIC_14, GRect(m.pad, base_y + 22, area_w, 18), GTextAlignmentCenter, COL_DIM);
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

static void inbox_received(DictionaryIterator *it, void *context) {
  Tuple *t;
  if ((t = dict_find(it, MESSAGE_KEY_STATUS))) copy_str(s_status, sizeof(s_status), t);
  if ((t = dict_find(it, MESSAGE_KEY_VERDICT))) { s_verdict = (int)t->value->int32; s_status[0] = 0; }
  copy_str(s_reason, sizeof(s_reason), dict_find(it, MESSAGE_KEY_REASON));
  if ((t = dict_find(it, MESSAGE_KEY_W10))) s_w10 = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_W80))) s_w80 = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_W120))) s_w120 = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_W180))) s_w180 = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_GUST))) s_gust = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_WDIR))) s_wdir = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_TEMP))) s_temp = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_PRECIP))) s_precip = (int)t->value->int32;
  copy_str(s_cond, sizeof(s_cond), dict_find(it, MESSAGE_KEY_COND));
  if ((t = dict_find(it, MESSAGE_KEY_VIS))) s_vis = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_CLOUD))) s_cloud = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_KP))) s_kp = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_SUNRISE))) s_sunrise = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_SUNSET))) s_sunset = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_NOWMIN))) s_nowmin = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_CEIL))) s_ceil = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_HSTART))) s_hstart = (int)t->value->int32;
  if ((t = dict_find(it, MESSAGE_KEY_HW)) && t->length >= 6) { memcpy(s_hw, t->value->data, 6); s_have_hours = true; }
  if ((t = dict_find(it, MESSAGE_KEY_HV)) && t->length >= 6) memcpy(s_hv, t->value->data, 6);
  copy_str(s_zones, sizeof(s_zones), dict_find(it, MESSAGE_KEY_ZONES));
  copy_str(s_alerts, sizeof(s_alerts), dict_find(it, MESSAGE_KEY_ALERTS));

  if (s_canvas) layer_mark_dirty(s_canvas);
  if (dict_find(it, MESSAGE_KEY_VERDICT) && s_verdict >= 1) vibes_short_pulse();
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
  strcpy(s_zones, "");
  strcpy(s_alerts, "");
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
