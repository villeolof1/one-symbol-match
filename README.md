# One-Symbol Match Arena

A standalone local browser project inspired by one-shared-symbol matching games.

Open `index.html` directly in a modern browser. No server, install, or internet connection is required.

## What it generates

- 57 recognizable object symbols with simple names
- 57 mathematically generated cards
- 8 symbols per card
- Exactly one shared symbol between every pair of cards
- Optional 55-card classic-style deck count
- Randomized symbol position, direction, and size per card, with collision-aware spacing

The project uses original object symbols and original code. It does not use official Dobble / Spot It! artwork or branding.

## Views

### Browse cards

Scroll through all generated cards, reshuffle the visual layout, show/hide symbol names, and validate the deck.

### 2-player game

The game screen is optimized as a near-fullscreen arena:

- The middle/shared card is centered above the player cards and is noticeably larger.
- The left player uses W/A/S/D + Space.
- The right player uses Arrow keys + Enter.
- Each player card has a cleaner real-pile-style stack beneath it, with one visible circular card layer per card behind the active card.
- Near the target score, the score display pulses with a MATCH POINT indicator so it is clearer who is about to win.
- The top HUD is minimal: score, status, restart, and exit.
- Dots move quickly and update with GPU-friendly transforms.
- The card DOM is not rebuilt while the dots move; only dot transforms, highlights, and cooldown bars update.
- Player 2 uses a magenta/purple selection highlight so it is easier to distinguish from Player 1 and the artwork.
- The middle card starts face-down. Press START, then a 3-2-1 countdown flips it into play.
- When a player scores, their card flies visibly to the middle pile. The next player card is pre-rendered behind it, so the replacement appears immediately. Correct feedback is blue from either side.
- A short input grace/lock window after a correct answer prevents the other player from being punished for pressing just as the cards switch.
- Correct answers trigger a smooth blue expanding pulse from that player card; wrong answers trigger a red pulse.
- Lightweight generated sound effects play for correct, wrong, and win events.
- The final point triggers a clear win animation with a large winner banner and burst effect.
- The symbol layout uses deliberate size variation with overlap checks, so icons are not uniform and should not pile up.
- The heavy card fade overlay has been reduced so symbols stay crisp.
- The game renders optimized 512px transparent object images from `assets/symbols/512/` while keeping the full-size originals separate.

Controls:

- Left player / Player 2: W/A/S/D to move, Space to answer
- Right player / Player 1: Arrow keys to move, Enter to answer

Rules:

- Move the dot onto a symbol to select it.
- The selected symbol is highlighted.
- Pressing answer while no symbol is selected does nothing.
- Wrong answers give escalating personal cooldowns.
- Pressing during the short score-transition lockout does nothing, so nobody is punished for an answer made while the cards are changing.
- A correct answer scores, resets that player's wrong streak, turns that player's card into the new middle card, and draws a new player card.

Latest polish pass:

- Replacement player cards are now pre-rendered while play is happening, hidden behind the current card, so the next card can appear immediately when the top card flies away.
- Current and next gameplay card images are decoded ahead of use, while the browse grid lazy-loads images to keep startup responsive.
- Correct-answer flight still has the same readable travel time, but the keypress-to-movement response is more immediate because the replacement card is no longer built during the animation.
- Card piles now use cleaner stacked circular layers instead of artificial straight side/counting lines.
- The pile edges are subtler and more realistic while still representing cards behind the active card: one card left means no under-pile, and a winning player slot empties after the final card is sent.
- Score-transition protection remains active so a near-simultaneous answer during the switch is ignored rather than punished.
