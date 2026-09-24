// ─────────────────────────────────────────────────────────────
// Hanzi — Scriptable home screen widget
//
// SETUP (one time, ~2 minutes, free):
//  1. Install "Scriptable" from the App Store (free).
//  2. Open Scriptable, tap + to make a new script, paste all of this in.
//  3. Name the script  Hanzi  (tap the title at the top).
//  4. Long-press your home screen → + → Scriptable → pick a size →
//     add it → tap the new widget → Script: Hanzi → Done.
//
//  BASE_URL is already set to your repo. It only works once the repo is
//  public and GitHub Pages is switched on.
//
// The widget caches the word list on the device, so after the first
// successful load it keeps rotating with no internet at all.
// ─────────────────────────────────────────────────────────────

const BASE_URL = "https://hivan04.github.io/learn-mando";
const ROTATE_HOURS = 3;     // must match the app's Settings → Rotate every
const DECK = "notes";       // "notes" = your Mandarin notes, "hsk" = HSK words
const HSK_MAX = 2;          // if DECK is "hsk", include levels 1..HSK_MAX

// ── palette (matches the app) ───────────────────────────────
const dark = Device.isUsingDarkAppearance();
const C = dark
  ? { bg:"#14120F", card:"#1E1B17", ink:"#F2ECE0", ink2:"#CFC6B4", ink3:"#948B79",
      t1:"#E2703F", t2:"#D2AE4A", t3:"#93AC7D", t4:"#6FA0B0", t5:"#948B79" }
  : { bg:"#F6F1E6", card:"#FFFCF4", ink:"#1E1B16", ink2:"#4A4439", ink3:"#8A8172",
      t1:"#B04A28", t2:"#C79A2E", t3:"#6F8A52", t4:"#3F6B7A", t5:"#8A8172" };

// ── data (network once, then cached on device) ──────────────
const fm = FileManager.local();
const cacheDir = fm.joinPath(fm.cacheDirectory(), "hanzi-widget");
if (!fm.fileExists(cacheDir)) fm.createDirectory(cacheDir);
const cacheFile = fm.joinPath(cacheDir, DECK + ".json");

async function getItems() {
  try {
    const path = DECK === "hsk" ? "/data/hsk.json" : "/data/notes.json";
    const raw = await new Request(BASE_URL + path).loadJSON();
    const items = DECK === "hsk"
      ? raw.words.filter(w => w.lv <= HSK_MAX).map(w => ({ h:w.h, p:w.p, e:w.e }))
      : raw.vocab.map(v => ({ h:v.h, p:v.p, e:v.e }));
    fm.writeString(cacheFile, JSON.stringify(items));
    return items;
  } catch (e) {
    if (fm.fileExists(cacheFile)) return JSON.parse(fm.readString(cacheFile));
    return [{ h:"没有网络", p:"méiyǒu wǎngluò", e:"Open once with internet to load your words." }];
  }
}

// ── same rotation maths as the app, so they always agree ────
function rotIndex(len, hours) {
  const block = Math.floor(Date.now() / 36e5 / hours);
  let h = (block * 2654435761) % 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  return ((h % len) + len) % len;
}

// ── tone colouring ──────────────────────────────────────────
const TONES = [["āēīōūǖ",1],["áéíóúǘ",2],["ǎěǐǒǔǚ",3],["àèìòùǜ",4]];
function toneOf(syl) {
  for (const [chars, n] of TONES) for (const c of syl) if (chars.includes(c)) return n;
  return 5;
}
function toneColor(syl) { return new Color(C["t" + toneOf(syl)]); }

// ── build ───────────────────────────────────────────────────
const items = await getItems();
const item = items[rotIndex(items.length, ROTATE_HOURS)];
const size = config.widgetFamily || "medium";

const w = new ListWidget();
w.backgroundColor = new Color(C.bg);
w.url = BASE_URL + "/index.html";
w.setPadding(14, 16, 14, 16);

const label = w.addText("字 · " + (DECK === "hsk" ? "HSK " + HSK_MAX : "MY NOTES"));
label.font = Font.mediumSystemFont(9);
label.textColor = new Color(C.ink3);
w.addSpacer(size === "small" ? 6 : 8);

const hanzi = w.addText(item.h);
hanzi.font = Font.mediumSystemFont(size === "small" ? 34 : size === "large" ? 56 : 44);
hanzi.textColor = new Color(C.ink);
hanzi.minimumScaleFactor = 0.5;
hanzi.lineLimit = 1;

w.addSpacer(6);

// pinyin, one coloured chunk per syllable
const py = w.addStack();
py.layoutHorizontally();
const syls = (item.p || "").split(" ").filter(Boolean);
syls.slice(0, 6).forEach((s, i) => {
  const t = py.addText(i ? " " + s : s);
  t.font = Font.mediumSystemFont(size === "small" ? 13 : 17);
  t.textColor = toneColor(s);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
});

w.addSpacer(size === "small" ? 4 : 6);

const en = w.addText(item.e || "");
en.font = Font.systemFont(size === "small" ? 10 : 12);
en.textColor = new Color(C.ink2);
en.lineLimit = size === "small" ? 2 : size === "large" ? 5 : 3;

if (size !== "small") {
  w.addSpacer();
  const next = new Date(Math.ceil(Date.now() / (ROTATE_HOURS * 36e5)) * (ROTATE_HOURS * 36e5));
  const foot = w.addText("next at " + next.toTimeString().slice(0, 5));
  foot.font = Font.systemFont(9);
  foot.textColor = new Color(C.ink3);
}

// tell iOS when to swap in the next word
w.refreshAfterDate = new Date(Math.ceil(Date.now() / (ROTATE_HOURS * 36e5)) * (ROTATE_HOURS * 36e5));

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
