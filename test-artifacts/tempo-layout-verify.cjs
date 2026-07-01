const { chromium } = require("playwright");
const path = require("path");

const root = path.resolve(__dirname, "..");
const url = "file:///" + path.join(root, "index.html").replace(/\\/g, "/");
const outDir = path.join(root, "test-artifacts");

async function setupRunningGame(page, target = 10) {
  await page.goto(url);
  await page.evaluate((targetScore) => {
    setTab("game");
    document.getElementById("targetScore").value = String(targetScore);
    setupGame(false);
    clearCountdown();
    hideStartOverlay();
    game.running = true;
    game.counting = false;
    game.revealed = true;
    mountMiddleCard(false, false);
    updateCooldownUi("p1");
    updateCooldownUi("p2");
    updateGuideVisibility();
  }, target);
  await page.waitForTimeout(250);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const viewport = { w: innerWidth, h: innerHeight };
    const rectPayload = (el) => {
      const r = el.getBoundingClientRect();
      return {
        selector: el.id || el.className,
        classes: el.className,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        clipped: r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
      };
    };
    const cards = [...document.querySelectorAll(".game-screen .match-card:not(.preloaded-next-card)")].map(rectPayload);
    const labels = [...document.querySelectorAll(".game-screen .player-head")].map(rectPayload);
    const cooldowns = [...document.querySelectorAll(".game-screen .player-foot.cooling")].map(rectPayload);
    const guides = [...document.querySelectorAll(".game-screen .play-guide:not(.hidden-guide)")]
      .filter((guide) => getComputedStyle(guide).display !== "none" && Number(getComputedStyle(guide).opacity) > 0.05)
      .map(rectPayload);
    const activeCards = [...document.querySelectorAll(".active-player-card")].map(rectPayload);
    const piles = [...document.querySelectorAll(".game-screen .card-pile")].map((pile) => {
      const payload = rectPayload(pile);
      const slot = pile.closest(".game-card-slot");
      const active = slot ? slot.querySelector(".active-player-card") : null;
      const cardRect = active ? active.getBoundingClientRect() : null;
      const foot = slot && slot.id === "p1Slot" ? document.querySelector("#p1Panel .player-foot.cooling") : slot && slot.id === "p2Slot" ? document.querySelector("#p2Panel .player-foot.cooling") : null;
      const footRect = foot ? foot.getBoundingClientRect() : null;
      const firstVisible = [...pile.children].find((layer) => Number(getComputedStyle(layer).opacity) > 0.05);
      const layerRect = firstVisible ? firstVisible.getBoundingClientRect() : null;
      const pileStyle = getComputedStyle(pile);
      return {
        ...payload,
        hasVisibleLayer: !!firstVisible,
        behindCard: !cardRect || !layerRect || layerRect.top >= cardRect.top - 8,
        overlapsCooldown: !!footRect && layerRect && layerRect.bottom > footRect.top && layerRect.top < footRect.bottom && layerRect.right > footRect.left && layerRect.left < footRect.right,
        filter: pileStyle.filter,
        firstLayerAfterContent: firstVisible ? getComputedStyle(firstVisible, "::after").content : "none",
        visibleLayers: [...pile.children].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length
      };
    });
    const middle = document.querySelector(".middle-zone .match-card");
    return { viewport, cards, labels, cooldowns, guides, activeCards, piles, middle: middle ? rectPayload(middle) : null };
  });
}

function hasClipped(metrics) {
  return [...metrics.cards, ...metrics.labels, ...metrics.cooldowns, ...metrics.guides, ...metrics.piles].some((item) => item.clipped);
}

function hasBadPile(metrics) {
  return metrics.piles.some((pile) => pile.hasVisibleLayer && (!pile.behindCard || pile.overlapsCooldown || pile.clipped || pile.filter !== "none" || pile.firstLayerAfterContent !== "none"));
}

