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
      const visibleLayerRects = [...pile.children]
        .filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05)
        .map((layer) => layer.getBoundingClientRect());
      const minLayerTop = visibleLayerRects.length ? Math.min(...visibleLayerRects.map((rect) => rect.top)) : null;
      const pileStyle = getComputedStyle(pile);
      return {
        ...payload,
        hasVisibleLayer: !!firstVisible,
        behindCard: !cardRect || !layerRect || layerRect.top >= cardRect.top - 8,
        topProtrusion: cardRect && minLayerTop != null ? Math.max(0, cardRect.top - minLayerTop) : 0,
        activeCardId: active?.dataset.cardId || null,
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
      howToPlayNav: document.querySelector('[data-tab="instructions"]')?.textContent.trim() === "How to play",
      howToPlayHud: document.getElementById("showInstructions")?.textContent.trim() === "How to play",
      noInstructionsText: ![...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Instructions"),
      leftLabel: document.querySelector("#p2Scorepill .score-label")?.textContent.trim(),
      rightLabel: document.querySelector("#p1Scorepill .score-label")?.textContent.trim(),
      leftPlayerHead: document.querySelector("#p2Panel .player-name")?.textContent.trim(),
      rightPlayerHead: document.querySelector("#p1Panel .player-name")?.textContent.trim(),
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
    altHighlightedSymbols: document.querySelectorAll("#instructionsGuide .symbol.sharedhint2").length,
    wrongSymbols: document.querySelectorAll("#instructionsGuide .symbol.wronghint").length,
    motionPaths: document.querySelectorAll("#instructionsGuide .guide-motion-path").length,
    keyCount: document.querySelectorAll("#instructionsGuide .guide-key").length,
    dotCount: document.querySelectorAll("#instructionsGuide .guide-dot").length,
    cursorDots: document.querySelectorAll("#instructionsGuide .cursor-dot").length,
    cooldownDemo: !!document.querySelector("#instructionsGuide .cooldown-demo .coolbar") && !!document.querySelector("#guideWrongPlayer") && !!document.querySelector("#guideWrongMiddle"),
    cooldownTextClean: !document.querySelector("#instructionsGuide .cooldown-demo")?.textContent.includes("Wrong object selected") && !document.querySelector("#instructionsGuide .cooldown-demo")?.textContent.includes("not on the middle card"),
    cooldownNeutral: (() => {
      const color = getComputedStyle(document.querySelector("#instructionsGuide .cooldown-demo")).backgroundColor;
      return !color.includes("239, 68, 68") && !color.includes("248, 113, 113");
    })(),
    backButtons: document.querySelectorAll("#tab-instructions button[id^='backToPlay']").length,
    titleSize: parseFloat(getComputedStyle(document.querySelector("#tab-instructions h2")).fontSize),
    surfaceHeight: document.querySelector("#tab-instructions .surface").getBoundingClientRect().height,
    playerOrder: [...document.querySelectorAll("#instructionsGuide .guide-card:nth-of-type(3) .guide-player")].map((el) => el.classList.contains("left") ? "wasd" : "arrows").join(","),
    answerOrder: [...document.querySelectorAll("#instructionsGuide .guide-card:nth-of-type(4) .guide-player")].map((el) => el.classList.contains("left") ? "space" : "enter").join(","),
    overviewLabels: [...document.querySelectorAll(".guide-arena-label")].map((el) => el.textContent.trim()).join("|"),
    overviewSharedIds: [...document.querySelectorAll("#guideArenaMiddle .symbol.sharedhint,#guideArenaMiddle .symbol.sharedhint2")].map((el) => el.dataset.symbolId),
    overviewColors: [...document.querySelectorAll("#guideArenaMiddle .symbol.sharedhint,#guideArenaMiddle .symbol.sharedhint2")].map((el) => getComputedStyle(el).outlineColor),
    step2Highlights: document.querySelectorAll("#guideWasdCard .sharedhint,#guideWasdCard .sharedhint2,#guideArrowCard .sharedhint,#guideArrowCard .sharedhint2").length,
    wasdGrid: getComputedStyle(document.querySelector(".guide-keys.wasd")).gridTemplateColumns.split(" ").length,
    arrowGrid: getComputedStyle(document.querySelector(".guide-keys.arrows")).gridTemplateColumns.split(" ").length,
    idleMotionAnimation: getComputedStyle(document.querySelector("#guideWasdCard .cursor-dot")).animationName,
    idleAnswerAnimation: getComputedStyle(document.querySelector("#guideAnswerLeft .symbol.sharedhint")).animationName,
    idleCooldownAnimation: getComputedStyle(document.querySelector("#guideWrongPlayer .symbol.wronghint")).animationName,
    idleCooldownCorrectAnimation: getComputedStyle(document.querySelector("#guideWrongMiddle .symbol.sharedhint")).animationName,
    stacked: (() => {
      const cards = [...document.querySelectorAll("#instructionsGuide .guide-card")].map((el) => el.getBoundingClientRect());
      return cards.every((rect, idx) => idx === 0 || rect.top >= cards[idx - 1].bottom - 4);
    })()
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-instructions.png"), fullPage: false });
  await page.hover(".guide-motion-demo.left");
  await page.waitForTimeout(220);
  const motionHoverState = await page.evaluate(() => ({
    cursorAnimation: getComputedStyle(document.querySelector("#guideWasdCard .cursor-dot")).animationName,
    activeWasdKeys: document.querySelector(".guide-motion-demo.left").dataset.activeKeys.split(",").filter(Boolean).sort(),
    activeArrowKeysBeforeHover: document.querySelector(".guide-motion-demo.right").dataset.activeKeys.split(",").filter(Boolean),
    liveWasdClasses: [...document.querySelectorAll(".guide-motion-demo.left .guide-key.active")].map(el => el.textContent.trim()).sort(),
    phaseSamples: (() => {
      const samples = [
        [215, ["left", "up"], [-1, -1]],
        [755, ["right"], [1, 0]],
        [1835, ["down", "left"], [-1, 1]],
        [2375, ["down", "right"], [1, 1]],
        [2915, ["left"], [-1, 0]],
        [3995, ["up"], [0, -1]],
        [4535, ["right"], [1, 0]]
      ];
      return samples.map(([time, expectedKeys, expectedDir]) => {
        const sample = window.__sampleGuideMotion(time);
        const dir = [
          sample.keys.includes("left") ? -1 : sample.keys.includes("right") ? 1 : 0,
          sample.keys.includes("up") ? -1 : sample.keys.includes("down") ? 1 : 0
        ];
        return { time, x:sample.x, y:sample.y, active:sample.keys.sort(), expectedKeys: expectedKeys.sort(), dir, expectedDir };
      });
    })()
  }));
  await page.hover(".guide-motion-demo.right");
  await page.waitForTimeout(220);
  const arrowMotionHoverState = await page.evaluate(() => ({
    activeArrowKeys: document.querySelector(".guide-motion-demo.right").dataset.activeKeys.split(",").filter(Boolean).sort(),
    liveArrowClasses: [...document.querySelectorAll(".guide-motion-demo.right .guide-key.active")].map(el => el.textContent.trim()).sort(),
    wasdStopped: document.querySelector(".guide-motion-demo.left").dataset.activeKeys === ""
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-how-to-play-motion-hover.png"), fullPage: false });
  await page.hover(".guide-answer-demo.right");
  await page.waitForTimeout(180);
  const answerHoverState = await page.evaluate(() => ({
    keyAnimation: getComputedStyle(document.querySelector(".guide-answer-demo.right .guide-key.wide")).animationName,
    lockAnimation: getComputedStyle(document.querySelector("#guideAnswerRight .symbol.sharedhint")).animationName,
    cardAnimation: getComputedStyle(document.querySelector("#guideAnswerRight .match-card")).animationName
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-how-to-play-answer-hover.png"), fullPage: false });
  await page.hover(".cooldown-demo");
  await page.waitForTimeout(4350);
  const cooldownHoverState = await page.evaluate(() => ({
    playing: document.querySelector(".cooldown-demo").classList.contains("playing"),
    done: document.querySelector(".cooldown-demo").classList.contains("done"),
    wrongOutline: getComputedStyle(document.querySelector("#guideWrongPlayer .symbol.wronghint")).outlineColor,
    playerCorrectOutline: getComputedStyle(document.querySelector("#guideWrongPlayer .symbol.sharedhint")).outlineColor,
    middleCorrectOutline: getComputedStyle(document.querySelector("#guideWrongMiddle .symbol.sharedhint")).outlineColor,
    barTransform: getComputedStyle(document.querySelector(".cooldown-demo .coolbar span")).transform,
    cooldownText: document.querySelector(".guide-cooltime")?.textContent.trim(),
    barUnderPersonal: (() => {
      const bar = document.querySelector(".cooldown-demo .coolbar").getBoundingClientRect();
      const card = document.querySelector("#guideWrongPlayer .match-card").getBoundingClientRect();
      return bar.top >= card.bottom - 2 && Math.abs((bar.left + bar.right) / 2 - (card.left + card.right) / 2) < 5;
    })()
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-how-to-play-cooldown-hover.png"), fullPage: false });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(220);
  const cooldownPersistState = await page.evaluate(() => ({
    done: document.querySelector(".cooldown-demo").classList.contains("done"),
    wrongOutline: getComputedStyle(document.querySelector("#guideWrongPlayer .symbol.wronghint")).outlineColor,
    middleCorrectOutline: getComputedStyle(document.querySelector("#guideWrongMiddle .symbol.sharedhint")).outlineColor
  }));
  await page.hover(".cooldown-demo");
  await page.waitForTimeout(160);
  const cooldownReplayState = await page.evaluate(() => ({
    playing: document.querySelector(".cooldown-demo").classList.contains("playing"),
    done: document.querySelector(".cooldown-demo").classList.contains("done"),
    wrongOutline: getComputedStyle(document.querySelector("#guideWrongPlayer .symbol.wronghint")).outlineColor,
    middleCorrectOutline: getComputedStyle(document.querySelector("#guideWrongMiddle .symbol.sharedhint")).outlineColor,
    cooldownText: document.querySelector(".guide-cooltime")?.textContent.trim()
  }));

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
    const pile = document.querySelector("#p1Slot .card-pile");
    const fr = foot.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const visibleLayerRects = [...pile.querySelectorAll(".pile-layer")]
      .filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05)
      .map((layer) => layer.getBoundingClientRect());
    const minLayerTop = visibleLayerRects.length ? Math.min(...visibleLayerRects.map((rect) => rect.top)) : cr.top;
    return {
      footCooling: foot.classList.contains("cooling"),
      footText: text.textContent,
      footRect: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right },
      barRect: { top: br.top, bottom: br.bottom, left: br.left, right: br.right },
      cardRect: { top: cr.top, bottom: cr.bottom, left: cr.left, right: cr.right },
      barCenterDelta: Math.abs((br.left + br.right) / 2 - (cr.left + cr.right) / 2),
      barOverlapsCard: br.top < cr.bottom && br.bottom > cr.top,
      pileTopProtrusion: Math.max(0, cr.top - minLayerTop),
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
    game.p2.score = 4;
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
  await page.waitForFunction(() => document.body.classList.contains("middle-flipping-back") || document.querySelector("#middleSlot .flip-out,#middleSlot .flip-in-back"), null, { timeout: 3000 });
  const flipBackState = await page.evaluate(() => ({
    bodyFlag: document.body.classList.contains("middle-flipping-back"),
    flipOut: !!document.querySelector("#middleSlot .flip-out"),
    flipInBack: !!document.querySelector("#middleSlot .flip-in-back"),
    middleBack: !!document.querySelector("#middleSlot .card-back")
  }));
  await page.screenshot({ path: path.join(outDir, "tempo-win-flip-back.png"), fullPage: false });
  await page.waitForFunction(() => !document.querySelector(".win-overlay"), null, { timeout: 5200 });
  await page.waitForTimeout(320);
  const refillEarlyState = await page.evaluate(() => ({
    active: refillState.active,
    started: refillState.started,
    complete: refillState.complete,
    scores: { ...refillState.scores },
    finalCardIds: { ...refillState.finalCardIds },
    committedCardIds: { ...refillState.committedCardIds },
    startVisible: !document.getElementById("middleStart").classList.contains("hidden"),
    refillingPanels: document.querySelectorAll(".player-arena.refilling").length,
    refillCards: document.querySelectorAll(".refill-card").length,
    visiblePileLayers: [...document.querySelectorAll(".game-screen .pile-layer")].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length,
    activeCardIds: {
      p1: document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
      p2: document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
    }
  }));
  await page.waitForTimeout(950);
  const refillActiveState = await page.evaluate(() => {
    const refillCards = [...document.querySelectorAll(".refill-card")];
    const refillMeta = refillCards.map((card) => ({
      side: card.dataset.refillFor,
      index: Number(card.dataset.refillIndex),
      z: Number(getComputedStyle(card).zIndex),
      cardId: card.dataset.cardId,
      final: card.dataset.refillFinal === "true"
    }));
    const zIncreasing = ["p1", "p2"].every((side) => {
      const cards = refillMeta.filter((card) => card.side === side).sort((a, b) => a.index - b.index);
      return cards.every((card, idx) => idx === 0 || card.z > cards[idx - 1].z);
    });
    const entryDirectionOk = refillCards.every((card) => {
      const x = parseFloat(getComputedStyle(card).getPropertyValue("--refill-x")) || 0;
      return card.dataset.refillFor === "p2" ? x < 0 : x > 0;
    });
    return {
      active: refillState.active,
      started: refillState.started,
      finalCardIds: { ...refillState.finalCardIds },
      initialActiveCardIds: { ...refillState.initialActiveCardIds },
      committedCardIds: { ...refillState.committedCardIds },
      refillingPanels: document.querySelectorAll(".player-arena.refilling").length,
      refillCards: refillCards.length,
      p1RefillCards: document.querySelectorAll(".refill-card.p1").length,
      p2RefillCards: document.querySelectorAll(".refill-card.p2").length,
      faceUpCardsHaveSymbols: refillCards.every((card) => card.querySelectorAll(".symbol-img").length > 0),
      fullyOpaque: refillCards.every((card) => Number(getComputedStyle(card).opacity) === 1),
      transitionDurations: [...new Set(refillCards.map((card) => getComputedStyle(card).transitionDuration))],
      indexes: refillCards.map((card) => `${card.dataset.refillFor}:${card.dataset.refillIndex}`),
      refillMeta,
      zIncreasing,
      entryDirectionOk,
      visiblePileLayers: [...document.querySelectorAll(".game-screen .pile-layer")].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length,
      activeCardIds: {
        p1: document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
        p2: document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
      },
      zOrderOk: refillCards.every((card) => {
        const slot = card.closest(".game-card-slot");
        const active = slot.querySelector(".active-player-card");
        const pile = slot.querySelector(".card-pile");
        const layer = card.closest(".refill-layer");
        return Number(getComputedStyle(card).zIndex) > Number(getComputedStyle(active).zIndex)
          && Number(getComputedStyle(layer).zIndex) > Number(getComputedStyle(active).zIndex)
          && Number(getComputedStyle(active).zIndex) > Number(getComputedStyle(pile).zIndex);
      })
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-post-win-refill.png"), fullPage: false });
  const sampleRefillStackFrame = () => page.evaluate(() => {
    const sides = ["p1", "p2"];
    const bySide = {};
    for (const side of sides) {
      const slot = document.getElementById(side === "p1" ? "p1Slot" : "p2Slot");
      const slotRect = slot.getBoundingClientRect();
      const cx = slotRect.left + slotRect.width / 2;
      const cy = slotRect.top + slotRect.height / 2;
      const cards = [...slot.querySelectorAll(".refill-card")].map((card) => {
        const rect = card.getBoundingClientRect();
        const centered = Math.hypot((rect.left + rect.width / 2) - cx, (rect.top + rect.height / 2) - cy) < 3;
        const coversCenter = rect.left <= cx && rect.right >= cx && rect.top <= cy && rect.bottom >= cy;
        return {
          index: Number(card.dataset.refillIndex),
          cardId: card.dataset.cardId,
          z: Number(getComputedStyle(card).zIndex),
          opacity: Number(getComputedStyle(card).opacity),
          covered: card.classList.contains("covered"),
          settling: card.classList.contains("settling"),
          landing: card.classList.contains("landing"),
          centered,
          coversCenter
        };
      });
      const centeredCards = cards.filter((card) => card.coversCenter).sort((a, b) => b.z - a.z);
      const topRefill = centeredCards[0] || null;
      bySide[side] = {
        cards,
        topRefill,
        topCentered: centeredCards[0] || null,
        activeCardId: slot.querySelector(".active-player-card")?.dataset.cardId,
        committedCardId: refillState.committedCardIds[side] || null,
        stackOrderOk: !centeredCards[0] || centeredCards.every((card, idx) => idx === 0 || card.z < centeredCards[idx - 1].z),
        coveredCentered: cards.filter((card) => card.covered).every((card) => card.centered),
        fullyOpaque: cards.every((card) => card.opacity === 1)
      };
    }
    return {
      timestamp: performance.now(),
      p1: bySide.p1,
      p2: bySide.p2
    };
  });
  const refillFrameSamples = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(220);
    refillFrameSamples.push(await sampleRefillStackFrame());
  }
  const refillStackState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".refill-card")].map((card) => ({
      side: card.dataset.refillFor,
      index: Number(card.dataset.refillIndex),
      z: Number(getComputedStyle(card).zIndex),
      opacity: Number(getComputedStyle(card).opacity),
      final: card.dataset.refillFinal === "true"
    }));
    const bySide = (side) => cards.filter((card) => card.side === side).sort((a, b) => a.index - b.index);
    const contiguous = ["p1", "p2"].every((side) => {
      const sideCards = bySide(side);
      return sideCards.every((card, idx) => card.index === idx);
    });
    const zIncreasing = ["p1", "p2"].every((side) => {
      const sideCards = bySide(side);
      return sideCards.every((card, idx) => idx === 0 || card.z > sideCards[idx - 1].z);
    });
    return {
      cards,
      contiguous,
      zIncreasing,
      fullyOpaque: cards.every((card) => card.opacity === 1),
      visiblePileLayers: [...document.querySelectorAll(".game-screen .pile-layer")].filter((layer) => Number(getComputedStyle(layer).opacity) > 0.05).length,
      committedCardIds: { ...refillState.committedCardIds },
      activeCardIds: {
        p1: document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
        p2: document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
      }
    };
  });
  await page.screenshot({ path: path.join(outDir, "tempo-post-win-refill-stack.png"), fullPage: false });
  await page.waitForFunction(() => !document.querySelector(".player-arena.refilling") && !document.querySelector(".refill-card") && (!window.refillState || refillState.complete), null, { timeout: 6200 });
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
      activeCardIds: {
        p1: document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
        p2: document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
      },
      activeCommitted: {
        p1: document.querySelector("#p1Slot .active-player-card")?.dataset.committedFromRefill === "true",
        p2: document.querySelector("#p2Slot .active-player-card")?.dataset.committedFromRefill === "true"
      },
      finalCardIds: { ...refillState.finalCardIds },
      committedCardIds: { ...refillState.committedCardIds },
      hiddenRefreshStamp: refillState.hiddenRefreshStamp,
      preloadedCardIds: [...document.querySelectorAll(".preloaded-next-card")].map((card) => card.dataset.preparedCardId),
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
  await page.waitForTimeout(260);
  const postHiddenRefreshState = await page.evaluate(() => ({
    hiddenRefreshStamp: refillState.hiddenRefreshStamp,
    activeCardIds: {
      p1: document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
      p2: document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
    },
    activeCommitted: {
      p1: document.querySelector("#p1Slot .active-player-card")?.dataset.committedFromRefill === "true",
      p2: document.querySelector("#p2Slot .active-player-card")?.dataset.committedFromRefill === "true"
    },
    preloadedCardIds: [...document.querySelectorAll(".preloaded-next-card")].map((card) => card.dataset.preparedCardId),
    preloadedNotVisible: [...document.querySelectorAll(".preloaded-next-card")].every((card) => {
      const activeIds = [
        document.querySelector("#p1Slot .active-player-card")?.dataset.cardId,
        document.querySelector("#p2Slot .active-player-card")?.dataset.cardId
      ];
      return !activeIds.includes(card.dataset.preparedCardId);
    })
  }));
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

  await page.evaluate(() => {
    setupGame(false);
    clearCountdown();
    showCleanStart();
    schedulePostWinRefill({ p1:5, p2:3 }, 1000);
  });
  await page.waitForTimeout(120);
  await page.dispatchEvent("#middleStart", "click");
  await page.waitForTimeout(180);
  const earlyStartRefillState = await page.evaluate(() => ({
    buttonHidden: document.getElementById("middleStart").classList.contains("hidden"),
    active: refillState.active,
    started: refillState.started,
    refillCards: document.querySelectorAll(".refill-card").length,
    p1RefillCards: document.querySelectorAll(".refill-card.p1").length,
    p2RefillCards: document.querySelectorAll(".refill-card.p2").length
  }));
  await page.waitForTimeout(430);
  const earlyStartCountdownState = await page.evaluate(() => ({
    counting: game.counting,
    running: game.running,
    countdownText: document.getElementById("playCountdown").textContent,
    startHidden: document.getElementById("middleStart").classList.contains("hidden")
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
    motionHoverState,
    arrowMotionHoverState,
    answerHoverState,
    cooldownHoverState,
    cooldownPersistState,
    cooldownReplayState,
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
    refillActiveState,
    refillFrameSamples,
    refillStackState,
    winReadyState,
    postHiddenRefreshState,
    playAgainState,
    earlyStartRefillState,
    earlyStartCountdownState,
    responsive,
    errors
  };
  await browser.close();
  console.log(JSON.stringify(result, null, 2));

  const phaseSamplesOk = motionHoverState.phaseSamples.every((sample) =>
    JSON.stringify(sample.active) === JSON.stringify(sample.expectedKeys) &&
    sample.dir[0] === sample.expectedDir[0] &&
    sample.dir[1] === sample.expectedDir[1]
  );
  const visibleColor = (value, rgb) => value.includes(rgb) && !value.endsWith(", 0)") && !value.endsWith(", 0.0)");

  if (errors.length) process.exitCode = 1;
  if (!initialState.gameVisible || !initialState.bodyGameActive || initialState.activeTab !== "game" || !initialState.startVisible || initialState.startText !== "START" || !initialState.buttonRound || !initialState.noGameGuide || !initialState.howToPlayNav || !initialState.howToPlayHud || !initialState.noInstructionsText || initialState.leftLabel !== "P1 · WASD" || initialState.rightLabel !== "P2 · ARROWS" || !initialState.leftPlayerHead.includes("Player 1") || !initialState.rightPlayerHead.includes("Player 2") || !initialState.middleBack || !initialState.noBackMark || initialState.buttonCenterDelta > 5 || initialState.running || initialState.counting || initialState.ended || hasClipped(initialLayout)) process.exitCode = 1;
  if (!instructionsState.visible || instructionsState.activeTab !== "instructions" || instructionsState.guideCards !== 5 || instructionsState.guideExampleCards < 2 || instructionsState.guideControlCards < 6 || instructionsState.overviewCards !== 3 || !instructionsState.allInstructionCardsFull || instructionsState.highlightedSymbols < 5 || instructionsState.altHighlightedSymbols < 2 || instructionsState.wrongSymbols < 1 || instructionsState.motionPaths !== 0 || instructionsState.keyCount < 10 || instructionsState.dotCount !== 0 || instructionsState.cursorDots < 5 || !instructionsState.cooldownDemo || !instructionsState.cooldownTextClean || !instructionsState.cooldownNeutral || instructionsState.backButtons !== 1 || instructionsState.titleSize < 46 || instructionsState.surfaceHeight < 900 || instructionsState.playerOrder !== "wasd,arrows" || instructionsState.answerOrder !== "space,enter" || !instructionsState.overviewLabels.includes("Player 1 - WASD") || !instructionsState.overviewLabels.includes("Player 2 - Arrows") || new Set(instructionsState.overviewSharedIds).size !== 2 || new Set(instructionsState.overviewColors).size !== 2 || instructionsState.step2Highlights !== 0 || instructionsState.wasdGrid !== 3 || instructionsState.arrowGrid !== 3 || instructionsState.idleMotionAnimation !== "none" || instructionsState.idleAnswerAnimation !== "none" || instructionsState.idleCooldownAnimation !== "none" || instructionsState.idleCooldownCorrectAnimation !== "none" || !instructionsState.stacked) process.exitCode = 1;
  if (motionHoverState.cursorAnimation !== "none" || JSON.stringify(motionHoverState.activeWasdKeys) !== JSON.stringify(["left", "up"]) || motionHoverState.activeArrowKeysBeforeHover.length !== 0 || JSON.stringify(motionHoverState.liveWasdClasses) !== JSON.stringify(["A", "W"]) || !phaseSamplesOk) process.exitCode = 1;
  if (JSON.stringify(arrowMotionHoverState.activeArrowKeys) !== JSON.stringify(["left", "up"]) || JSON.stringify(arrowMotionHoverState.liveArrowClasses) !== JSON.stringify(["←", "↑"]) || !arrowMotionHoverState.wasdStopped) process.exitCode = 1;
  if (answerHoverState.keyAnimation !== "answerPress" || answerHoverState.lockAnimation !== "guideCorrectLock" || !["none", "cardPop"].includes(answerHoverState.cardAnimation)) process.exitCode = 1;
  if (cooldownHoverState.playing || !cooldownHoverState.done || !visibleColor(cooldownHoverState.wrongOutline, "239, 68, 68") || !visibleColor(cooldownHoverState.playerCorrectOutline, "22, 163, 74") || !visibleColor(cooldownHoverState.middleCorrectOutline, "22, 163, 74") || cooldownHoverState.barTransform === "none" || cooldownHoverState.cooldownText !== "0.0s" || !cooldownHoverState.barUnderPersonal) process.exitCode = 1;
  if (!cooldownPersistState.done || !visibleColor(cooldownPersistState.wrongOutline, "239, 68, 68") || !visibleColor(cooldownPersistState.middleCorrectOutline, "22, 163, 74")) process.exitCode = 1;
  if (!cooldownReplayState.playing || cooldownReplayState.done || visibleColor(cooldownReplayState.wrongOutline, "239, 68, 68") || visibleColor(cooldownReplayState.middleCorrectOutline, "22, 163, 74") || cooldownReplayState.cooldownText !== "") process.exitCode = 1;
  if (guideDuringRun.visible || !guideDuringRun.playingClass) process.exitCode = 1;
  if (Object.values(staticChecks.validations).some(Boolean)) process.exitCode = 1;
  if (staticChecks.fileCount !== 57 || staticChecks.overlappingPairs > 0) process.exitCode = 1;
  if (staticChecks.minSymbolSize < 13.0 || staticChecks.maxSymbolSize < 32 || staticChecks.minSizeRange < 14 || staticChecks.minCoverage < 0.56 || staticChecks.maxHalfEmpty > 0.54 || staticChecks.maxQuadrantEmpty > 0.62 || staticChecks.maxVisualGap > 8.8 || staticChecks.largeEdgeClipRisk > 0) process.exitCode = 1;
  if (staticChecks.centerItems < 80 || staticChecks.edgeItems < 480 || staticChecks.emptyQuadrantCards > 0 || staticChecks.narrowSpreadCards > 12 || staticChecks.lowCoverageCards > 0 || staticChecks.emptyHalfCards > 0 || staticChecks.centerVoidCards > 12 || staticChecks.lowSizeRangeCards > 0 || staticChecks.missingSmallCards > 0 || staticChecks.missingLargeCards > 0 || staticChecks.tinySymbolCount > 0) process.exitCode = 1;
  if (hasClipped(desktopBefore) || hasClipped(afterCorrect) || hasBadPile(desktopBefore) || hasBadPile(afterCorrect)) process.exitCode = 1;
  if (desktopBefore.middle.width <= Math.max(...desktopBefore.activeCards.map((card) => card.width))) process.exitCode = 1;
  if (cooldownBefore !== 0 || !cooldownAfterWrong.footCooling || !/s$/.test(cooldownAfterWrong.footText) || cooldownAfterWrong.barCenterDelta > 2 || cooldownAfterWrong.barOverlapsCard || cooldownAfterWrong.pileTopProtrusion > 2 || cooldownAfterWrong.clipped) process.exitCode = 1;
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
  if (!flipBackState.bodyFlag || (!flipBackState.flipOut && !flipBackState.flipInBack && !flipBackState.middleBack)) process.exitCode = 1;
  if (!refillEarlyState.active || refillEarlyState.started || refillEarlyState.complete || !refillEarlyState.startVisible || refillEarlyState.refillingPanels !== 0 || refillEarlyState.refillCards !== 0 || refillEarlyState.visiblePileLayers >= 18) process.exitCode = 1;
  if (!refillActiveState.active || !refillActiveState.started || refillActiveState.refillingPanels !== 2 || refillActiveState.refillCards < 2 || refillActiveState.p1RefillCards < 1 || refillActiveState.p2RefillCards < 1 || !refillActiveState.faceUpCardsHaveSymbols || !refillActiveState.fullyOpaque || refillActiveState.transitionDurations.length !== 1 || !refillActiveState.indexes.includes("p1:0") || !refillActiveState.indexes.includes("p2:0") || !refillActiveState.zOrderOk || !refillActiveState.zIncreasing || !refillActiveState.entryDirectionOk || refillActiveState.visiblePileLayers !== refillEarlyState.visiblePileLayers || refillActiveState.activeCardIds.p1 !== refillEarlyState.activeCardIds.p1 || refillActiveState.activeCardIds.p2 !== refillEarlyState.activeCardIds.p2) process.exitCode = 1;
  const refillStackSideOk = ["p1", "p2"].every((side) => {
    const sideCards = refillStackState.cards.filter((card) => card.side === side);
    if (refillStackState.committedCardIds[side]) {
      return sideCards.length === 0 && refillStackState.activeCardIds[side] === refillStackState.committedCardIds[side];
    }
    return sideCards.length >= Math.min(4, refillEarlyState.scores[side]) && refillStackState.activeCardIds[side] === refillEarlyState.activeCardIds[side];
  });
  const refillLongSide = refillEarlyState.scores.p1 >= refillEarlyState.scores.p2 ? "p1" : "p2";
  const longSideCards = refillStackState.cards.filter((card) => card.side === refillLongSide);
  const expectedStackPileLayersMin = refillEarlyState.visiblePileLayers + ["p1", "p2"]
    .filter((side) => refillStackState.committedCardIds[side])
    .reduce((total, side) => total + refillEarlyState.scores[side], 0);
  if (!refillStackState.contiguous || !refillStackState.zIncreasing || !refillStackState.fullyOpaque || refillStackState.visiblePileLayers < expectedStackPileLayersMin || !refillStackSideOk || refillStackState.committedCardIds[refillLongSide] || longSideCards.length < Math.min(5, refillEarlyState.scores[refillLongSide])) process.exitCode = 1;
  const refillFrameSamplesOk = refillFrameSamples.every((sample) => ["p1", "p2"].every((side) => {
    const state = sample[side];
    if (state.committedCardId) {
      return state.cards.length === 0 && state.activeCardId === state.committedCardId;
    }
    return state.stackOrderOk && state.coveredCentered && state.fullyOpaque;
  }));
  if (!refillFrameSamplesOk) process.exitCode = 1;
  if (!winReadyState.overlayGone || !winReadyState.middleBack || !winReadyState.noBackMark || !winReadyState.buttonVisible || winReadyState.buttonText !== "START" || winReadyState.playAgainClass || !winReadyState.buttonRound || winReadyState.buttonCenterDelta > 5 || winReadyState.p1Score !== 0 || winReadyState.p2Score !== 0 || winReadyState.p1Text !== "10" || winReadyState.p2Text !== "10" || winReadyState.activeCards !== 2 || winReadyState.visiblePileLayers < 16 || winReadyState.staleWinner || winReadyState.staleCooldown || winReadyState.staleSelection || !winReadyState.noGameGuide || winReadyState.clipped) process.exitCode = 1;
  if (winReadyState.activeCardIds.p1 !== winReadyState.finalCardIds.p1 || winReadyState.activeCardIds.p2 !== winReadyState.finalCardIds.p2 || winReadyState.committedCardIds.p1 !== winReadyState.finalCardIds.p1 || winReadyState.committedCardIds.p2 !== winReadyState.finalCardIds.p2 || !winReadyState.activeCommitted.p1 || !winReadyState.activeCommitted.p2) process.exitCode = 1;
  if ((refillEarlyState.scores.p1 > 0 && winReadyState.activeCardIds.p1 === refillEarlyState.activeCardIds.p1) || (refillEarlyState.scores.p2 > 0 && winReadyState.activeCardIds.p2 === refillEarlyState.activeCardIds.p2)) process.exitCode = 1;
  if (postHiddenRefreshState.hiddenRefreshStamp < winReadyState.hiddenRefreshStamp || postHiddenRefreshState.activeCardIds.p1 !== winReadyState.activeCardIds.p1 || postHiddenRefreshState.activeCardIds.p2 !== winReadyState.activeCardIds.p2 || !postHiddenRefreshState.activeCommitted.p1 || !postHiddenRefreshState.activeCommitted.p2 || postHiddenRefreshState.preloadedCardIds.length < 2 || !postHiddenRefreshState.preloadedNotVisible) process.exitCode = 1;
  if (!playAgainState.overlayGone || playAgainState.p1Score !== 0 || playAgainState.p2Score !== 0 || !playAgainState.counting || playAgainState.ended || playAgainState.scoreText !== "10" || playAgainState.staleSelection || playAgainState.staleCooldown || !playAgainState.noGameGuide) process.exitCode = 1;
  if (!earlyStartRefillState.buttonHidden || !earlyStartRefillState.active || !earlyStartRefillState.started || earlyStartRefillState.refillCards < 1 || earlyStartRefillState.p1RefillCards < 1 || earlyStartRefillState.p2RefillCards < 1) process.exitCode = 1;
  if (!earlyStartCountdownState.counting || earlyStartCountdownState.running || earlyStartCountdownState.countdownText !== "3" || !earlyStartCountdownState.startHidden) process.exitCode = 1;
  for (const metrics of Object.values(responsive)) {
    if (hasClipped(metrics) || hasBadPile(metrics)) process.exitCode = 1;
    if (metrics.middle.width <= Math.max(...metrics.activeCards.map((card) => card.width))) process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
