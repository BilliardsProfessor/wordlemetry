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
    {
      name: "coverage: identical candidates share one pattern",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("crane", ["crane", "crane"]);
        expectEqual(result.patternCount, 1);
        expectArrayEqual(result.buckets["22222"], ["crane", "crane"]);
      },
    },
    {
      name: "coverage: distinct feedback patterns are counted",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("crane", ["crane", "trace", "slate", "crony"]);
        expectEqual(result.candidateCount, 4);
        expectEqual(result.patternCount, 4);
      },
    },
    {
      name: "coverage: rankCoverage sorts by pattern count",
      run: () => {
        const ranked = window.WordlemetryDiagnostics.rankCoverage(["crane", "slate"], ["crane", "trace", "slate", "crony"]);

        expectEqual(ranked[0].guess, "crane");
        expectEqual(ranked[0].patternCount >= ranked[1].patternCount, true);
      },
    },
    {
      name: "coverage: reports bucket stats",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("adieu", ["crane", "trace", "slate", "crony"]);

        expectEqual(result.candidateCount, 4);
        expectEqual(result.patternCount, 2);
        expectEqual(result.largestBucketSize, 3);
        expectEqual(result.averageBucketSize, 2);
      },
    },
    {
      name: "coverage: rankCoverage breaks ties by smaller largest bucket",
      run: () => {
        const ranked = window.WordlemetryDiagnostics.rankCoverage(["adieu", "zzzzz"], ["crane", "trace", "slate", "crony"]);

        expectEqual(ranked[0].guess, "adieu");
        expectEqual(ranked[0].patternCount, 2);
        expectEqual(ranked[0].largestBucketSize, 3);
        expectEqual(ranked[1].largestBucketSize, 4);
      },
    },
    {
      name: "entropy: single bucket has zero entropy",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("zzzzz", ["crane", "trace", "slate", "crony"]);

        expectEqual(result.entropyBits, 0);
      },
    },
    {
      name: "entropy: four even buckets produce two bits",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("crane", ["crane", "trace", "slate", "crony"]);

        expectEqual(result.entropyBits, 2);
      },
    },
    {
      name: "entropy: uneven buckets produce less than even split",
      run: () => {
        const result = window.WordlemetryDiagnostics.coverage("adieu", ["crane", "trace", "slate", "crony"]);

        expectEqual(result.entropyBits < 2, true);
        expectEqual(result.entropyBits > 0, true);
      },
    },
    {
      name: "entropy: rankEntropy sorts by entropy descending",
      run: () => {
        const ranked = window.WordlemetryDiagnostics.rankEntropy(["crane", "adieu"], ["crane", "trace", "slate", "crony"]);

        expectEqual(ranked[0].guess, "crane");
        expectEqual(ranked[0].entropyBits, 2);
        expectEqual(ranked[1].guess, "adieu");
      },
    },
    {
      name: "metrics: rankMetrics includes combined bucket and entropy stats",
      run: () => {
        const ranked = window.WordlemetryDiagnostics.rankMetrics(["crane", "adieu"], ["crane", "trace", "slate", "crony"]);

        expectEqual(ranked[0].guess, "crane");
        expectEqual(ranked[0].candidateCount, 4);
        expectEqual(ranked[0].entropyBits, 2);
        expectEqual(ranked[0].patternCount, 4);
        expectEqual(ranked[0].largestBucketSize, 1);
        expectEqual(ranked[0].averageBucketSize, 1);
      },
    },

    {
      name: "trap detection: identifies single-position candidate family",
      run: () => {
        const result = window.WordlemetryDiagnostics.analyzeTrapGroup(["batch", "catch", "hatch", "match", "patch", "watch"]);

        expectEqual(result.candidateCount, 6);
        expectEqual(result.variablePositionCount, 1);
        expectEqual(result.variablePositions.length, 1);
        expectEqual(result.variablePositions[0].index, 0);
        expectEqual(result.variablePositions[0].count, 6);
        expectArrayEqual(result.variablePositions[0].letters, ["b", "c", "h", "m", "p", "w"]);
        expectEqual(result.isLikelyTrap, true);
      },
    },
    {
      name: "trap detection: does not flag broad mixed candidate family",
      run: () => {
        const result = window.WordlemetryDiagnostics.analyzeTrapGroup(["crane", "trace", "slate", "crony"]);

        expectEqual(result.candidateCount, 4);
        expectEqual(result.variablePositionCount > 2, true);
        expectEqual(result.isLikelyTrap, false);
      },
    },
    {
      name: "trap breakers: ranks guesses by trap-letter coverage",
      run: () => {
        const ranked = window.WordlemetryDiagnostics.rankTrapBreakers(
          ["batch", "catch", "hatch", "match", "patch", "watch"],
          ["crane", "chimp", "bumpy", "adieu"],
        );

        expectEqual(ranked[0].guess, "chimp");
        expectEqual(ranked[0].trapLettersCovered, 4);
        expectArrayEqual(ranked[0].coveredTrapLetters, ["c", "h", "m", "p"]);

        expectEqual(ranked[1].guess, "bumpy");
        expectEqual(ranked[1].trapLettersCovered, 3);
        expectArrayEqual(ranked[1].coveredTrapLetters, ["b", "m", "p"]);
      },
    },
    {
      name: "trap breakers: playable ranking filters illegal guesses",
      run: () => {
        withTemporaryHistory([{ word: "crane", pattern: [2, 0, 0, 0, 0] }], () => {
          deriveHardConstraintsFromHistory();

          withTemporarySettings({ hardMode: true, strictMode: false }, () => {
            const ranked = window.WordlemetryDiagnostics.rankPlayableTrapBreakers(["couch", "catch", "caddy", "cabin"], ["touch", "couch"]);

            expectEqual(ranked.length, 1);
            expectEqual(ranked[0].guess, "couch");
          });
        });
      },
    },
    {
      name: "trap breakers: includes trap-specific bucket metrics",
      run: () => {
        const trapCandidates = ["batch", "catch", "hatch", "match", "patch", "watch"];
        const ranked = window.WordlemetryDiagnostics.rankTrapBreakers(trapCandidates, ["chimp", "adieu"]);
        const coverage = window.WordlemetryDiagnostics.coverage(ranked[0].guess, trapCandidates);

        expectEqual(ranked[0].guess, "chimp");
        expectEqual(ranked[0].trapCandidateCount, 6);
        expectEqual(ranked[0].trapPatternCount, coverage.patternCount);
        expectEqual(ranked[0].trapLargestBucketSize, coverage.largestBucketSize);
        expectEqual(ranked[0].trapAverageBucketSize, roundMetric(coverage.averageBucketSize));
        expectEqual(ranked[0].trapEntropyBits, roundMetric(coverage.entropyBits));
      },
    },
    {
      name: "trap breakers: current candidate ranking uses live candidate pool",
      run: () => {
        const previousCandidates = state.candidates;

        try {
          state.candidates = ["batch", "catch", "hatch", "match", "patch", "watch"];

          const ranked = window.WordlemetryDiagnostics.rankCurrentTrapBreakers(["chimp", "adieu"]);

          expectEqual(ranked[0].guess, "chimp");
          expectEqual(ranked[0].trapCandidateCount, 6);
          expectEqual(ranked[0].isLikelyTrap, true);
        } finally {
          state.candidates = previousCandidates;
        }
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

    coverage(guess, candidates) {
      const buckets = buildCoverageBuckets(guess, candidates);
      const stats = getBucketStats(buckets);
      const entropyBits = getEntropyBits(buckets, candidates.length);

      return {
        guess: normalizeWord(guess),
        candidateCount: candidates.length,
        patternCount: Object.keys(buckets).length,
        largestBucketSize: stats.largestBucketSize,
        averageBucketSize: stats.averageBucketSize,
        entropyBits,
        buckets,
      };
    },

    rankCoverage(guesses, candidates) {
      return guesses
        .map((guess) => {
          const result = this.coverage(guess, candidates);
          return {
            guess: result.guess,
            candidateCount: result.candidateCount,
            patternCount: result.patternCount,
            largestBucketSize: result.largestBucketSize,
            averageBucketSize: result.averageBucketSize,
          };
        })
        .sort((a, b) => b.patternCount - a.patternCount || a.largestBucketSize - b.largestBucketSize || a.guess.localeCompare(b.guess));
    },

    rankEntropy(guesses, candidates) {
      return guesses
        .map((guess) => {
          const result = this.coverage(guess, candidates);

          return {
            guess: result.guess,
            candidateCount: result.candidateCount,
            entropyBits: result.entropyBits,
            patternCount: result.patternCount,
            largestBucketSize: result.largestBucketSize,
            averageBucketSize: result.averageBucketSize,
          };
        })
        .sort(
          (a, b) =>
            b.entropyBits - a.entropyBits || b.patternCount - a.patternCount || a.largestBucketSize - b.largestBucketSize || a.guess.localeCompare(b.guess),
        );
    },

    rankMetrics(guesses, candidates) {
      return guesses
        .map((guess) => {
          const result = this.coverage(guess, candidates);

          return {
            guess: result.guess,
            candidateCount: result.candidateCount,
            entropyBits: roundMetric(result.entropyBits),
            patternCount: result.patternCount,
            largestBucketSize: result.largestBucketSize,
            averageBucketSize: roundMetric(result.averageBucketSize),
          };
        })
        .sort(
          (a, b) =>
            b.entropyBits - a.entropyBits || b.patternCount - a.patternCount || a.largestBucketSize - b.largestBucketSize || a.guess.localeCompare(b.guess),
        );
    },

    checkPlayable(guesses) {
      return guesses.map((guess) => {
        const word = normalizeWord(guess);

        return {
          guess: word,
          playable: validateDiagnosticGuess(word),
        };
      });
    },

    rankPlayableMetrics(guesses, candidates) {
      const playableGuesses = this.checkPlayable(guesses)
        .filter((entry) => entry.playable)
        .map((entry) => entry.guess);

      return this.rankMetrics(playableGuesses, candidates);
    },

    analyzeTrapGroup(candidates) {
      const words = candidates.map(normalizeWord);
      const width = words[0]?.length || 0;

      const variablePositions = [];

      for (let i = 0; i < width; i += 1) {
        const letters = new Set(words.map((word) => word[i]));

        if (letters.size > 1) {
          variablePositions.push({
            index: i,
            letters: [...letters].sort(),
            count: letters.size,
          });
        }
      }

      return {
        candidateCount: words.length,
        variablePositionCount: variablePositions.length,
        variablePositions,
        isLikelyTrap: words.length >= 4 && variablePositions.length <= 2,
      };
    },
    rankTrapBreakers(trapCandidates, guesses) {
      const trap = this.analyzeTrapGroup(trapCandidates);
      const trapLetters = new Set(trap.variablePositions.flatMap((position) => position.letters));

      return guesses
        .map((guess) => {
          const word = normalizeWord(guess);
          const uniqueLetters = new Set(word);
          const coveredTrapLetters = [...trapLetters].filter((letter) => uniqueLetters.has(letter)).sort();
          const coverage = this.coverage(word, trapCandidates);

          return {
            guess: word,
            trapCandidateCount: trap.candidateCount,
            trapVariablePositionCount: trap.variablePositionCount,
            trapLettersCovered: coveredTrapLetters.length,
            coveredTrapLetters,
            trapPatternCount: coverage.patternCount,
            trapLargestBucketSize: coverage.largestBucketSize,
            trapAverageBucketSize: roundMetric(coverage.averageBucketSize),
            trapEntropyBits: roundMetric(coverage.entropyBits),
            isLikelyTrap: trap.isLikelyTrap,
          };
        })
        .sort(
          (a, b) =>
            b.trapLettersCovered - a.trapLettersCovered ||
            b.trapEntropyBits - a.trapEntropyBits ||
            b.trapPatternCount - a.trapPatternCount ||
            a.trapLargestBucketSize - b.trapLargestBucketSize ||
            a.guess.localeCompare(b.guess),
        );
    },

    rankPlayableTrapBreakers(trapCandidates, guesses) {
      const playableGuesses = this.checkPlayable(guesses)
        .filter((entry) => entry.playable)
        .map((entry) => entry.guess);

      return this.rankTrapBreakers(trapCandidates, playableGuesses);
    },
    rankCurrentTrapBreakers(guesses) {
      return this.rankPlayableTrapBreakers(state.candidates, guesses);
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

  function buildCoverageBuckets(guess, candidates) {
    const normalizedGuess = normalizeWord(guess);
    const buckets = {};

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeWord(candidate);
      const key = patternKey(feedback(normalizedGuess, normalizedCandidate));

      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(normalizedCandidate);
    }

    return buckets;
  }
  function getBucketStats(buckets) {
    const sizes = Object.values(buckets).map((bucket) => bucket.length);

    if (sizes.length === 0) {
      return {
        largestBucketSize: 0,
        averageBucketSize: 0,
      };
    }

    const largestBucketSize = Math.max(...sizes);
    const total = sizes.reduce((sum, size) => sum + size, 0);

    return {
      largestBucketSize,
      averageBucketSize: total / sizes.length,
    };
  }

  function getEntropyBits(buckets, candidateCount) {
    if (candidateCount === 0) return 0;

    let entropyBits = 0;

    for (const bucket of Object.values(buckets)) {
      const probability = bucket.length / candidateCount;
      entropyBits += -probability * Math.log2(probability);
    }

    return entropyBits;
  }

  function roundMetric(value) {
    return Math.round(value * 1000) / 1000;
  }
})();