async function forceWrong(page, which = "p1") {
  await page.evaluate((playerKey) => {
    const player = game[playerKey];
    const shared = sharedSymbolIds(player.card, game.middle)[0];
    const wrong = player.card.symbols.find((id) => id !== shared);
    const item = layoutForCard(player.card).find((candidate) => candidate.symbolId === wrong);
    player.cursor = { x: item.x, y: item.y };
    updateDot(playerKey);
    updateSelection(playerKey);
    answer(playerKey);
  }, which);
  await page.waitForTimeout(140);
}

async function forceCorrect(page, which = "p2") {
  return page.evaluate((playerKey) => {
    const player = game[playerKey];
    const shared = sharedSymbolIds(player.card, game.middle)[0];
    const item = layoutForCard(player.card).find((candidate) => candidate.symbolId === shared);
    player.cursor = { x: item.x, y: item.y };
    updateDot(playerKey);
    updateSelection(playerKey);
    const t0 = performance.now();
    answer(playerKey);
    return performance.now() - t0;
  }, which);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1042 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(url);
  await page.waitForTimeout(300);
  const initialState = await page.evaluate(() => {
    const gameTab = document.getElementById("tab-game");
    const startButton = document.getElementById("middleStart");
    const middle = document.querySelector("#middleSlot .card-back");
    const br = startButton.getBoundingClientRect();
    const mr = middle ? middle.getBoundingClientRect() : null;
    return {
      gameVisible: !gameTab.classList.contains("hidden"),
      bodyGameActive: document.body.classList.contains("game-active"),
      activeTab: document.querySelector(".tabbtn.active")?.dataset.tab,
      startVisible: !startButton.classList.contains("hidden"),
      startText: startButton.textContent,
      buttonRound: Math.abs(br.width - br.height) < 2 && (getComputedStyle(startButton).borderTopLeftRadius.includes("%") || parseFloat(getComputedStyle(startButton).borderTopLeftRadius) >= br.width * 0.45),
      noGameGuide: !document.querySelector("#tab-game .guide-card, #tab-game .play-guide, #tab-game #guideMatch"),
      instructionsNav: !!document.querySelector('[data-tab="instructions"]'),
      middleBack: !!middle,
      noBackMark: !document.querySelector("#middleSlot .back-mark"),
      buttonCenterDelta: mr ? Math.hypot((br.left + br.width / 2) - (mr.left + mr.width / 2), (br.top + br.height / 2) - (mr.top + mr.height / 2)) : 999,
      running: game.running,
      counting: game.counting,
      ended: game.ended
    };
  });
  const initialLayout = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-initial-play.png"), fullPage: false });

  await page.evaluate(() => setTab("instructions"));
  await page.waitForTimeout(160);
  const instructionsState = await page.evaluate(() => ({
    visible: !document.getElementById("tab-instructions").classList.contains("hidden"),
    activeTab: document.querySelector(".tabbtn.active")?.dataset.tab,
    guideCards: document.querySelectorAll("#instructionsGuide .guide-card").length,
    guideExampleCards: document.querySelectorAll("#instructionsGuide .guide-example-card").length,
    guideControlCards: document.querySelectorAll("#instructionsGuide .guide-control-card").length,
    overviewCards: document.querySelectorAll("#instructionsGuide .guide-overview-card").length,
    allInstructionCardsFull: [...document.querySelectorAll("#instructionsGuide .match-card")].every((card) => card.querySelectorAll(".symbol").length >= activeDeck()[0].symbols.length),
    highlightedSymbols: document.querySelectorAll("#instructionsGuide .symbol.sharedhint").length,
    wrongSymbols: document.querySelectorAll("#instructionsGuide .symbol.wronghint").length,
    motionPaths: document.querySelectorAll("#instructionsGuide .guide-motion-path").length,
    keyCount: document.querySelectorAll("#instructionsGuide .guide-key").length,
    dotCount: document.querySelectorAll("#instructionsGuide .guide-dot").length,
    cursorDots: document.querySelectorAll("#instructionsGuide .cursor-dot").length,
    cooldownDemo: !!document.querySelector("#instructionsGuide .cooldown-demo .coolbar") && !!document.querySelector("#guideWrongPlayer") && !!document.querySelector("#guideWrongMiddle"),
    backButtons: document.querySelectorAll("#tab-instructions button[id^='backToPlay']").length,
    titleSize: parseFloat(getComputedStyle(document.querySelector("#tab-instructions h2")).fontSize),
    surfaceHeight: document.querySelector("#tab-instructions .surface").getBoundingClientRect().height,
    playerOrder: [...document.querySelectorAll("#instructionsGuide .guide-card:nth-of-type(3) .guide-player")].map((el) => el.classList.contains("left") ? "wasd" : "arrows").join(","),
    answerOrder: [...document.querySelectorAll("#instructionsGuide .guide-card:nth-of-type(4) .guide-player")].map((el) => el.classList.contains("left") ? "space" : "enter").join(","),
    stacked: (() => {
      const cards = [...document.querySelectorAll("#instructionsGuide .guide-card")].map((el) => el.getBoundingClientRect());
      return cards.every((rect, idx) => idx === 0 || rect.top >= cards[idx - 1].bottom - 4);
    })()
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-instructions.png"), fullPage: false });

  await setupRunningGame(page);
  const desktopBefore = await layoutMetrics(page);
  const guideDuringRun = await page.evaluate(() => {
    return {
      visible: !!document.querySelector("#tab-game .guide-card, #tab-game .play-guide, #tab-game #guideMatch"),
      playingClass: document.getElementById("tab-game").classList.contains("playing")
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-running.png"), fullPage: false });

  const staticChecks = await page.evaluate(() => {
    const deckSets = { full: fullDeck, classic55: deckConfigs.classic55.cards, quick31: quickDeck };
    const validations = {};
    let minGap = Infinity;
    let overlappingPairs = 0;
    let centerItems = 0;
    let edgeItems = 0;
    let emptyQuadrantCards = 0;
    let narrowSpreadCards = 0;
    let lowCoverageCards = 0;
    let emptyHalfCards = 0;
    let centerVoidCards = 0;
    let minSymbolSize = Infinity;
    let maxSymbolSize = 0;
    let minCoverage = Infinity;
    let maxHalfEmpty = 0;
    let maxQuadrantEmpty = 0;
    let maxVisualGap = 0;
    let largeEdgeClipRisk = 0;
    let lowSizeRangeCards = 0;
    let minSizeRange = Infinity;
    let missingSmallCards = 0;
    let missingLargeCards = 0;
    let tinySymbolCount = 0;
    for (const [name, deck] of Object.entries(deckSets)) {
      let badPairs = 0;
      for (let i = 0; i < deck.length; i++) {
        for (let j = i + 1; j < deck.length; j++) {
          if (sharedSymbolIds(deck[i], deck[j]).length !== 1) badPairs++;
        }
      }
      validations[name] = badPairs;
      for (const card of deck) {
        const layout = layoutForCard(card);
        const coverage = sampleFaceCoverage(layout);
        minCoverage = Math.min(minCoverage, coverage.coverage);
        maxHalfEmpty = Math.max(maxHalfEmpty, coverage.maxHalfEmpty);
        maxQuadrantEmpty = Math.max(maxQuadrantEmpty, coverage.maxQuadrantEmpty);
        maxVisualGap = Math.max(maxVisualGap, coverage.maxVisualGap || 0);
        if (coverage.coverage < 0.62) lowCoverageCards++;
        if (coverage.maxHalfEmpty > 0.48) emptyHalfCards++;
        if (!layout.some((item) => Math.hypot(item.x - 50, item.y - 50) < 13)) centerVoidCards++;
        const quadrants = [0, 0, 0, 0];
        let minX = 100, maxX = 0, minY = 100, maxY = 0;
        let cardMinSize = Infinity, cardMaxSize = 0;
        let cardSmallCount = 0, cardLargeCount = 0;
        for (const item of layout) {
          minSymbolSize = Math.min(minSymbolSize, item.size);
          maxSymbolSize = Math.max(maxSymbolSize, item.size);
          cardMinSize = Math.min(cardMinSize, item.size);
          cardMaxSize = Math.max(cardMaxSize, item.size);
          if (item.size < 16.5) cardSmallCount++;
          if (item.size > 30) cardLargeCount++;
          if (item.size < 12.8) tinySymbolCount++;
          if (item.size > 30 && Math.hypot(item.x - 50, item.y - 50) > 45.2 - item.size * 0.38) largeEdgeClipRisk++;
          centerItems += Math.hypot(item.x - 50, item.y - 50) < 13 ? 1 : 0;
          edgeItems += Math.hypot(item.x - 50, item.y - 50) > 30 ? 1 : 0;
          quadrants[(item.y < 50 ? 0 : 2) + (item.x < 50 ? 0 : 1)] += 1;
          minX = Math.min(minX, item.x); maxX = Math.max(maxX, item.x);
          minY = Math.min(minY, item.y); maxY = Math.max(maxY, item.y);
        }
        const sizeRange = cardMaxSize - cardMinSize;
        minSizeRange = Math.min(minSizeRange, sizeRange);
        if (sizeRange < 14) lowSizeRangeCards++;
        if (cardSmallCount < 1) missingSmallCards++;
        if (cardLargeCount < 1) missingLargeCards++;
        if (quadrants.some((count) => count === 0)) emptyQuadrantCards++;
        if (maxX - minX < 50 || maxY - minY < 50) narrowSpreadCards++;
        for (let i = 0; i < layout.length; i++) {
          for (let j = i + 1; j < layout.length; j++) {
            const a = layout[i];
            const b = layout[j];
            const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.hitRadius - b.hitRadius;
            minGap = Math.min(minGap, gap);
            if (gap < 0) overlappingPairs++;
          }
        }
      }
    }
    const files = symbols.map((symbol) => symbol.file);
    return { validations, minGap, overlappingPairs, centerItems, edgeItems, emptyQuadrantCards, narrowSpreadCards, lowCoverageCards, emptyHalfCards, centerVoidCards, minSymbolSize, maxSymbolSize, minSizeRange, lowSizeRangeCards, missingSmallCards, missingLargeCards, tinySymbolCount, minCoverage, maxHalfEmpty, maxQuadrantEmpty, maxVisualGap, largeEdgeClipRisk, fileCount: new Set(files).size };
  });

  const cooldownBefore = await page.evaluate(() => [...document.querySelectorAll(".player-foot.cooling")].length);
  const scoreStart = await page.evaluate(() => ({
    p1Text: document.getElementById("p1Score").textContent,
    p2Text: document.getElementById("p2Score").textContent,
    p1Label: document.getElementById("p1Target").textContent,
    p2Label: document.getElementById("p2Target").textContent
  }));
  await forceWrong(page, "p1");
  const cooldownAfterWrong = await page.evaluate(() => {
    const foot = document.querySelector("#p1Panel .player-foot");
    const bar = document.querySelector("#p1Panel .coolbar");
    const text = document.querySelector("#p1Panel .cooltext");
    const card = document.querySelector("#p1Slot .active-player-card");
    const fr = foot.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      footCooling: foot.classList.contains("cooling"),
      footText: text.textContent,
      footRect: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right },
      barRect: { top: br.top, bottom: br.bottom, left: br.left, right: br.right },
      cardRect: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right },
      barCenterDelta: Math.abs((br.left + br.right) / 2 - (cr.left + cr.right) / 2),
      barOverlapsCard: br.top < cr.bottom && br.bottom > cr.top,
      clipped: fr.left < -1 || fr.top < -1 || fr.right > innerWidth + 1 || fr.bottom > innerHeight + 1,
      cooldownMs: Math.round(game.p1.cooldownUntil - performance.now())
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-cooldown.png"), fullPage: false });

  await page.evaluate(() => { game.p1.cooldownUntil = 0; updateCooldownUi("p1"); });
  const answerTiming = await forceCorrect(page, "p2");
  const scoreAfterCorrect = await page.evaluate(() => ({
    p1Text: document.getElementById("p1Score").textContent,
    p2Text: document.getElementById("p2Score").textContent,
    p1Internal: game.p1.score,
    p2Internal: game.p2.score
  }));
  await page.waitForTimeout(820);
  const afterCorrect = await layoutMetrics(page);
  await page.screenshot({ path: path.join(outDir, "tempo-desktop-after-correct.png"), fullPage: false });

  const countdownChecks = await page.evaluate(async () => {
    setupGame(false);
    const start = performance.now();
    beginCountdown();
    const samples = [];
    const sampleAt = async (ms) => new Promise((resolve) => {
      setTimeout(() => {
        samples.push({
          ms: Math.round(performance.now() - start),
          text: document.getElementById("playCountdown").textContent,
          visible: document.getElementById("playCountdown").classList.contains("show"),
          inStartOverlay: !!document.querySelector("#startOverlay #playCountdown"),
          middleBack: !!document.querySelector("#middleSlot .card-back"),
          countdownRect: (() => {
            const r = document.getElementById("playCountdown").getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          })(),
          countdownPosition: (() => {
            const cr = document.getElementById("playCountdown").getBoundingClientRect();
            const p1 = document.querySelector("#p1Slot .active-player-card").getBoundingClientRect();
            const p2 = document.querySelector("#p2Slot .active-player-card").getBoundingClientRect();
            const p1c = { x: p1.left + p1.width / 2, y: p1.top + p1.height / 2 };
            const p2c = { x: p2.left + p2.width / 2, y: p2.top + p2.height / 2 };
            const expectedX = (p1c.x + p2c.x) / 2;
            const centerX = cr.left + cr.width / 2;
            const centerY = cr.top + cr.height / 2;
            return {
              xDelta: Math.abs(centerX - expectedX),
              centerX,
              centerY,
              playerCenterY: Math.min(p1c.y, p2c.y),
              overlapsP1: cr.left < p1.right && cr.right > p1.left && cr.top < p1.bottom && cr.bottom > p1.top,
              overlapsP2: cr.left < p2.right && cr.right > p2.left && cr.top < p2.bottom && cr.bottom > p2.top
            };
          })(),
          running: game.running,
          counting: game.counting
        });
        resolve();
      }, ms);
    });
    await sampleAt(120);
    await sampleAt(920);
    await sampleAt(220);
    await sampleAt(880);
    await sampleAt(220);
    await sampleAt(880);
    await sampleAt(220);
    await sampleAt(620);
    return samples;
  });

  await page.evaluate(() => {
    setupGame(false);
    beginCountdown();
  });
  await page.waitForTimeout(140);
  await page.screenshot({ path: path.join(outDir, "tempo-countdown-3.png"), fullPage: false });
  await page.waitForTimeout(3150);
  await page.screenshot({ path: path.join(outDir, "tempo-countdown-go.png"), fullPage: false });

  await setupRunningGame(page, 10);
  await page.evaluate(() => {
    game.p1.score = game.target - 1;
    updateScores();
  });
  const winTiming = await forceCorrect(page, "p1");
  await page.waitForTimeout(1050);
  const winState = await page.evaluate(() => {
    const overlay = document.querySelector(".win-overlay");
    const card = document.querySelector(".win-card");
    if (!overlay || !card) return { exists: false };
    const r = card.getBoundingClientRect();
    const title = card.querySelector(".win-title");
    return {
      exists: true,
      leaving: overlay.classList.contains("leaving"),
      text: card.textContent,
      titleLetterSpacing: title ? getComputedStyle(title).letterSpacing : "",
      cardFilter: getComputedStyle(card).filter,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      clipped: r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
    };
  });
  await page.waitForTimeout(1250);
  const winLeavingState = await page.evaluate(() => {
    const overlay = document.querySelector(".win-overlay");
    const card = document.querySelector(".win-card");
    if (!overlay || !card) return { exists: false };
    const title = card.querySelector(".win-title");
    return {
      exists: true,
      leaving: overlay.classList.contains("leaving"),
      text: card.textContent,
      titleLetterSpacing: title ? getComputedStyle(title).letterSpacing : "",
      cardFilter: getComputedStyle(card).filter
    };
  });
  await page.waitForFunction(() => !document.querySelector(".win-overlay"), null, { timeout: 5200 });
  await page.waitForTimeout(320);
  const refillEarlyState = await page.evaluate(() => ({
    refillingPanels: document.querySelectorAll(".player-arena.refilling").length,
    visiblePileLayers: [...document.querySelectorAll(".game-screen .pile-layer")].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length
  }));
  await page.waitForFunction(() => !document.querySelector(".player-arena.refilling"), null, { timeout: 4200 });
  await page.waitForTimeout(180);
  const winReadyState = await page.evaluate(() => {
    const startButton = document.getElementById("middleStart");
    const middle = document.querySelector("#middleSlot .card-back");
    const br = startButton.getBoundingClientRect();
    const mr = middle ? middle.getBoundingClientRect() : null;
    const visiblePileLayers = [...document.querySelectorAll(".game-screen .pile-layer")].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length;
    return {
      overlayGone: !document.querySelector(".win-overlay"),
      middleBack: !!middle,
      noBackMark: !document.querySelector("#middleSlot .back-mark"),
      buttonVisible: !startButton.classList.contains("hidden"),
      buttonText: startButton.textContent,
      playAgainClass: document.querySelector("#startOverlay .start-panel").classList.contains("play-again"),
      p1Score: game.p1.score,
      p2Score: game.p2.score,
      p1Text: document.getElementById("p1Score").textContent,
      p2Text: document.getElementById("p2Score").textContent,
      activeCards: document.querySelectorAll(".active-player-card").length,
      visiblePileLayers,
      staleWinner: !!document.querySelector(".player-arena.winner"),
      staleCooldown: !!document.querySelector(".player-foot.cooling"),
      staleSelection: !!document.querySelector(".symbol.selected,.symbol.p2selected"),
      noGameGuide: !document.querySelector("#tab-game .guide-card, #tab-game .play-guide, #tab-game #guideMatch"),
      buttonRound: Math.abs(br.width - br.height) < 2 && (getComputedStyle(startButton).borderTopLeftRadius.includes("%") || parseFloat(getComputedStyle(startButton).borderTopLeftRadius) >= br.width * 0.45),
      buttonCenterDelta: mr ? Math.hypot((br.left + br.width / 2) - (mr.left + mr.width / 2), (br.top + br.height / 2) - (mr.top + mr.height / 2)) : 999,
      buttonRect: { left: br.left, top: br.top, right: br.right, bottom: br.bottom, width: br.width, height: br.height },
      clipped: br.left < -1 || br.top < -1 || br.right > innerWidth + 1 || br.bottom > innerHeight + 1
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-win-play-again.png"), fullPage: false });
  await page.dispatchEvent("#middleStart", "click");
  await page.waitForTimeout(180);
  const playAgainState = await page.evaluate(() => ({
    overlayGone: !document.querySelector(".win-overlay"),
    p1Score: game.p1.score,
    p2Score: game.p2.score,
    running: game.running,
    counting: game.counting,
    ended: game.ended,
    scoreText: document.getElementById("p1Score").textContent,
    countdownText: document.getElementById("playCountdown").textContent,
    staleSelection: !!document.querySelector(".symbol.selected,.symbol.p2selected"),
    staleCooldown: !!document.querySelector(".player-foot.cooling"),
    noGameGuide: !document.querySelector("#tab-game .guide-card, #tab-game .play-guide, #tab-game #guideMatch")
  }));

  const viewportCases = [
    ["laptop", 1366, 768],
    ["tablet-short", 900, 700],
    ["mobile", 390, 844],
    ["mobile-short", 390, 720]
  ];
  const responsive = {};
  for (const [name, width, height] of viewportCases) {
    await page.setViewportSize({ width, height });
    await setupRunningGame(page);
    await forceWrong(page, "p1");
    responsive[name] = await layoutMetrics(page);
    await page.screenshot({ path: path.join(outDir, `tempo-${name}-running.png`), fullPage: false });
  }

  const result = {
    initialState,
    instructionsState,
    initialLayout,
    guideDuringRun,
    staticChecks,
    desktopBefore,
    cooldownBefore,
    scoreStart,
    cooldownAfterWrong,
    answerTimingMs: Number(answerTiming.toFixed(3)),
    scoreAfterCorrect,
    afterCorrect,
    countdownChecks,
    winTimingMs: Number(winTiming.toFixed(3)),
    winState,
    winLeavingState,
    refillEarlyState,
    winReadyState,
    playAgainState,
    responsive,
    errors
  };
  await browser.close();
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) process.exitCode = 1;
  if (!initialState.gameVisible || !initialState.bodyGameActive || initialState.activeTab !== "game" || !initialState.startVisible || initialState.startText !== "START" || !initialState.buttonRound || !initialState.noGameGuide || !initialState.instructionsNav || !initialState.middleBack || !initialState.noBackMark || initialState.buttonCenterDelta > 5 || initialState.running || initialState.counting || initialState.ended || hasClipped(initialLayout)) process.exitCode = 1;
  if (!instructionsState.visible || instructionsState.activeTab !== "instructions" || instructionsState.guideCards !== 5 || instructionsState.guideExampleCards < 2 || instructionsState.guideControlCards < 6 || instructionsState.overviewCards !== 3 || !instructionsState.allInstructionCardsFull || instructionsState.highlightedSymbols < 8 || instructionsState.wrongSymbols < 1 || instructionsState.motionPaths !== 2 || instructionsState.keyCount < 10 || instructionsState.dotCount !== 2 || instructionsState.cursorDots < 5 || !instructionsState.cooldownDemo || instructionsState.backButtons !== 1 || instructionsState.titleSize < 46 || instructionsState.surfaceHeight < 900 || instructionsState.playerOrder !== "wasd,arrows" || instructionsState.answerOrder !== "space,enter" || !instructionsState.stacked) process.exitCode = 1;
  if (guideDuringRun.visible || !guideDuringRun.playingClass) process.exitCode = 1;
  if (Object.values(staticChecks.validations).some(Boolean)) process.exitCode = 1;
  if (staticChecks.fileCount !== 57 || staticChecks.overlappingPairs > 0) process.exitCode = 1;
  if (staticChecks.minSymbolSize < 13.0 || staticChecks.maxSymbolSize < 32 || staticChecks.minSizeRange < 14 || staticChecks.minCoverage < 0.56 || staticChecks.maxHalfEmpty > 0.54 || staticChecks.maxQuadrantEmpty > 0.62 || staticChecks.maxVisualGap > 8.8 || staticChecks.largeEdgeClipRisk > 0) process.exitCode = 1;
  if (staticChecks.centerItems < 80 || staticChecks.edgeItems < 480 || staticChecks.emptyQuadrantCards > 0 || staticChecks.narrowSpreadCards > 12 || staticChecks.lowCoverageCards > 0 || staticChecks.emptyHalfCards > 0 || staticChecks.centerVoidCards > 12 || staticChecks.lowSizeRangeCards > 0 || staticChecks.missingSmallCards > 0 || staticChecks.missingLargeCards > 0 || staticChecks.tinySymbolCount > 0) process.exitCode = 1;
  if (hasClipped(desktopBefore) || hasClipped(afterCorrect) || hasBadPile(desktopBefore) || hasBadPile(afterCorrect)) process.exitCode = 1;
  if (desktopBefore.middle.width <= Math.max(...desktopBefore.activeCards.map((card) => card.width))) process.exitCode = 1;
  if (cooldownBefore !== 0 || !cooldownAfterWrong.footCooling || !/s$/.test(cooldownAfterWrong.footText) || cooldownAfterWrong.barCenterDelta > 2 || cooldownAfterWrong.barOverlapsCard || cooldownAfterWrong.clipped) process.exitCode = 1;
  if (scoreStart.p1Text !== "10" || scoreStart.p2Text !== "10" || scoreStart.p1Label !== "LEFT" || scoreStart.p2Label !== "LEFT") process.exitCode = 1;
  if (scoreAfterCorrect.p2Internal !== 1 || scoreAfterCorrect.p2Text !== "9") process.exitCode = 1;
  if (answerTiming > 10 || winTiming > 35) process.exitCode = 1;
  const expectedCountdown = ["3", "2", "2", "1", "1", "GO!", "GO!", ""];
  if (countdownChecks.some((sample, idx) => sample.text !== expectedCountdown[idx])) process.exitCode = 1;
  if (countdownChecks.slice(0, 7).some((sample) => !sample.visible || sample.inStartOverlay || !sample.middleBack || sample.countdownRect.width < 130 || sample.countdownRect.height < 130)) process.exitCode = 1;
  if (countdownChecks.slice(0, 7).some((sample) => sample.countdownPosition.xDelta > 8 || sample.countdownPosition.overlapsP1 || sample.countdownPosition.overlapsP2)) process.exitCode = 1;
  const countdownXDrift = Math.max(...countdownChecks.slice(0, 7).map((sample) => sample.countdownPosition.centerX)) - Math.min(...countdownChecks.slice(0, 7).map((sample) => sample.countdownPosition.centerX));
  if (countdownXDrift > 3) process.exitCode = 1;
  if (countdownChecks.slice(0, 6).some((sample) => sample.running || !sample.counting)) process.exitCode = 1;
  if (!countdownChecks[countdownChecks.length - 1].running) process.exitCode = 1;
  if (!winState.exists || winState.leaving || !winState.text.includes("WINS") || winState.clipped || winState.cardFilter !== "none") process.exitCode = 1;
  if (!winLeavingState.exists || !winLeavingState.leaving || winLeavingState.text !== winState.text || winLeavingState.titleLetterSpacing !== winState.titleLetterSpacing || winLeavingState.cardFilter !== "none") process.exitCode = 1;
  if (refillEarlyState.refillingPanels < 1 || refillEarlyState.visiblePileLayers >= 18) process.exitCode = 1;
  if (!winReadyState.overlayGone || !winReadyState.middleBack || !winReadyState.noBackMark || !winReadyState.buttonVisible || winReadyState.buttonText !== "START" || winReadyState.playAgainClass || !winReadyState.buttonRound || winReadyState.buttonCenterDelta > 5 || winReadyState.p1Score !== 0 || winReadyState.p2Score !== 0 || winReadyState.p1Text !== "10" || winReadyState.p2Text !== "10" || winReadyState.activeCards !== 2 || winReadyState.visiblePileLayers < 16 || winReadyState.staleWinner || winReadyState.staleCooldown || winReadyState.staleSelection || !winReadyState.noGameGuide || winReadyState.clipped) process.exitCode = 1;
  if (!playAgainState.overlayGone || playAgainState.p1Score !== 0 || playAgainState.p2Score !== 0 || !playAgainState.counting || playAgainState.ended || playAgainState.scoreText !== "10" || playAgainState.staleSelection || playAgainState.staleCooldown || !playAgainState.noGameGuide) process.exitCode = 1;
  for (const metrics of Object.values(responsive)) {
    if (hasClipped(metrics) || hasBadPile(metrics)) process.exitCode = 1;
    if (metrics.middle.width <= Math.max(...metrics.activeCards.map((card) => card.width))) process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
