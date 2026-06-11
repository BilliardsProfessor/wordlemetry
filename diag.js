// diag.js
(() => {
  const api = window.WordlemetryDebug;

  if (!api) {
    console.warn("Wordlemetry diagnostics could not start: debug API unavailable.");
    return;
  }

  const {
    state,
    feedback,
    patternKey,
    patternEquals,
    normalizeWord,
    candidatesFromHistory,
    deriveHardConstraintsFromHistory,
    guessSatisfiesHardMode,
    guessSatisfiesStrictMode,
  } = api;

  const tests = [
    {
      name: "feedback: all green",
      run: () => expectPattern(feedback("crane", "crane"), [2, 2, 2, 2, 2]),
    },
    {
      name: "feedback: all gray",
      run: () => expectPattern(feedback("slate", "crony"), [0, 0, 0, 0, 0]),
    },
    {
      name: "feedback: single yellow",
      run: () => expectPattern(feedback("crane", "adieu"), [0, 0, 1, 0, 1]),
    },
    {
      name: "feedback: duplicate guess capped by answer count",
      run: () => expectPattern(feedback("eerie", "three"), [1, 0, 2, 0, 2]),
    },
    {
      name: "feedback: green consumes before yellow",
      run: () => expectPattern(feedback("allee", "apple"), [2, 1, 0, 0, 2]),
    },
    {
      name: "patternKey joins pattern digits",
      run: () => expectEqual(patternKey([0, 1, 2, 0, 2]), "01202"),
    },
    {
      name: "candidatesFromHistory keeps matching answers",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: feedback("crane", "trace") }], () => {
          const candidates = candidatesFromHistory(["trace", "slate", "crony"]);
          expectArrayEqual(candidates, ["trace"]);
        });
      },
    },
    {
      name: "hard mode: green position is locked",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 0, 0, 0, 0] }], () => {
          deriveHardConstraintsFromHistory();
          expectEqual(guessSatisfiesHardMode("couch"), true);
          expectEqual(guessSatisfiesHardMode("touch"), false);
        });
      },
    },
    {
      name: "hard mode: yellow position is forbidden",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [0, 1, 0, 0, 0] }], () => {
          deriveHardConstraintsFromHistory();
          expectEqual(guessSatisfiesHardMode("stare"), true);
          expectEqual(guessSatisfiesHardMode("brink"), false);
        });
      },
    },
    {
      name: "hard mode: duplicate minimum count is enforced",
      run: () => {
        withTemporaryHistory([{ word: "eerie", pattern: [1, 0, 0, 0, 2] }], () => {
          deriveHardConstraintsFromHistory();
          expectEqual(guessSatisfiesHardMode("crepe"), true);
          expectEqual(guessSatisfiesHardMode("table"), false);
        });
      },
    },
    {
      name: "normal mode: allows ignoring prior green",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 0, 0, 0, 0] }], () => {
          deriveHardConstraintsFromHistory();

          withTemporarySettings({ hardMode: false }, () => {
            expectEqual(validateDiagnosticGuess("touch"), true);
          });
        });
      },
    },
    {
      name: "hard mode: rejects ignoring prior green",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 0, 0, 0, 0] }], () => {
          deriveHardConstraintsFromHistory();

          withTemporarySettings({ hardMode: true }, () => {
            expectEqual(validateDiagnosticGuess("touch"), false);
          });
        });
      },
    },
    {
      name: "relaxed mode: allows gray letter reuse",
      run: () => {
        withTemporaryHistory([{ word: "slate", pattern: [0, 0, 0, 0, 0] }], () => {
          withTemporarySettings({ strictMode: false }, () => {
            expectEqual(validateDiagnosticGuess("crush"), true);
          });
        });
      },
    },
    {
      name: "strict mode: rejects gray letter reuse",
      run: () => {
        withTemporaryHistory([{ word: "slate", pattern: [0, 0, 0, 0, 0] }], () => {
          withTemporarySettings({ strictMode: true }, () => {
            expectEqual(validateDiagnosticGuess("crush"), false);
          });
        });
      },
    },
    {
      name: "candidate filtering: excludes inconsistent feedback",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 2, 2, 2, 2] }], () => {
          const candidates = candidatesFromHistory(["crane", "trace", "slate"]);
          expectArrayEqual(candidates, ["crane"]);
        });
      },
    },
    {
      name: "candidate filtering: handles duplicate guess letters",
      run: () => {
        withTemporaryHistory([{ word: "eerie", pattern: feedback("eerie", "three") }], () => {
          const candidates = candidatesFromHistory(["three", "there", "eerie"]);
          expectArrayEqual(candidates, ["three"]);
        });
      },
    },
    {
      name: "candidate filtering: handles duplicate answer letters",
      run: () => {
        withTemporaryHistory([{ word: "allee", pattern: feedback("allee", "apple") }], () => {
          const candidates = candidatesFromHistory(["apple", "allee", "ample"]);
          expectArrayEqual(candidates, ["apple", "ample"]);
        });
      },
    },
    {
      name: "candidate filtering: multi-turn narrowing",
      run: () => {
        withTemporaryHistory(
          [
            { word: "crane", pattern: feedback("crane", "trace") },
            { word: "slate", pattern: feedback("slate", "trace") },
          ],
          () => {
            const candidates = candidatesFromHistory(["trace", "crate", "slate", "crony"]);
            expectArrayEqual(candidates, ["trace"]);
          },
        );
      },
    },
    {
      name: "candidate filtering: impossible feedback returns empty",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 2, 2, 2, 1] }], () => {
          const candidates = candidatesFromHistory(["crane", "trace", "slate"]);
          expectArrayEqual(candidates, []);
        });
      },
    },
  ];

  window.WordlemetryDiagnostics = {
    run() {
      const results = [];

      console.group("Wordlemetry diagnostics");

      for (const test of tests) {
        try {
          test.run();
          results.push({ name: test.name, passed: true });
          console.log(`✓ ${test.name}`);
        } catch (err) {
          results.push({ name: test.name, passed: false, error: err });
          console.error(`✗ ${test.name}`, err);
        }
      }

      const passed = results.filter((result) => result.passed).length;
      const failed = results.length - passed;

      console.log(`${passed} passed, ${failed} failed`);
      console.groupEnd();

      return { passed, failed, results };
    },
  };

  console.info("Wordlemetry diagnostics enabled. Run WordlemetryDiagnostics.run() in the console.");

  function validateDiagnosticGuess(word) {
    const w = normalizeWord(word);

    if (state.settings.hardMode && !guessSatisfiesHardMode(w)) return false;
    if (state.settings.strictMode && !guessSatisfiesStrictMode(w)) return false;

    return true;
  }

  function withTemporaryHistory(history, fn) {
    const previousHistory = state.history;
    const previousLockedGreens = state.lockedGreens;
    const previousForbiddenPos = state.forbiddenPos;
    const previousMinCounts = state.minCounts;
    const previousRequiredLetters = state.requiredLetters;

    try {
      state.history = history.map((turn) => ({
        word: turn.word,
        pattern: turn.pattern.slice(),
      }));

      fn();
    } finally {
      state.history = previousHistory;
      state.lockedGreens = previousLockedGreens;
      state.forbiddenPos = previousForbiddenPos;
      state.minCounts = previousMinCounts;
      state.requiredLetters = previousRequiredLetters;
    }
  }

  function withTemporarySettings(settings, fn) {
    const previousSettings = { ...state.settings };

    try {
      state.settings = { ...state.settings, ...settings };
      fn();
    } finally {
      state.settings = previousSettings;
    }
  }

  function expectPattern(actual, expected) {
    if (patternEquals(actual, expected)) return;

    throw new Error(`Expected pattern ${expected.join("")}, got ${actual.join("")}`);
  }

  function expectEqual(actual, expected) {
    if (actual === expected) return;

    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }

  function expectArrayEqual(actual, expected) {
    if (actual.length !== expected.length) {
      throw new Error(`Expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
    }

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        throw new Error(`Expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
      }
    }
  }
})();
