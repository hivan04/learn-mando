# Hanzi

An offline Mandarin study app. Two decks: my own Week 1–6 notes, and the full
HSK 1–6 word and character lists. Runs as a web app you add to your iPhone home
screen — no App Store, no developer account, no 7-day expiry, nothing to pay.

---

## What's in it

| | |
|---|---|
| **My notes** | 434 vocab · 255 sentences · 32 grammar points, audited from the Week 1–6 markdown |
| **HSK** | 5,003 words across levels 1–6, plus 2,634 characters with pinyin, meaning and stroke count |
| **Stroke order** | Animated, with the radical picked out in vermilion, for every character |
| **Review** | Spaced repetition (Again / Hard / Good / Easy), three directions |
| **Test** | Multiple-choice listening and reading, drawing from every deck at once |
| **Cantonese** | Jyutping on every word, revealed with a button (Settings can make it always visible). Tests are Mandarin-only; Cantonese audio is on demand |
| **Audio** | Built-in iOS Chinese text-to-speech — works offline |
| **Progress** | Streak, 7-day activity, per-level coverage, hardest cards |
| **Widget** | Optional home-screen widget via Scriptable (free) |

Everything is stored on the device in `localStorage`. Nothing is uploaded anywhere.

---

## 1 · Put it online (once)

The app needs a URL so iOS can install it to your home screen. GitHub Pages is
free and permanent.

```bash
cd ~/Documents/GitHub/hanzi-replica
git add -A
git commit -m "Hanzi study app"

# create the repo on github.com first (name it hanzi-replica, public),
# then point this folder at it:
git remote add origin https://github.com/YOUR-USERNAME/hanzi-replica.git
git branch -M main
git push -u origin main
```

Then on github.com: **Settings → Pages → Source: Deploy from a branch →
Branch: `main` / `(root)` → Save.**

After a minute or two the app is live at:

```
https://YOUR-USERNAME.github.io/hanzi-replica/
```

> The repo must be **public** for GitHub Pages to work on a free account.

## 2 · Install it on your iPhone

1. Open that URL **in Safari** (it has to be Safari, not Chrome).
2. Tap the **Share** button (square with the up arrow).
3. Scroll down, tap **Add to Home Screen**, then **Add**.

It now behaves like a normal app: its own icon, full screen, no address bar.
Open it once with a connection so it can cache itself — after that it works
in aeroplane mode, and it never expires.

## 3 · The home-screen widget (optional)

iOS only allows native code to draw home-screen widgets, so a web app can't do
it directly. The free workaround is **Scriptable**, which is allowed to run
JavaScript inside a real widget.

1. Install **Scriptable** from the App Store — free, no account.
2. Open it, tap **+**, and paste in everything from `widget/hanzi-widget.js`.
3. Change the first line to your Pages URL:
   ```js
   const BASE_URL = "https://YOUR-USERNAME.github.io/hanzi-replica";
   ```
4. Tap the script title at the top and rename it to **Hanzi**.
5. Long-press your home screen → **+** → **Scriptable** → pick a size → **Add Widget**.
6. Tap the new widget → **Script: Hanzi** → **Done**.

It shows the same rotating word as the app, in the same colours, and caches the
list on the device so it keeps working with no signal. Tapping it opens the app.

To change how often it rotates, set `ROTATE_HOURS` in the widget to match
**Settings → Rotate every** in the app.

---

## Updating the word lists

The app reads three data files:

```
data/notes.json      my Week 1–6 vocab, sentences and grammar
data/hsk.json        HSK words + characters
data/strokes-*.json  stroke paths (split into 4 so the first load isn't one big file)
```

Edit `data/notes.json` to add or fix your own vocabulary, then
`git commit && git push`. The app picks up changes the next time you open it
online. Bump the `V` constant at the top of `sw.js` to force the cache to refresh.

## Sources

- **My notes** — `digital-notebook/notebook/Mandarin`, Weeks 1–6, audited (see `data/AUDIT.md`)
- **HSK lists** — `hsk-words` (HSK 2.0, levels 1–6)
- **Definitions** — CC-CEDICT, CC-BY-SA 4.0
- **Stroke data** — Make Me a Hanzi / `hanzi-writer-data`, derived from Arphic PL fonts (Arphic Public License)
- **Jyutping** — `to-jyutping` (CanCLID), applied to the traditional form of each word

### A note on the Jyutping

These are the **Cantonese readings of the Mandarin characters**, generated per word — not
translations into spoken Cantonese. 什么 gives `sam6 mo1`, the literal reading; a Cantonese
speaker would actually say 乜嘢 `mat1 je5`. For single characters and shared vocabulary the
reading is exactly the bridge you want. For whole sentences, treat it as a pronunciation
guide to the written form rather than natural Cantonese.
