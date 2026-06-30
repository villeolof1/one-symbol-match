const { chromium } = require("playwright");
const path = require("path");

const root = path.resolve(__dirname, "..");
const url = "file:///" + path.join(root, "index.html").replace(/\\/g, "/");
const outDir = path.join(root, "test-artifacts");

async function setupRunningGame(page) {
  await page.goto(url);
  await page.click('[data-tab="game"]');
  await page.evaluate(() => {
    setupGame(false);
    clearCountdown();
    hideStartOverlay();
    game.running = true;
    game.counting = false;
    mountMiddleCard(false, false);
    updateCooldownUi("p1");
    updateCooldownUi("p2");
  });
  await page.waitForTimeout(250);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const viewport = { w: innerWidth, h: innerHeight };
    const cards = [...document.querySelectorAll(".game-screen .match-card:not(.preloaded-next-card)")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        classes: el.className,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        clipped: r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
      };
    });
    const footStates = [...document.querySelectorAll(".game-screen .player-foot")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        classes: el.className,
        opacity: getComputedStyle(el).opacity,
        left: r.left,
        right: r.right,
        width: r.width
      };
    });
    return { viewport, cards, footStates };
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1042 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await setupRunningGame(page);
  const desktopBefore = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-running.png"), fullPage: false });

  const staticChecks = await page.evaluate(() => {
    const deckSets = { full: fullDeck, classic55: deckConfigs.classic55.cards, quick31: quickDeck };
    const validations = {};
    for (const [name, deck] of Object.entries(deckSets)) {
      let badPairs = 0;
      for (let i = 0; i < deck.length; i++) {
        for (let j = i + 1; j < deck.length; j++) {
          if (sharedSymbolIds(deck[i], deck[j]).length !== 1) badPairs++;
        }
      }
      validations[name] = badPairs;
    }
    let minGap = Infinity;
    let tightPairs = 0;
    let centerItems = 0;
    for (const deck of Object.values(deckSets)) {
      for (const card of deck) {
        const layout = layoutForCard(card);
        centerItems += layout.filter((item) => Math.hypot(item.x - 50, item.y - 50) < 11).length;
        for (let i = 0; i < layout.length; i++) {
          for (let j = i + 1; j < layout.length; j++) {
            const a = layout[i];
            const b = layout[j];
            const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.hitRadius - b.hitRadius;
            minGap = Math.min(minGap, gap);
            if (gap < 0) tightPairs++;
          }
        }
      }
    }
    const files = symbols.map((symbol) => symbol.file);
    return { validations, minGap, tightPairs, centerItems, fileCount: new Set(files).size };
  });

  const cooldownBefore = await page.evaluate(() => [...document.querySelectorAll(".player-foot.cooling")].length);
  await page.evaluate(() => {
    const shared = sharedSymbolIds(game.p1.card, game.middle)[0];
    const wrong = game.p1.card.symbols.find((id) => id !== shared);
    const item = layoutForCard(game.p1.card).find((candidate) => candidate.symbolId === wrong);
    game.p1.cursor = { x: item.x, y: item.y };
    updateDot("p1");
    updateSelection("p1");
    answer("p1");
  });
  await page.waitForTimeout(120);
  const cooldownAfterWrong = await page.evaluate(() => {
    const foot = document.querySelector("#p1Panel .player-foot");
    const bar = document.querySelector("#p1Panel .coolbar");
    const card = document.querySelector("#p1Slot .active-player-card");
    const fr = foot.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      footCooling: foot.classList.contains("cooling"),
      footOpacity: getComputedStyle(foot).opacity,
      barRect: { top: br.top, bottom: br.bottom, left: br.left, right: br.right },
      cardRect: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right },
      barCenterDelta: Math.abs((br.left + br.right) / 2 - (cr.left + cr.right) / 2),
      barOverlapsCard: br.top < cr.bottom && br.bottom > cr.top,
      cooldownMs: Math.round(game.p1.cooldownUntil - performance.now())
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-cooldown.png"), fullPage: false });

  await page.evaluate(() => {
    game.p1.cooldownUntil = 0;
    updateCooldownUi("p1");
    const shared = sharedSymbolIds(game.p2.card, game.middle)[0];
    const item = layoutForCard(game.p2.card).find((candidate) => candidate.symbolId === shared);
    game.p2.cursor = { x: item.x, y: item.y };
    updateDot("p2");
    updateSelection("p2");
  });
  const answerTiming = await page.evaluate(() => {
    const t0 = performance.now();
    answer("p2");
    return performance.now() - t0;
  });
  await page.waitForTimeout(760);
  const afterCorrect = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-after-correct.png"), fullPage: false });

  await page.setViewportSize({ width: 1366, height: 768 });
  await setupRunningGame(page);
  const laptop = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-laptop-running.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await setupRunningGame(page);
  const mobile = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-mobile-running.png"), fullPage: false });

  const result = {
    staticChecks,
    desktopBefore,
    cooldownBefore,
    cooldownAfterWrong,
    answerTimingMs: Number(answerTiming.toFixed(3)),
    afterCorrect,
    laptop,
    mobile,
    errors
  };
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
  if (Object.values(staticChecks.validations).some(Boolean)) process.exitCode = 1;
  if (staticChecks.tightPairs > 0 || staticChecks.centerItems < 15) process.exitCode = 1;
  if (desktopBefore.cards.some((card) => card.clipped) || afterCorrect.cards.some((card) => card.clipped) || laptop.cards.some((card) => card.clipped) || mobile.cards.some((card) => card.clipped)) process.exitCode = 1;
  if (cooldownBefore !== 0 || !cooldownAfterWrong.footCooling || cooldownAfterWrong.barCenterDelta > 2 || cooldownAfterWrong.barOverlapsCard) process.exitCode = 1;
  if (answerTiming > 10) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
