// app.js
(() => {
  // ============================================================================
  // CONFIG & CONSTANTS
  // ============================================================================

  const CURATED_STARTERS = ["SALET", "SLATE", "CRANE", "TRACE", "STARE", "ROATE", "ARISE", "RAISE", "ADIEU", "AUDIO"];
  const LETTER_BOARD = ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ"];
  const WORDSCORES_URL = "./data/wordScores.json";
  const LS_KEY = "wordlehelper_v1";
  const TOAST_DEFAULT_MS = 5000;

  // ============================================================================
  // STATE
  // ============================================================================

  const state = {
    words: [],
    wordSet: new Set(),
    wordScores: {},
    candidates: [],
    // history: [{word:"SALET", pattern:[0,1,0,0,2]}]
    history: [],
    currentWord: "_____",
    currentPattern: [0, 0, 0, 0, 0],
    // per position lock from prior greens: either letter or null
    lockedGreens: [null, null, null, null, null],
    // hard mode constraints derived from history:
    requiredLetters: new Set(), // letters that must be marked (appear in word and be set >= yellow)
    minCounts: new Map(), // letter -> minimum occurrences required in guesses
    forbiddenPos: Array.from({ length: 5 }, () => new Set()), // pos -> set(letters) (from yellows)
    settingsHelpFromIntro: false,
    settings: {
      hardMode: false, // enforce prior revealed info in guesses
      strictMode: false, // avoid gray letters in guesses
      showStartersAlways: false,
      starterWord: "",
      rankMode: "common",
      starters: null, // null = use curated + saved; else array of words
      seenIntro: false,
    },

    ui: {
      view: "entry", // entry | results
      startersRevealed: false,
      startersDraft: [],
      startersDirty: false,
      restorePending: false,
      customEntryOpen: false,
      customModalOpen: false,
      customModalWord: "",
      hardMsgVisible: false,
      hardMsgUrgent: false,
      sortMode: "likelihood", // likelihood | info
      resultsMode: "candidates", // "starters" | "candidates"
      results: {
        items: [],
        cursor: 0,
        pageSize: 30,
      },
    },
  };

  // ============================================================================
  // DOM HELPERS
  // ============================================================================

  const $ = (id) => document.getElementById(id);

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.settings) state.settings = { ...state.settings, ...data.settings };
    } catch {}

    // Back-compat: older saves won't have rankMode
    if (state.settings.rankMode !== "probe") state.settings.rankMode = "common";

    // Back-compat: older saves won't have strictMode
    if (typeof state.settings.strictMode !== "boolean") {
      state.settings.strictMode = state.settings.strictMode ?? false;
    }
    if (typeof state.settings.seenIntro !== "boolean") state.settings.seenIntro = false;

    // Sync persisted choice into UI state (sort buttons + sortMode)
    applyRankModeToUI();
  }

  function savePersisted() {
    localStorage.setItem(LS_KEY, JSON.stringify({ settings: state.settings }));
  }

  function applyRankModeToUI() {
    // Keep existing UI wiring (likelihood/info) but drive it from persisted rankMode.
    const mode = state.settings.rankMode === "probe" ? "info" : "likelihood";
    state.ui.sortMode = mode;

    // Buttons exist in the DOM; harmless to toggle even if results view is hidden
    $("sortInfo").classList.toggle("active", mode === "info");
    $("sortLikelihood").classList.toggle("active", mode === "likelihood");
  }

  // ============================================================================
  // PURE UTILITIES
  // ============================================================================

  const isWord = (w) => /^[a-z]{5}$/.test(w);
  function normalizeWord(w) {
    return (w || "").trim().toLowerCase();
  }

  // Wordle-style feedback (handles duplicates)
  // returns array of 0 gray, 1 yellow, 2 green
  function feedback(guess, answer) {
    const g = guess.split("");
    const a = answer.split("");
    const res = [0, 0, 0, 0, 0];

    // greens
    for (let i = 0; i < 5; i++) {
      if (g[i] === a[i]) {
        res[i] = 2;
        g[i] = null;
        a[i] = null;
      }
    }
    // yellows
    for (let i = 0; i < 5; i++) {
      if (!g[i]) continue;
      const idx = a.indexOf(g[i]);
      if (idx !== -1) {
        res[i] = 1;
        a[idx] = null;
        g[i] = null;
      }
    }
    return res;
  }

  function patternKey(pat) {
    return pat.join("");
  }

  function countLetters(word) {
    const m = new Map();
    for (const ch of word) m.set(ch, (m.get(ch) || 0) + 1);
    return m;
  }

  function patternEquals(a, b) {
    for (let i = 0; i < 5; i++) if ((a[i] || 0) !== (b[i] || 0)) return false;
    return true;
  }

  function duplicatePatternHint(wordUpper, pat) {
    // Flags common "impossible duplicate" marking:
    // earlier duplicate is gray while a later duplicate is yellow/green.
    // Wordle assigns yellows left→right after greens.
    const w = wordUpper.toUpperCase();

    const positionsByLetter = new Map();
    for (let i = 0; i < 5; i++) {
      const ch = w[i];
      if (!positionsByLetter.has(ch)) positionsByLetter.set(ch, []);
      positionsByLetter.get(ch).push(i);
    }

    const offenders = [];
    for (const [ch, idxs] of positionsByLetter.entries()) {
      if (idxs.length < 2) continue;

      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          const i = idxs[a];
          const j = idxs[b];
          const pi = pat[i] ?? 0;
          const pj = pat[j] ?? 0;

          // earlier gray, later yellow/green => usually a marking mistake
          if (pi === 0 && (pj === 1 || pj === 2)) {
            offenders.push(ch);
            a = idxs.length; // break for this letter
            break;
          }
        }
      }
    }

    if (!offenders.length) return "";
    const uniq = [...new Set(offenders)].join(", ");
    return `Duplicate hint: for ${uniq}, Wordle assigns yellows left→right. Try swapping which duplicate you marked.`;
  }

  function canToggleChipsInline() {
    return state.history.length === 0; // “first round, no guesses yet”
  }

  function applySettingWithResetConfirm({ key, next, resetMsg, onCancelRevert }) {
    // If nothing changes, do nothing
    if (state.settings[key] === next) return;

    const apply = () => {
      state.settings[key] = next;
      savePersisted();
      resetSession(); // resets + rerenders + showEntry() in your current implementation
    };

    // Turn 1 (no guesses): apply immediately
    if (state.history.length === 0) {
      apply();
      return;
    }

    // Turn 2+: confirm -> reset + apply
    toastConfirmAction(resetMsg, {
      onConfirm: apply,
      onCancel: () => {
        onCancelRevert?.();
        // no other side effects
      },
    });
  }

  function disarmRestoreDefaultsConfirm() {
    if (!state.ui.restorePending) return;

    state.ui.restorePending = false;
    clearToastHost(); // closes the confirm/cancel toast (implicit cancel)
  }

  // ============================================================================
  // WORDLE LOGIC (constraints, scoring, candidates)
  // ============================================================================

  function deriveHardConstraintsFromHistory() {
    state.lockedGreens = [null, null, null, null, null];
    state.forbiddenPos = Array.from({ length: 5 }, () => new Set());
    state.minCounts = new Map();

    // For each guess, we can infer:
    // - greens lock positions
    // - yellows forbid that letter at that pos
    // - revealed count (yellow+green) per letter => minimum occurrences required in hard mode guesses
    for (const turn of state.history) {
      const w = turn.word;
      const pat = turn.pattern;
      const revealedCounts = new Map();
      for (let i = 0; i < 5; i++) {
        const ch = w[i];
        if (pat[i] === 2) state.lockedGreens[i] = ch;
        if (pat[i] === 1) state.forbiddenPos[i].add(ch);

        if (pat[i] === 1 || pat[i] === 2) {
          revealedCounts.set(ch, (revealedCounts.get(ch) || 0) + 1);
        }
      }
      // update global minCounts as max per letter across turns
      for (const [ch, cnt] of revealedCounts.entries()) {
        state.minCounts.set(ch, Math.max(state.minCounts.get(ch) || 0, cnt));
      }
    }

    // requiredLetters: letters that must be present in any subsequent hard-mode guess
    // This is simply keys of minCounts
    // state.requiredLetters = new Set([...state.minCounts.keys()]);
  }

  function guessSatisfiesHardMode(guess) {
    // 1) locked greens must match
    for (let i = 0; i < 5; i++) {
      const lock = state.lockedGreens[i];
      if (lock && guess[i] !== lock) return false;
    }
    // 2) forbidden positions from yellows
    for (let i = 0; i < 5; i++) {
      if (state.forbiddenPos[i].has(guess[i])) return false;
    }
    // 3) minimum counts for revealed letters
    const counts = countLetters(guess);
    for (const [ch, min] of state.minCounts.entries()) {
      if ((counts.get(ch) || 0) < min) return false;
    }
    return true;
  }

  function hardModeViolationReason(guess) {
    // guess is expected lowercase (to match stored constraints)
    // 1) locked greens must match
    for (let i = 0; i < 5; i++) {
      const lock = state.lockedGreens[i];
      if (lock && guess[i] !== lock) {
        return `Hard mode: position ${i + 1} must be ${lock.toUpperCase()}.`;
      }
    }

    // 2) forbidden positions from yellows
    for (let i = 0; i < 5; i++) {
      if (state.forbiddenPos[i].has(guess[i])) {
        return `Hard mode: ${guess[i].toUpperCase()} can't be in position ${i + 1}.`;
      }
    }

    // 3) minimum counts for revealed letters
    const counts = countLetters(guess);
    for (const [ch, min] of state.minCounts.entries()) {
      if ((counts.get(ch) || 0) < min) {
        return `Hard mode: must include ${ch.toUpperCase()} (${min}+).`;
      }
    }

    return "";
  }

  function guessSatisfiesStrictMode(guess) {
    // guess is lowercase
    const knowledge = getLetterKnowledge(); // letter -> "green"|"yellow"|"gray"
    for (let i = 0; i < 5; i++) {
      const ch = guess[i];
      if (knowledge[ch] === "gray") return false;
    }
    return true;
  }

  function strictModeViolationReason(guess) {
    // guess is lowercase
    const knowledge = getLetterKnowledge();
    const bad = new Set();

    for (let i = 0; i < 5; i++) {
      const ch = guess[i];
      if (knowledge[ch] === "gray") bad.add(ch.toUpperCase());
    }

    if (bad.size === 0) return "";
    return `Strict solver: avoid gray letters (${[...bad].join(", ")}).`;
  }

  function showSolverInlineMessage(text) {
    const msg = $("hardModeMsg");
    msg.textContent = text;
    msg.classList.remove("hidden");
    state.ui.hardMsgVisible = true;
  }

  function candidatesFromHistory(words) {
    // Filter words that are consistent with all previous feedback
    return words.filter((w) => {
      for (const turn of state.history) {
        const pat = feedback(turn.word, w);
        if (patternKey(pat) !== patternKey(turn.pattern)) return false;
      }
      return true;
    });
  }

  function getLetterKnowledge() {
    const result = {}; // letter -> "green" | "yellow" | "gray"

    for (const turn of state.history) {
      const { word, pattern } = turn; // word lowercase, pattern array

      for (let i = 0; i < 5; i++) {
        const ch = word[i];
        const p = pattern[i];

        if (p === 2) {
          result[ch] = "green";
        } else if (p === 1 && result[ch] !== "green") {
          result[ch] = "yellow";
        } else if (p === 0 && !result[ch]) {
          result[ch] = "gray";
        }
      }
    }

    return result;
  }

  function scoreLikelihood(candidates) {
    // Simple “likelihood” proxy: sum per-position letter frequencies among candidates
    const posFreq = Array.from({ length: 5 }, () => new Map());
    const overall = new Map();

    for (const w of candidates) {
      for (let i = 0; i < 5; i++) {
        const ch = w[i];
        posFreq[i].set(ch, (posFreq[i].get(ch) || 0) + 1);
        overall.set(ch, (overall.get(ch) || 0) + 1);
      }
    }

    const scored = candidates.map((w) => {
      let s = 0;
      const seen = new Set();
      for (let i = 0; i < 5; i++) {
        const ch = w[i];
        s += posFreq[i].get(ch) || 0;
        // small bonus for unique letters
        if (!seen.has(ch)) {
          s += (overall.get(ch) || 0) * 0.15;
          seen.add(ch);
        }
      }
      return { word: w, score: s };
    });

    scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
    return scored;
  }

  function getPreScore(word, key) {
    const obj = state.wordScores && state.wordScores[word];
    const v = obj ? obj[key] : undefined;
    return Number.isFinite(v) ? v : 0;
  }

  function scorePrecomputed(words, key) {
    const scored = words.map((w) => ({ word: w, score: getPreScore(w, key) }));
    scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
    return scored;
  }

  function scoreInfoGain(candidates, guessPool) {
    // Expected partitioning of candidates by feedback pattern.
    // To keep this sane, we score over guessPool (usually candidates themselves).
    // Higher is better (more revealing).
    const total = candidates.length;
    const scored = [];

    // Light caching to avoid recomputing feedback repeatedly
    const fbCache = new Map(); // key: guess|answer -> key string
    const getFBKey = (g, a) => {
      const k = g + "|" + a;
      let v = fbCache.get(k);
      if (!v) {
        v = patternKey(feedback(g, a));
        fbCache.set(k, v);
      }
      return v;
    };

    for (const g of guessPool) {
      const buckets = new Map();
      for (const a of candidates) {
        const k = getFBKey(g, a);
        buckets.set(k, (buckets.get(k) || 0) + 1);
      }
      // Expected remaining size after guess = sum(p_i * size_i) = sum(size_i^2 / total)
      let expectedRemain = 0;
      for (const size of buckets.values()) {
        expectedRemain += (size * size) / total;
      }
      // Info score: how much it reduces expected remain
      const info = total - expectedRemain;
      scored.push({ word: g, score: info });
    }
    scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
    return scored;
  }

  function listMissingRequiredLetters() {
    if (!state.settings.hardMode) return [];

    // Count how many of each letter in the current word are already marked (yellow/green),
    // including locked greens.
    const markedCounts = new Map();

    for (let i = 0; i < 5; i++) {
      const ch = state.currentWord[i]?.trim();
      if (!ch) continue;
      const lower = ch.toLowerCase();

      const isLocked = !!state.lockedGreens[i];
      const st = state.currentPattern[i] || 0;

      // locked green counts as marked; otherwise yellow/green count as marked
      if (isLocked || st === 1 || st === 2) {
        markedCounts.set(lower, (markedCounts.get(lower) || 0) + 1);
      }
    }

    // Missing letters are those where marked < minCount
    const missing = [];
    for (const [lower, min] of state.minCounts.entries()) {
      const have = markedCounts.get(lower) || 0;
      if (have < min) missing.push(lower.toUpperCase());
    }

    missing.sort();
    return missing;
  }

  function isSubmitAllowed() {
    // must have a complete 5-letter word
    if (!/^[A-Z]{5}$/.test(state.currentWord)) return false;

    // Hard mode: all required letters in this word must be marked (yellow or green)
    const missing = listMissingRequiredLetters();
    if (missing.length > 0) return false;

    return true;
  }

  function baselinePattern() {
    const base = [0, 0, 0, 0, 0];
    if (state.settings.hardMode) {
      for (let i = 0; i < 5; i++) {
        if (state.lockedGreens[i]) base[i] = 2;
      }
    }
    return base;
  }

  function getStarterList() {
    const saved = normalizeWord(state.settings.starterWord);
    const starters = [];

    // “Starter word (optional)” stays as a special pinned suggestion
    if (isWord(saved)) starters.push(saved.toUpperCase());

    // Then pull from managed starters (persisted/defaults)
    for (const w of getStoredStarters()) {
      if (!starters.includes(w)) starters.push(w);
      if (starters.length >= 6) break;
    }

    return starters.slice(0, 6);
  }

  function validateCustomModalWord(wordUpper) {
    const w = normalizeWord(wordUpper); // lowercase
    if (!isWord(w)) return { ok: false, msg: "Enter 5 letters" };

    if (!state.wordSet || !state.wordSet.has(w)) {
      return { ok: false, msg: "Not in word list" };
    }

    if (state.settings.hardMode) {
      if (!guessSatisfiesHardMode(w)) {
        const reason = hardModeViolationReason(w);
        return { ok: false, msg: reason || "Hard mode: guess not allowed" };
      }
    }

    if (state.settings.strictMode) {
      if (!guessSatisfiesStrictMode(w)) {
        const reason = strictModeViolationReason(w);
        return { ok: false, msg: reason || "Strict solver: guess not allowed" };
      }
    }

    return { ok: true, msg: "Looks good ✓" };
  }

  // ============================================================================
  // STARTERS (manage list)
  // ============================================================================

  const MAX_STARTERS = 15;

  function getDefaultStarters() {
    // Defaults are your curated list
    return CURATED_STARTERS.slice();
  }

  function getStoredStarters() {
    const s = state.settings.starters;
    if (!Array.isArray(s) || s.length === 0) return getDefaultStarters();
    // sanitize: uppercase A–Z 5 letters, dedupe
    const out = [];
    for (const w of s) {
      const up = String(w || "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z]{5}$/.test(up)) continue;
      if (!out.includes(up)) out.push(up);
      if (out.length >= MAX_STARTERS) break;
    }
    return out.length ? out : getDefaultStarters();
  }

  function setStoredStarters(list) {
    state.settings.starters = list.slice(0, MAX_STARTERS);
    savePersisted();
  }

  function normalizeStarterInput(v) {
    return String(v || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 5);
  }

  function startersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  let toastTimer = null;

  function clearToastHost() {
    const host = $("toastHost");
    if (!host) return null;

    host.innerHTML = "";
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    return host;
  }

  function toast(msg, ms = TOAST_DEFAULT_MS) {
    const host = clearToastHost();
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";

    const text = document.createElement("div");
    text.textContent = msg;

    el.appendChild(text);
    host.appendChild(el);

    toastTimer = setTimeout(() => {
      el.remove();
      toastTimer = null;
    }, ms);
  }

  function toastUndo(msg, onUndo, ms = 4000) {
    const host = clearToastHost();
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";

    const text = document.createElement("div");
    text.textContent = msg;

    const undoBtn = document.createElement("button");
    undoBtn.className = "btn secondary";
    undoBtn.textContent = "Undo";
    undoBtn.onclick = () => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      el.remove();
      onUndo?.();
    };

    el.appendChild(text);
    el.appendChild(undoBtn);
    host.appendChild(el);

    toastTimer = setTimeout(() => {
      el.remove();
      toastTimer = null;
    }, ms);
  }

  function toastConfirm(msg, onConfirm, ms = 30000) {
    const host = clearToastHost();
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";

    const text = document.createElement("div");
    text.textContent = msg;

    const actions = document.createElement("div");
    actions.className = "toastActions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary iconBtn";
    cancelBtn.title = "Cancel";
    cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i>';
    cancelBtn.onclick = () => {
      disarmRestoreDefaultsConfirm(); // implicit cancel
      el.remove();
    };

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn primary iconBtn";
    confirmBtn.title = "Confirm";
    confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    confirmBtn.onclick = () => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      state.ui.restorePending = false;
      el.remove();
      onConfirm?.();
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    el.appendChild(text);
    el.appendChild(actions);
    host.appendChild(el);

    toastTimer = setTimeout(() => {
      // timeout == cancel (no side effects)
      state.ui.restorePending = false;
      el.remove();
      toastTimer = null;
    }, ms);
  }

  function toastConfirmAction(msg, { onConfirm, onCancel, ms = 30000 } = {}) {
    const host = clearToastHost();
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";

    const text = document.createElement("div");
    text.textContent = msg;

    const actions = document.createElement("div");
    actions.className = "toastActions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary iconBtn";
    cancelBtn.title = "Cancel";
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    cancelBtn.onclick = () => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      el.remove();
      onCancel?.();
    };

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn primary iconBtn";
    confirmBtn.title = "Confirm";
    confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    confirmBtn.onclick = () => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      el.remove();
      onConfirm?.();
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    el.appendChild(text);
    el.appendChild(actions);
    host.appendChild(el);

    toastTimer = setTimeout(() => {
      el.remove();
      toastTimer = null;
      onCancel?.(); // timeout behaves like cancel
    }, ms);
  }

  function setStartersDirty(isDirty) {
    state.ui.startersDirty = isDirty;
    $("manageStartersSaveBtn").disabled = !isDirty;
  }

  function updateStarterCount() {
    const el = $("starterCountText");
    if (!el) return;

    const count = state.ui.startersDraft.length;
    const maxed = count >= MAX_STARTERS;

    el.textContent = `${count} / ${MAX_STARTERS}` + (maxed ? " (max)" : "");
    el.classList.toggle("danger", maxed);
  }

  function updateRestoreDefaultsUI() {
    const btn = $("starterRestoreBtn");
    if (!btn) return;

    const defaults = getDefaultStarters().slice(0, MAX_STARTERS);
    const atDefaults = startersEqual(state.ui.startersDraft, defaults);

    btn.classList.toggle("isDisabled", atDefaults);
    btn.setAttribute("aria-disabled", atDefaults ? "true" : "false");
  }

  function flashMovedStarter(word, dir) {
    const listEl = $("manageStartersList");
    if (!listEl) return;

    const row = listEl.querySelector(`.manageItem[data-word="${word}"]`);
    if (!row) return;

    row.classList.remove("movedUp", "movedDown");
    // force reflow so the animation re-triggers on repeated clicks
    void row.offsetWidth;

    row.classList.add(dir === "up" ? "movedUp" : "movedDown");

    // keep it in view on mobile when list scrolls
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // cleanup so class doesn't linger
    setTimeout(() => row.classList.remove("movedUp", "movedDown"), 260);
  }

  function renderManageStartersList() {
    const list = $("manageStartersList");
    list.innerHTML = "";

    if (state.ui.startersDraft.length === 0) {
      const d = document.createElement("div");
      d.className = "small muted";
      d.style.padding = "8px 2px";
      d.textContent = "No starters yet.";
      list.appendChild(d);
      updateStarterCount();
      updateRestoreDefaultsUI();
      return;
    }

    for (const word of state.ui.startersDraft) {
      const row = document.createElement("div");
      row.className = "manageItem";
      row.dataset.word = word;

      const left = document.createElement("div");
      left.className = "manageWord";
      left.textContent = word;

      const actions = document.createElement("div");
      actions.className = "manageActions";

      const idx = state.ui.startersDraft.indexOf(word);

      // Move up
      const up = document.createElement("button");
      up.className = "btn info iconBtn";
      up.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
      up.disabled = idx === 0;
      up.onclick = () => {
        disarmRestoreDefaultsConfirm();
        const list = state.ui.startersDraft;
        [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
        renderManageStartersList();
        flashMovedStarter(word, "up");
        setStartersDirty(!startersEqual(list, getStoredStarters()));
      };

      // Move down
      const down = document.createElement("button");
      down.className = "btn info iconBtn";
      down.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
      down.disabled = idx === state.ui.startersDraft.length - 1;
      down.onclick = () => {
        disarmRestoreDefaultsConfirm();
        const list = state.ui.startersDraft;
        [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
        renderManageStartersList();
        flashMovedStarter(word, "down");
        setStartersDirty(!startersEqual(list, getStoredStarters()));
      };

      // Remove
      const del = document.createElement("button");
      del.className = "btn danger iconBtn";
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.onclick = () => {
        disarmRestoreDefaultsConfirm();

        const list = state.ui.startersDraft;
        const idx = list.indexOf(word);
        if (idx < 0) return;

        // remove immediately
        list.splice(idx, 1);

        renderManageStartersList();
        updateStarterCount();
        setStartersDirty(!startersEqual(list, getStoredStarters()));

        // undo restores to original position
        toastUndo(`Removed ${word}`, () => {
          disarmRestoreDefaultsConfirm();
          const cur = state.ui.startersDraft;

          // prevent duplicates if user re-added manually
          if (cur.includes(word)) return;

          const insertAt = Math.min(idx, cur.length);
          cur.splice(insertAt, 0, word);

          renderManageStartersList();
          updateStarterCount();
          setStartersDirty(!startersEqual(cur, getStoredStarters()));
        });
      };

      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(del);

      row.appendChild(left);
      row.appendChild(actions);
      list.appendChild(row);
    }

    updateStarterCount();
  }

  function openManageStartersModal() {
    // clear any pending restore confirm toast
    disarmRestoreDefaultsConfirm();

    // Draft starts from persisted (or defaults)
    state.ui.startersDraft = getStoredStarters().slice();
    setStartersDirty(false);
    state.ui.restorePending = false;

    const addInput = $("starterAddInput");
    if (addInput) addInput.value = "";

    const restoreBtn = $("starterRestoreBtn");
    if (restoreBtn) restoreBtn.textContent = "Restore defaults";

    renderManageStartersList();
    updateStarterCount();
    updateRestoreDefaultsUI();

    $("manageStartersModal").classList.remove("hidden");

    // focus input for quick add
    setTimeout(() => $("starterAddInput")?.focus(), 0);
  }

  function closeManageStartersModal() {
    disarmRestoreDefaultsConfirm();

    $("manageStartersModal").classList.add("hidden");

    // discard unsaved draft state so next open reloads persisted/defaults
    state.ui.startersDraft = [];
    state.ui.startersDirty = false;
    state.ui.restorePending = false;

    const saveBtn = $("manageStartersSaveBtn");
    if (saveBtn) saveBtn.disabled = true;
  }

  function onStarterAddInput(e) {
    e.target.value = normalizeStarterInput(e.target.value);
  }

  function onStarterAdd() {
    disarmRestoreDefaultsConfirm();
    const inp = $("starterAddInput");
    const word = normalizeStarterInput(inp.value);

    if (word.length < 5) {
      toast("Enter 5 letters");
      return;
    }

    // Optional: validate against your word list if loaded
    if (state.wordSet && state.wordSet.size && !state.wordSet.has(word.toLowerCase())) {
      toast("Not in word list");
      return;
    }

    if (state.ui.startersDraft.includes(word)) {
      toast("Already in the list");
      inp.value = "";
      inp.focus();
      return;
    }

    if (state.ui.startersDraft.length >= MAX_STARTERS) {
      toast(`Max ${MAX_STARTERS} starters`);
      return;
    }

    state.ui.startersDraft.unshift(word);
    inp.value = "";
    inp.focus();

    renderManageStartersList();
    setStartersDirty(!startersEqual(state.ui.startersDraft, getStoredStarters()));
  }

  function onStarterSort() {
    disarmRestoreDefaultsConfirm();
    state.ui.startersDraft = state.ui.startersDraft.slice().sort((a, b) => a.localeCompare(b));
    renderManageStartersList();
    setStartersDirty(!startersEqual(state.ui.startersDraft, getStoredStarters()));
  }

  function onStarterRestoreDefaults() {
    disarmRestoreDefaultsConfirm(); // clears any existing toast first

    const defaults = getDefaultStarters().slice(0, MAX_STARTERS);
    const atDefaults = startersEqual(state.ui.startersDraft, defaults);

    if (atDefaults) {
      toast("List is already at defaults");
      updateRestoreDefaultsUI();
      return;
    }

    state.ui.restorePending = true;

    toastConfirm(
      "Restore default starters? This will replace your current staged list.",
      () => {
        state.ui.startersDraft = defaults.slice();
        updateRestoreDefaultsUI();
        renderManageStartersList();
        setStartersDirty(!startersEqual(state.ui.startersDraft, getStoredStarters()));
        toast("Defaults restored");
      },
      30000,
    );
  }

  function onManageStartersFromSettingsClick() {
    closeSettingsHelpModal();
    openManageStartersModal();
  }

  function onManageStartersSave() {
    disarmRestoreDefaultsConfirm();

    // Persist draft
    setStoredStarters(state.ui.startersDraft);

    // Update any UI that depends on starter list
    if (state.ui.view === "entry" && state.history.length === 0) renderEntry();
    if (state.ui.view === "results" && state.ui.resultsMode === "starters") showResults("starters");

    toast("Saved");
    closeManageStartersModal();
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  function renderCustomLetterBoard() {
    const container = $("customLetterBoard");
    if (!container) return;

    const knowledge = getLetterKnowledge();
    container.innerHTML = "";

    for (const row of LETTER_BOARD) {
      const rowDiv = document.createElement("div");
      rowDiv.className = "letterBoardRow";

      for (const ch of row) {
        const span = document.createElement("span");
        span.className = "letterBoardLetter";

        // knowledge uses lowercase keys
        const stateClass = knowledge[ch.toLowerCase()];
        // Map "gray" -> eliminated; leave undefined -> available
        if (stateClass === "green") span.classList.add("green");
        else if (stateClass === "yellow") span.classList.add("yellow");
        else if (stateClass === "gray") span.classList.add("elim");

        span.textContent = ch;
        rowDiv.appendChild(span);
      }

      container.appendChild(rowDiv);
    }
  }

  function ensureGrid() {
    const grid = $("grid");
    grid.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const div = document.createElement("div");
      div.className = "tile state0";
      div.dataset.idx = String(i);
      div.textContent = " ";
      grid.appendChild(div);
    }
  }

  function renderTiles() {
    const word = state.currentWord;
    const tiles = [...$("grid").querySelectorAll(".tile")];
    for (let i = 0; i < 5; i++) {
      const t = tiles[i];
      const ch = word[i] && word[i] !== "_" ? word[i] : " ";
      t.textContent = ch;

      const isLocked = state.settings.hardMode && !!state.lockedGreens[i];
      t.classList.toggle("locked", isLocked);

      const st = state.currentPattern[i] || 0;
      t.classList.remove("state0", "state1", "state2");
      t.classList.add(`state${st}`);

      // Required marking indicator (only when hard mode and letter is required and currently neutral)
      const upper = ch.trim();
      const lower = upper ? upper.toLowerCase() : "";

      // For hard mode: if this letter is required (minCounts has it) AND we haven't marked enough
      // occurrences yet, then ALL tiles containing this letter should show .needs (until satisfied).
      let needs = false;
      if (state.settings.hardMode && upper && state.minCounts.has(lower)) {
        const requiredMin = state.minCounts.get(lower) || 0;

        // Count how many occurrences of this letter are currently marked (yellow/green), incl locked greens
        let marked = 0;
        for (let j = 0; j < 5; j++) {
          const cj = state.currentWord[j]?.trim();
          if (!cj) continue;
          if (cj.toLowerCase() !== lower) continue;

          const lockedJ = !!state.lockedGreens[j];
          const stJ = state.currentPattern[j] || 0;
          if (lockedJ || stJ === 1 || stJ === 2) marked++;
        }

        // If still short, mark every occurrence (except locked) as needs
        if (marked < requiredMin && !isLocked) needs = true;
      }

      t.classList.toggle("needs", needs);
      t.classList.toggle("urgent", needs && state.ui.hardMsgUrgent);
    }
  }

  // function updateClearEnabled() {
  //   const isDirty = !patternEquals(state.currentPattern, baselinePattern());
  //   const btn = $("clearTurnBtn");

  //   btn.style.display = isDirty ? "inline-block" : "none";
  //   btn.disabled = !isDirty; // optional, but keeps semantics clean
  // }

  function renderNextPills(scored) {
    const next = $("nextPills");
    next.innerHTML = "";
    next.classList.add("hidden");

    if (!state.candidates.length) return;
    if (state.candidates.length === 1) return; // collapse card handles it

    const firstTurn = state.history.length === 0;

    // Turn 0: show starter suggestions immediately + always show More…
    if (firstTurn) {
      const list = getStarterList().slice(0, 5);
      for (const w of list) {
        const b = document.createElement("button");
        b.className = "pill";
        b.textContent = w;
        b.onclick = () => setCurrentWord(w);
        next.appendChild(b);
      }

      const more = document.createElement("button");
      more.className = "pill more";
      more.textContent = "More…";
      more.onclick = () => showResults("starters");
      next.appendChild(more);

      next.classList.remove("hidden");
      return;
    }

    // Update title after first turn
    const suggestionsText = $("suggestionsText");
    if (suggestionsText) suggestionsText.textContent = "Suggestions";

    // After at least one turn:
    // >6 candidates: top 5 + More…
    // <=6 candidates: show all candidates, no More…
    const total = scored.length;
    const limit = total <= 6 ? total : 5;

    const top = scored.slice(0, limit);
    for (const item of top) {
      const b = document.createElement("button");
      b.className = "pill";
      b.textContent = item.word.toUpperCase();
      b.onclick = () => {
        setCurrentWord(item.word.toUpperCase());
        state.ui.hardMsgVisible = false;
        state.ui.hardMsgUrgent = false;
        $("hardModeMsg").classList.add("hidden");
      };
      next.appendChild(b);
    }

    if (total > 6) {
      const more = document.createElement("button");
      more.className = "pill more";
      more.textContent = "More…";
      more.onclick = () => showResults("candidates");
      next.appendChild(more);
    }

    next.classList.remove("hidden");
  }

  function renderHistory() {
    const wrap = $("history");
    wrap.innerHTML = "";

    if (state.history.length === 0) {
      const d = document.createElement("div");
      d.className = "small muted";
      d.textContent = "No turns yet.";
      wrap.appendChild(d);
      return;
    }

    // Header row
    const hdr = document.createElement("div");
    hdr.className = "histHeader";

    const hdrLeft = document.createElement("div");
    hdrLeft.className = "histHeaderLeft";
    hdrLeft.textContent = "Guess";

    const hdrRight = document.createElement("div");
    hdrRight.className = "histHeaderRight";
    hdrRight.textContent = "WORDS LEFT";

    hdr.appendChild(hdrLeft);
    hdr.appendChild(hdrRight);
    wrap.appendChild(hdr);

    // Compute "words left" after each turn by replaying turns on the full word list.
    // Efficient: start from full list and filter progressively (history is small).
    let pool = state.words.slice();
    const leftAfter = [];

    for (let i = 0; i < state.history.length; i++) {
      const turn = state.history[i];
      pool = pool.filter((candidate) => {
        const fb = feedback(turn.word, candidate);
        return patternKey(fb) === patternKey(turn.pattern);
      });
      leftAfter[i] = pool.length;
    }

    for (let idx = 0; idx < state.history.length; idx++) {
      const turn = state.history[idx];

      const row = document.createElement("div");
      row.className = "histRow";

      row.dataset.idx = String(idx);
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      row.addEventListener("click", () => openHistoryModal(idx));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHistoryModal(idx);
        }
      });

      // LEFT: tiles (letters + colors)
      const tilesWrap = document.createElement("div");
      tilesWrap.className = "histTiles";

      const upper = turn.word.toUpperCase();
      for (let i = 0; i < 5; i++) {
        const t = document.createElement("div");
        // Reuse your existing tile state classes (state0/1/2) but size them via CSS.
        t.className = `tile histTile state${turn.pattern[i] || 0}`;
        t.textContent = upper[i] || " ";
        tilesWrap.appendChild(t);
      }

      // RIGHT: metadata block (candidate count after this guess)
      const meta = document.createElement("div");
      meta.className = "histMeta";

      const n = leftAfter[idx] ?? 0;
      meta.textContent = n.toLocaleString();

      row.appendChild(tilesWrap);
      row.appendChild(meta);

      wrap.appendChild(row);
    }
  }

  function renderResults(reset = false) {
    if (reset) {
      state.ui.results.cursor = 0;
      state.ui.results.items = [];
      $("resultsList").innerHTML = "";
    }

    const listEl = $("resultsList");
    const loadingEl = $("resultsLoading");
    const sortRow = document.querySelector(".sortRow");

    function showInlineEmpty(msg, hideSort = true) {
      if (hideSort) sortRow.classList.add("hidden");
      loadingEl.classList.add("hidden");
      listEl.onscroll = null;
      listEl.innerHTML = "";

      const d = document.createElement("div");
      d.className = "small muted";
      d.style.padding = "12px 2px";
      d.textContent = msg;

      listEl.appendChild(d);
    }

    // ---------- STARTERS MODE ----------
    if (state.ui.resultsMode === "starters") {
      // Hide sort UI (no scoring/sorting here)
      sortRow.classList.add("hidden");
      loadingEl.classList.add("hidden");
      listEl.onscroll = null;
      listEl.innerHTML = "";

      // Build curated list + saved starter (dedupe)
      const saved = (state.settings.starterWord || "").trim().toUpperCase();
      const list = getStoredStarters().slice();

      if (/^[A-Z]{5}$/.test(saved) && !list.includes(saved)) {
        list.unshift(saved);
      }

      // Starter list should be the *full* curated list on the Results page
      $("countLine").textContent = `Starter suggestions (${list.length}).`;

      // Add Manage Starters button (screen-level action)
      const manageRow = document.createElement("div");
      manageRow.className = "row";

      const manageBtn = document.createElement("button");
      manageBtn.id = "manageStartersFromMoreBtn";
      manageBtn.className = "btn";
      manageBtn.textContent = "Manage starters";
      manageBtn.onclick = openManageStartersModal;

      manageRow.appendChild(manageBtn);
      listEl.appendChild(manageRow);

      for (const word of list) {
        const row = document.createElement("div");
        row.className = "resRow";

        const left = document.createElement("div");
        left.className = "resLeft";

        const w = document.createElement("div");
        w.className = "resWord";
        w.textContent = word;

        left.appendChild(w);

        const use = document.createElement("button");
        use.className = "btn secondary";
        use.textContent = "Use";
        use.onclick = () => {
          setCurrentWord(word);
          showEntry();
          // clear any prior hard-mode messaging
          state.ui.hardMsgVisible = false;
          state.ui.hardMsgUrgent = false;
          $("hardModeMsg").classList.add("hidden");
        };

        row.appendChild(left);
        row.appendChild(use);
        listEl.appendChild(row);
      }

      return;
    }

    // ---------- CANDIDATES MODE (existing behavior) ----------
    sortRow.classList.remove("hidden");

    // Results page can be opened before the first guess (valid state)
    if (state.history.length === 0) {
      $("countLine").textContent = "Enter your first guess to see ranked candidates.";
      showInlineEmpty("No candidates yet. Enter your first guess, then come back here.");
      return;
    }

    const total = state.candidates.length;

    if (!total) {
      $("countLine").textContent = "No candidates to show.";
      showInlineEmpty("No candidates match the current constraints.", false);
      return;
    }

    $("countLine").textContent = `Showing candidates from ${total.toLocaleString()} possible words.`;

    // scoring
    let scored;

    // Only apply these score-based views after the first guess
    if (state.history.length === 0) {
      scored = state.candidates.map((w) => ({ word: w, score: 0 }));
    } else if (state.ui.sortMode === "info") {
      // "Most Revealing" now means static probeScore
      scored = scorePrecomputed(state.candidates, "probeScore");
    } else {
      // Default "Best Guess" now means commonScore
      scored = scorePrecomputed(state.candidates, "commonScore");
    }

    // Infinite append
    const start = state.ui.results.cursor;
    const end = Math.min(start + state.ui.results.pageSize, scored.length);
    const chunk = scored.slice(start, end);
    state.ui.results.cursor = end;

    loadingEl.classList.toggle("hidden", true);

    for (const item of chunk) {
      const row = document.createElement("div");
      row.className = "resRow";

      const left = document.createElement("div");
      left.className = "resLeft";

      const w = document.createElement("div");
      w.className = "resWord";
      w.textContent = item.word.toUpperCase();

      const sp = document.createElement("div");
      sp.className = "scorePill";
      sp.textContent =
        state.ui.sortMode === "info" ? `probe ${item.score.toFixed(2)}` : `common ${item.score.toFixed(2)}`;

      left.appendChild(w);
      left.appendChild(sp);

      const use = document.createElement("button");
      use.className = "btn secondary";
      use.textContent = "Use";
      use.onclick = () => {
        setCurrentWord(item.word.toUpperCase());
        showEntry();
        // clear any prior hard-mode messaging
        state.ui.hardMsgVisible = false;
        state.ui.hardMsgUrgent = false;
        $("hardModeMsg").classList.add("hidden");
      };

      row.appendChild(left);
      row.appendChild(use);
      listEl.appendChild(row);
    }

    // attach scroll loader
    const onScroll = () => {
      const el = listEl;
      if (state.ui.results.cursor >= scored.length) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        loadingEl.classList.remove("hidden");
        setTimeout(() => {
          loadingEl.classList.add("hidden");
          renderResults(false);
        }, 120);
      }
    };
    listEl.onscroll = onScroll;
  }

  // ---------- Collapse card ----------
  function renderCollapseCard(scoredLikelihood) {
    const card = $("collapseCard");
    if (state.history.length === 0) {
      card.classList.add("hidden");
      return;
    }
    if (state.candidates.length !== 1) {
      card.classList.add("hidden");
      return;
    }
    const only = state.candidates[0];
    const scoreObj = scoredLikelihood.find((x) => x.word === only);
    const s = scoreObj ? scoreObj.score : 0;

    $("collapseWord").textContent = only.toUpperCase();
    $("collapseScore").textContent = `Score: ${s.toFixed(1)}`;
    card.classList.remove("hidden");
  }

  function applySubmitEnabled() {
    $("submitBtn").disabled = !isSubmitAllowed();
  }

  function renderEntry() {
    const modeChip = $("modeChip");
    const strictChip = $("strictChip");
    const needsResetConfirm = state.history.length > 0;

    modeChip.classList.toggle("locked", false);
    strictChip.classList.toggle("locked", false);

    modeChip.setAttribute("title", needsResetConfirm ? "Toggle (will reset)" : "Toggle");
    strictChip.setAttribute("title", needsResetConfirm ? "Toggle (will reset)" : "Toggle");

    modeChip.textContent = state.settings.hardMode ? "Hard" : "Normal";
    modeChip.classList.toggle("hardmode", state.settings.hardMode);

    strictChip.textContent = state.settings.strictMode ? "Strict" : "Relaxed";
    strictChip.classList.toggle("strictmode", state.settings.strictMode);
    strictChip.classList.toggle("relaxedmode", !state.settings.strictMode);

    renderTiles();
    //updateClearEnabled();

    // Score candidates for suggestions
    const scoreKey = state.settings.rankMode === "probe" ? "probeScore" : "commonScore";

    const scoredLikelihood =
      state.candidates.length && state.history.length > 0 ? scorePrecomputed(state.candidates, scoreKey) : [];

    // Collapse card
    renderCollapseCard(scoredLikelihood);

    // Next pills
    $("nextPills").classList.add("hidden");
    if (state.candidates.length > 1) renderNextPills(scoredLikelihood);

    // Custom word entry is always available
    $("enterOwnWordBtn").classList.remove("hidden");
    //$("customEntry").classList.toggle("hidden", !state.ui.customEntryOpen);
    $("customEntry").classList.add("hidden");

    // Submit enablement
    applySubmitEnabled();

    // If hard msg visible, update urgency highlight
    const missing = listMissingRequiredLetters();
    if (!missing.length) hideHardModeInlineMessageIfValid();
    renderHistory();
  }

  function showEntry() {
    state.ui.view = "entry";
    $("entryView").classList.remove("hidden");
    $("resultsView").classList.add("hidden");
    renderEntry();
  }

  function showResults(mode = "candidates") {
    state.ui.view = "results";
    state.ui.resultsMode = mode;

    $("entryView").classList.add("hidden");
    $("resultsView").classList.remove("hidden");

    applyRankModeToUI();
    renderResults(true);
  }

  function burstConfetti() {
    const canvas = $("confetti");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.scale(dpr, dpr);

    const pieces = Array.from({ length: 140 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 5,
      r: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      life: 60 + Math.random() * 40,
    }));

    let frame = 0;
    function tick() {
      frame++;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.vy += 0.05;
        p.life -= 1;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = "rgba(233,238,247,.85)";
        ctx.fillRect(-p.r, -p.r, p.r * 2.2, p.r * 1.2);
        ctx.restore();
      }
      if (frame < 110) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    tick();
  }

  function showHardModeInlineMessage(missingLetters) {
    const msg = $("hardModeMsg");
    const letters = missingLetters.join("/");
    msg.textContent = `Hard Mode: ${letters} must be marked.`;
    msg.classList.remove("hidden");
    state.ui.hardMsgVisible = true;
  }

  function hideHardModeInlineMessageIfValid() {
    if (isSubmitAllowed()) {
      $("hardModeMsg").classList.add("hidden");
      state.ui.hardMsgVisible = false;
      state.ui.hardMsgUrgent = false;
    }
  }

  function openExplainModal(missingLetters) {
    const letters = missingLetters.join(", ");
    $("explainBody").textContent =
      `Because you’re in hard mode, the letters ${letters} are required. Tap them until they turn yellow or green, then submit your result.`;
    $("explainModal").classList.remove("hidden");
  }

  function renderCustomModalWord() {
    const word = state.ui.customModalWord;
    const tiles = [...$("customModalTiles").querySelectorAll(".modalTile")];
    for (let i = 0; i < 5; i++) {
      tiles[i].textContent = word[i] ? word[i] : "";
    }
  }

  function setCustomModalStatus(msg) {
    $("customModalStatus").textContent = msg;
  }

  function flashCustomModal() {
    const card = $("customModalCard");
    card.classList.remove("modalFlash");
    // force reflow so the animation restarts
    void card.offsetWidth;
    card.classList.add("modalFlash");
  }

  // ============================================================================
  // ACTIONS (state mutations + render)
  // ============================================================================

  function setCurrentWord(word) {
    state.currentWord = word.toUpperCase();
    // Reset current pattern (except locked greens in hard mode)
    state.currentPattern = [0, 0, 0, 0, 0];
    $("hardModeMsg").classList.add("hidden");
    state.ui.hardMsgVisible = false;
    state.ui.hardMsgUrgent = false;
    if (state.settings.hardMode) {
      for (let i = 0; i < 5; i++) {
        if (state.lockedGreens[i]) state.currentPattern[i] = 2;
      }
    }
    renderEntry();
  }

  function resetCurrentTurn() {
    // Only reset if a real 5-letter word is currently selected/entered
    if (!/^[A-Z]{5}$/.test(state.currentWord)) return;

    // Reset to baseline (all gray, but keep locked greens in hard mode)
    state.currentPattern = baselinePattern();

    // Clear any hard-mode urgency visuals
    state.ui.hardMsgUrgent = false;
    hideHardModeInlineMessageIfValid();

    renderEntry();
  }

  function submitTurn() {
    const word = state.currentWord.toLowerCase();
    const pat = state.currentPattern.slice();

    // Enforce mode rules BEFORE we do any candidate checking
    if (state.settings.hardMode && !guessSatisfiesHardMode(word)) {
      const reason = hardModeViolationReason(word) || "Hard mode: guess not allowed.";
      showSolverInlineMessage(reason);
      return;
    }

    if (state.settings.strictMode && !guessSatisfiesStrictMode(word)) {
      const reason = strictModeViolationReason(word) || "Strict solver: guess not allowed.";
      showSolverInlineMessage(reason);
      return;
    }

    // Pre-check candidates INCLUDING this pending turn.
    // If it yields zero, the feedback is inconsistent (very often duplicates),
    // so we block submit and let the user fix tile colors.
    const pendingTurns = [...state.history, { word, pattern: pat }];

    const nextCandidates = state.words.filter((candidate) => {
      for (const turn of pendingTurns) {
        const fb = feedback(turn.word, candidate);
        if (patternKey(fb) !== patternKey(turn.pattern)) return false;
      }
      return true;
    });

    if (nextCandidates.length === 0) {
      const hint = duplicatePatternHint(state.currentWord, pat);

      const msg =
        "No candidates match that feedback.\n\n" +
        "Most likely: one or more tile colors are marked incorrectly (duplicates are the usual culprit).\n" +
        (hint ? `\n${hint}\n` : "") +
        "\nFix the colors for this word and try Submit again.";

      alert(msg);
      return; // do NOT record this turn
    }

    // Accept the turn
    state.history.push({ word, pattern: pat });

    // Re-derive constraints (your existing function)
    deriveHardConstraintsFromHistory();

    // Use the already-computed candidate list
    state.candidates = nextCandidates;

    // Reset current entry
    state.currentWord = "_____";
    state.currentPattern = [0, 0, 0, 0, 0];

    // Clear helper message states (matches your existing UI logic)
    $("hardModeMsg").classList.add("hidden");
    state.ui.hardMsgVisible = false;
    state.ui.hardMsgUrgent = false;

    state.ui.customEntryOpen = false;

    renderEntry();
  }

  function resetSession() {
    state.history = [];
    state.currentWord = "_____";
    state.currentPattern = [0, 0, 0, 0, 0];
    state.lockedGreens = [null, null, null, null, null];
    state.requiredLetters = new Set();
    state.minCounts = new Map();
    state.forbiddenPos = Array.from({ length: 5 }, () => new Set());
    // state.ui.startersRevealed = state.settings.showStartersAlways;
    state.ui.customEntryOpen = false;
    state.ui.hardMsgVisible = false;
    state.ui.hardMsgUrgent = false;
    $("hardModeMsg").classList.add("hidden");

    // candidates reset to full list
    state.candidates = state.words.slice();
    renderEntry();
    showEntry();
  }

  function restoreToHistoryIndex(targetIdx) {
    const snapshot = state.history.slice(0, targetIdx + 1);

    resetSession(); // clears history + resets candidates to full list + renders entry view

    // Rebuild by replaying turns safely (no submit validation, no UI assumptions)
    for (const turn of snapshot) {
      replayTurn(turn.word, turn.pattern);
    }

    renderEntry();
    showEntry();
  }

  function replayTurn(word, pat) {
    // record the turn
    state.history.push({ word, pattern: pat });

    // refine candidates from current pool (fast + consistent)
    state.candidates = state.candidates.filter((candidate) => {
      const fb = feedback(word, candidate);
      return patternKey(fb) === patternKey(pat);
    });

    // rebuild hard-mode constraints derived from history
    deriveHardConstraintsFromHistory();

    // reset current entry for cleanliness
    state.currentWord = "_____";
    state.currentPattern = [0, 0, 0, 0, 0];
  }

  function openCustomModal() {
    const overlay = $("customModalOverlay");
    overlay.classList.remove("hidden");
    state.ui.customModalOpen = true;

    // default checkbox: checked on first turn
    $("customModalSaveStarterChk").checked = state.history.length === 0;

    state.ui.customModalWord = "";
    renderCustomModalWord();
    setCustomModalStatus("Enter 5 letters");
    $("customModalSubmitBtn").disabled = true;

    renderCustomLetterBoard();

    // focus the hidden input so iOS keyboard comes up
    const inp = $("customModalInput");
    inp.value = "";
    inp.focus();
  }

  function closeCustomModal() {
    $("customModalOverlay").classList.add("hidden");
    state.ui.customModalOpen = false;
  }

  function clearCustomModal() {
    state.ui.customModalWord = "";

    renderCustomModalWord();
    setCustomModalStatus("Enter 5 letters");

    $("customModalSubmitBtn").disabled = true;

    // keep keyboard/focus alive (important on mobile)
    focusCustomModalInput();
  }

  function openSettingsHelpModal(tab = "settings", { fromIntro = false } = {}) {
    $("hardModeToggle").checked = state.settings.hardMode;
    $("strictModeToggle").checked = state.settings.strictMode;

    state.ui.settingsHelpFromIntro = !!fromIntro;

    // show modal
    $("settingsHelpModal").classList.remove("hidden");

    // default tab
    selectSettingsHelpTab(tab);
  }

  function closeSettingsHelpModal() {
    $("settingsHelpModal").classList.add("hidden");

    // If this was an intro-open, mark it seen when the user dismisses it
    if (state.ui.settingsHelpFromIntro) {
      state.settings.seenIntro = true;
      savePersisted();
      state.ui.settingsHelpFromIntro = false;
    }
  }

  function selectSettingsHelpTab(tab) {
    const isHelp = tab === "help";

    $("settingsTabBtn").classList.toggle("active", !isHelp);
    $("helpTabBtn").classList.toggle("active", isHelp);

    $("settingsTabBtn").setAttribute("aria-selected", String(!isHelp));
    $("helpTabBtn").setAttribute("aria-selected", String(isHelp));

    $("settingsTabPanel").classList.toggle("hidden", isHelp);
    $("helpTabPanel").classList.toggle("hidden", !isHelp);

    $("settingsHelpTitle").textContent = isHelp ? "Help" : "Settings";
  }

  function openHelpTo(sectionId) {
    openSettingsHelpModal("help");
    // ensure Help tab is active even if modal was already open
    selectSettingsHelpTab("help");

    // scroll to section (after layout)
    requestAnimationFrame(() => {
      const scroller = $("settingsHelpScroll");
      const target = $(sectionId);
      if (!scroller || !target) return;

      // scroll so the header sits near the top of the scroll area
      const top = target.offsetTop - 12;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }

  function focusCustomModalInput() {
    if (!state.ui.customModalOpen) return;
    const inp = $("customModalInput");
    // small defer helps on iOS after taps
    setTimeout(() => inp.focus(), 0);
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  function onCustomModalKeydown(e) {
    const k = e.key;

    if (k === "Escape") {
      e.preventDefault();
      closeCustomModal();
      return;
    }

    if (k === "Backspace") {
      e.preventDefault();
      state.ui.customModalWord = state.ui.customModalWord.slice(0, -1);
    } else if (k === "Enter") {
      // Phase 1: only allow if 5 letters (Phase 2 adds wordlist + hard mode validation)
      if (!$("customModalSubmitBtn").disabled) {
        e.preventDefault();
        $("customModalSubmitBtn").click();
        return;
      }
    } else if (k.length === 1) {
      // filter illegal characters at the keydown level
      if (!/^[a-zA-Z]$/.test(k)) {
        e.preventDefault();
        flashCustomModal();
        setCustomModalStatus("Letters only (A–Z).");
        return;
      }

      if (state.ui.customModalWord.length >= 5) {
        e.preventDefault();
        flashCustomModal();
        return;
      }

      e.preventDefault();
      state.ui.customModalWord += k.toUpperCase();
    } else {
      // ignore other keys (arrows, tab, etc.)
      return;
    }

    renderCustomModalWord();

    if (state.ui.customModalWord.length < 5) {
      $("customModalSubmitBtn").disabled = true;
      setCustomModalStatus("Enter 5 letters");
    } else {
      const v = validateCustomModalWord(state.ui.customModalWord);
      $("customModalSubmitBtn").disabled = !v.ok;
      setCustomModalStatus(v.msg);
      if (!v.ok) flashCustomModal();
    }
  }

  function onHardModeToggleChange(e) {
    const next = !!e.target.checked;

    applySettingWithResetConfirm({
      key: "hardMode",
      next,
      resetMsg: "Changing Hard Mode will reset the current session. Continue?",
      onCancelRevert: () => {
        e.target.checked = state.settings.hardMode; // snap back
      },
    });
  }

  function onStrictModeToggleChange(e) {
    const next = !!e.target.checked;

    applySettingWithResetConfirm({
      key: "strictMode",
      next,
      resetMsg: "Changing Strict Solver will reset the current session. Continue?",
      onCancelRevert: () => {
        e.target.checked = state.settings.strictMode;
      },
    });
  }

  function onTileClick(e) {
    // tile tapping cycles states (unless locked)
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const idx = Number(tile.dataset.idx);
    const isLocked = state.settings.hardMode && !!state.lockedGreens[idx];
    if (isLocked) return;

    // If user taps an empty tile, pop the custom modal (like hitting Custom)
    const ch = state.currentWord[idx];
    if (ch === "_" || ch === " ") {
      if (!state.ui?.customModalOpen) openCustomModal();
      return;
    }

    // Only allow marking when there is a full 5-letter word
    if (!/^[A-Z]{5}$/.test(state.currentWord)) return;

    const cur = state.currentPattern[idx] || 0;
    const next = (cur + 1) % 3; // 0->1->2->0
    state.currentPattern[idx] = next;

    // if this was a required letter, any tap likely fixes it; if all fixed, hide msg
    hideHardModeInlineMessageIfValid();
    renderEntry();
  }

  function onSubmitClick() {
    if (isSubmitAllowed()) {
      submitTurn();
    } else {
      // Disabled click fallback (some browsers won't fire if disabled;
      // we also capture pointer down below).
    }
  }

  function onSubmitPointerDown(e) {
    if (!$("submitBtn").disabled) return;

    const missing = listMissingRequiredLetters();
    if (missing.length === 0) return;

    // Make urgent, shake only neutral-required tiles
    state.ui.hardMsgUrgent = true;

    // shake tiles that need fixing
    const tiles = [...$("grid").querySelectorAll(".tile")];
    for (let i = 0; i < 5; i++) {
      const ch = state.currentWord[i]?.trim();
      const st = state.currentPattern[i] || 0;
      const locked = state.settings.hardMode && !!state.lockedGreens[i];
      if (!ch || locked) continue;
      if (state.minCounts.has(ch.toLowerCase()) && st === 0) {
        tiles[i].classList.remove("tilt");
        // retrigger
        void tiles[i].offsetWidth;
        tiles[i].classList.add("tilt");
      }
    }

    // show inline message
    showHardModeInlineMessage(missing);
    renderEntry();
  }

  function onSortLikelihoodClick() {
    state.settings.rankMode = "common";
    savePersisted();
    applyRankModeToUI();
    renderResults(true);
  }

  function onSortInfoClick() {
    if (state.ui.resultsMode === "starters") return;
    state.settings.rankMode = "probe";
    savePersisted();
    applyRankModeToUI();
    renderResults(true);
  }

  function resetHandler(msg) {
    if (!msg) {
      msg = state.history.length ? "Restart and clear the current session?" : "Start a new session?";
    }
    if (confirm(msg)) {
      resetSession();
      closeSettings();
    }
  }

  function solvedNoBtnHandler() {
    // Back to entry, let them correct; keep current empty so they select again
    showEntry();
    renderEntry();
  }

  function solvedYesBtnHandler() {
    // Auto-fill greens for the final word as a friendly “wrap”
    if (state.candidates.length !== 1) return;
    setCurrentWord(state.candidates[0].toUpperCase());
    state.currentPattern = [2, 2, 2, 2, 2];
    burstConfetti();
    renderEntry();
  }

  function onStarterWordInput(e) {
    const v = normalizeWord(e.target.value)
      .replace(/[^a-z]/g, "")
      .slice(0, 5)
      .toUpperCase();
    e.target.value = v;
  }

  function onStarterWordCommit(e) {
    const v = (e.target.value || "").trim().toUpperCase();
    state.settings.starterWord = v;
    savePersisted();

    // If we're on turn 0, refresh the pill list immediately
    if (state.ui.view === "entry" && state.history.length === 0) {
      renderEntry();
    }

    // If user is currently viewing the starters results page, refresh that too
    if (state.ui.view === "results" && state.ui.resultsMode === "starters") {
      showResults("starters");
    }
  }

  function onCloseExplainClick() {
    $("explainModal").classList.add("hidden");
  }

  let historyModalIdx = null;
  let historyRestoreArmed = false;

  function onHistoryRestoreClick() {
    const btn = $("historyRestoreBtn");
    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;

    // If this is the current turn, do nothing.
    if (idx === state.history.length - 1) return;

    if (!historyRestoreArmed) {
      historyRestoreArmed = true;
      btn.textContent = "Tap again to confirm";
      $("historyModalBody").textContent = "This will discard all guesses after this turn.";
      return;
    }

    // Confirmed (second tap)
    restoreToHistoryIndex(idx);
    closeHistoryModal();
  }

  function openHistoryModal(idx) {
    if (idx === state.history.length - 1) {
      $("historyRestoreBtn").disabled = true;
      $("historyModalBody").textContent = "This is the current turn.";
      return;
    }
    historyModalIdx = idx;

    const turn = state.history[idx];
    if (!turn) return;

    $("historyModalTitle").textContent = `Turn ${idx + 1}`;
    $("historyModalWord").textContent = (turn.word || "").toUpperCase();

    // Render mini tiles for the pattern
    const patWrap = $("historyModalPattern");
    patWrap.innerHTML = "";
    const upper = (turn.word || "").toUpperCase();

    for (let i = 0; i < 5; i++) {
      const t = document.createElement("div");
      t.className = `tile histTile state${turn.pattern?.[i] ?? 0}`;
      t.textContent = upper[i] || " ";
      patWrap.appendChild(t);
    }

    // Phase I: just show candidates-after count in modal body (computed safely by replay)
    const n = candidatesAfterTurn(idx);
    $("historyModalBody").textContent = `${n.toLocaleString()} candidates remaining after this guess.`;

    $("historyRestoreBtn").disabled = false;
    $("historyRestoreBtn").dataset.idx = String(idx);

    historyRestoreArmed = false;

    const restoreBtn = $("historyRestoreBtn");
    restoreBtn.dataset.idx = String(idx);
    restoreBtn.disabled = idx === state.history.length - 1;
    restoreBtn.textContent = "Restore to this point";

    $("historyModal").classList.remove("hidden");
  }

  function closeHistoryModal() {
    historyModalIdx = null;
    historyRestoreArmed = false;

    $("historyRestoreBtn").textContent = "Restore to this point";
    $("historyModalBody").textContent =
      `${candidatesAfterTurn(historyModalIdx).toLocaleString()} candidates remaining after this guess.`;

    $("historyModal").classList.add("hidden");
  }

  function onHistoryModalBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    closeHistoryModal();
  }

  function candidatesAfterTurn(targetIdx) {
    // Replay filtering on the full word list through targetIdx
    // This matches your renderHistory() logic and avoids snapshots.
    let pool = state.words.slice();

    for (let i = 0; i <= targetIdx; i++) {
      const turn = state.history[i];
      pool = pool.filter((candidate) => {
        const fb = feedback(turn.word, candidate);
        return patternKey(fb) === patternKey(turn.pattern);
      });
    }

    return pool.length;
  }

  function onSettingsModalBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    closeSettings();
  }

  function onExplainModalBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    $("explainModal").classList.add("hidden");
  }

  function closeCustomModalOnOverlayClick(e) {
    if (e.target.id === "customModalOverlay") closeCustomModal();
  }

  function onCustomModalSubmit() {
    const word = state.ui.customModalWord;

    if (word.length !== 5) return;

    // save starter (Phase 3 will dedupe + persist list)
    if ($("customModalSaveStarterChk").checked) {
      state.settings.starterWord = word;
      savePersisted();
      $("starterWordSetting").value = state.settings.starterWord;
    }

    const v = validateCustomModalWord(word);
    if (!v.ok) {
      setCustomModalStatus(v.msg);
      flashCustomModal();
      return;
    }

    closeCustomModal();
    setCurrentWord(word);
  }

  function onHardModeMsgClick() {
    openHelpTo("helpHardMode");
  }

  function onModeChipClick() {
    const next = !state.settings.hardMode;

    applySettingWithResetConfirm({
      key: "hardMode",
      next,
      resetMsg: "Changing Hard/Normal will reset the current session. Continue?",
    });
  }

  function onStrictChipClick() {
    const next = !state.settings.strictMode;

    applySettingWithResetConfirm({
      key: "strictMode",
      next,
      resetMsg: "Changing Strict/Relaxed will reset the current session. Continue?",
    });
  }

  const onRestartClick = () => resetHandler("Restart the game?");
  const onResetClick = () => resetHandler("Reset the current session?");

  // ============================================================================
  // EVENT WIRING
  // ============================================================================

  function wireEvents() {
    $("grid").addEventListener("click", onTileClick);
    $("enterOwnWordBtn").addEventListener("click", openCustomModal);
    $("submitBtn").addEventListener("click", onSubmitClick);
    $("submitBtn").addEventListener("pointerdown", onSubmitPointerDown);
    $("hardModeMsg").addEventListener("click", onHardModeMsgClick);
    $("hardModeMsg").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") onHardModeMsgClick();
    });
    $("backBtn").addEventListener("click", showEntry);
    $("sortLikelihood").addEventListener("click", onSortLikelihoodClick);
    $("sortInfo").addEventListener("click", onSortInfoClick);
    $("solvedYesBtn").addEventListener("click", solvedYesBtnHandler);
    $("solvedNoBtn").addEventListener("click", solvedNoBtnHandler);
    $("resetBtn").addEventListener("click", onResetClick);
    $("resetBtn2").addEventListener("click", onResetClick);
    $("hardModeToggle").addEventListener("change", onHardModeToggleChange);
    $("strictModeToggle").addEventListener("change", onStrictModeToggleChange);
    $("settingsBtn").addEventListener("click", () => openSettingsHelpModal("settings"));
    $("helpBtn").addEventListener("click", () => openHelpTo("helpIntro"));
    $("settingsHelpDoneBtn").addEventListener("click", closeSettingsHelpModal);
    $("settingsTabBtn").addEventListener("click", () => selectSettingsHelpTab("settings"));
    $("helpTabBtn").addEventListener("click", () => selectSettingsHelpTab("help"));
    $("manageStartersFromSettingsBtn")?.addEventListener("click", onManageStartersFromSettingsClick);
    $("historyRestoreBtn").addEventListener("click", onHistoryRestoreClick);
    $("closeHistoryBtn").addEventListener("click", closeHistoryModal);
    $("closeHistoryBtnX").addEventListener("click", closeHistoryModal);
    $("historyModal").addEventListener("click", onHistoryModalBackdropClick);
    $("customModalX").addEventListener("click", closeCustomModal);
    $("customModalCancelBtn").addEventListener("click", closeCustomModal);
    $("customModalOverlay").addEventListener("click", closeCustomModalOnOverlayClick);
    $("customModalInput").addEventListener("keydown", onCustomModalKeydown);
    $("customModalSubmitBtn").addEventListener("click", onCustomModalSubmit);
    $("customModalClearBtn").addEventListener("click", clearCustomModal);
    $("customModalCard").addEventListener("pointerdown", focusCustomModalInput);
    $("customModalCard").addEventListener("click", focusCustomModalInput);
    $("customModalSaveStarterChk").addEventListener("change", focusCustomModalInput);
    $("manageStartersFromSettingsBtn")?.addEventListener("click", openManageStartersModal);
    $("manageStartersFromMoreBtn")?.addEventListener("click", openManageStartersModal);
    // Manage starters overlay
    $("starterAddInput").addEventListener("input", onStarterAddInput);
    $("starterAddBtn").addEventListener("click", onStarterAdd);
    $("starterAddInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onStarterAdd();
      }
    });

    $("starterSortBtn").addEventListener("click", onStarterSort);
    $("starterRestoreBtn").addEventListener("click", onStarterRestoreDefaults);

    $("manageStartersCancelBtn").addEventListener("click", closeManageStartersModal);
    $("manageStartersSaveBtn").addEventListener("click", onManageStartersSave);

    $("modeChip").addEventListener("click", onModeChipClick);
    $("strictChip").addEventListener("click", onStrictChipClick);
    $("hardHelpBtn").addEventListener("click", () => openHelpTo("helpHardMode"));
    $("strictHelpBtn").addEventListener("click", () => openHelpTo("helpStrictMode"));

    // Disable pinch-to-zoom on iOS Safari
    document.addEventListener("gesturestart", (e) => e.preventDefault(), {
      passive: false,
    });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), {
      passive: false,
    });
    document.addEventListener("gestureend", (e) => e.preventDefault(), {
      passive: false,
    });
  }

  // ============================================================================
  // BOOT / INIT
  // ============================================================================

  async function loadWords() {
    try {
      const res = await fetch(WORDSCORES_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // data is: { "crane": { commonScore: 3.92, probeScore: 12.34 }, ... }
      // Keep it robust: only accept valid 5-letter keys.
      const words = Object.keys(data)
        .map((w) => normalizeWord(w))
        .filter(isWord);

      state.wordScores = data;
      state.words = words;
      state.wordSet = new Set(state.words);
    } catch (err) {
      console.warn("wordScores.json fetch failed; using fallback list only.", err);
      state.wordScores = {};
      state.words = CURATED_STARTERS.map((w) => w.toLowerCase());
      state.wordSet = new Set(state.words);
    }

    state.candidates = state.words.slice();
  }

  async function init() {
    loadPersisted();
    ensureGrid();
    wireEvents();

    await loadWords();
    resetSession(); // also renders
    //state.ui.startersRevealed = state.settings.showStartersAlways;
    renderEntry();
    if (!state.settings.seenIntro) {
      openSettingsHelpModal("help", { fromIntro: true });
    }
  }

  init();
})();
