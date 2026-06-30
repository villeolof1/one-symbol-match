Original prompt: PLEASE IMPLEMENT THIS PLAN: Replace Emoji Symbols With Object Images, including optimized 512px runtime assets, image rendering, preload/decode strategy, UI text updates, and performance verification.

## 2026-06-30

- Generated `assets/symbols/512/` from `FinalImages_ModeB_Transparent_Clean/`; 57 PNGs, about 13 MB total.
- Updated `index.html` to use object image metadata, cached image URL/decode helpers, image-based card symbols, object-name labels/status text, and lazy browse thumbnails.
- Added `window.render_game_to_text` and `window.advanceTime(ms)` hooks for Playwright-based game verification.
- Updated `README.md` to describe object artwork and optimized runtime assets.

## TODO

- Completed browser validation with Playwright: deck validation passed, browse/game/mobile screenshots reviewed, gameplay cursor movement verified, wrong-answer cooldown verified, correct-answer scoring/card replacement verified, and console/page errors were clean.
- Performance pass after score-path optimizations: optimized assets are 57 PNGs / 12.99 MB total; page reached browse cards in about 432 ms under headless Chromium; game setup took about 7.5 ms; critical gameplay symbol decode took about 0.1 ms after warmup; steady gameplay had 0 frames over 50 ms; score answer handler returned in about 3 ms; score transition had 0 frames over 50 ms.
- Fixed score-flight regression where the scoring card could snap to the top-right after cleanup. The flying card is now removed after the animation and the middle slot is remounted normally after landing. Verified at 2048x1042 and 1440x1100: middle card remains centered/in viewport, no `.flying-card` leak, deck validation still passes, and `answer()` remains about 3.7 ms.
