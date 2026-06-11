#!/usr/bin/env python3
"""
Build word score JSON for the Wordle Helper.

Input:  one word per line (e.g., tabatkins/wordle-list 'words' file)
Output: JSON mapping word -> { commonScore, probeScore }

commonScore:
  - Uses wordfreq.zipf_frequency if wordfreq is installed (recommended)
  - Falls back to a heuristic score if not installed

probeScore:
  - Static "good probe" heuristic (not candidate-set-dependent)
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

WORD_RE = re.compile(r"^[a-z]{5}$")
VOWELS = set("aeiou")
# Roughly: common letters in Wordle-ish English (ETAOIN + friends)
LETTER_WEIGHTS = {
    "e": 1.30, "a": 1.20, "r": 1.15, "o": 1.10, "t": 1.08,
    "l": 1.05, "i": 1.03, "s": 1.02, "n": 1.01, "u": 0.98,
    "c": 0.95, "y": 0.92, "h": 0.90, "d": 0.88, "p": 0.85,
    "m": 0.83, "g": 0.80, "b": 0.78, "f": 0.75, "k": 0.70,
    "w": 0.68, "v": 0.60, "z": 0.45, "x": 0.42, "j": 0.38, "q": 0.30,
}


def load_words(path: Path) -> List[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    words = []
    for line in text.splitlines():
        w = line.strip().lower()
        if WORD_RE.match(w):
            words.append(w)
    # De-dupe while preserving order
    seen = set()
    out = []
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def build_letter_stats(words: List[str]) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Returns:
      letter_logfreq: letter -> log-scaled frequency weight
      bigram_logfreq: bigram -> log-scaled frequency weight
    These are computed from the allowed-guesses list itself (heuristic fallback).
    """
    letter_counts = Counter()
    bigram_counts = Counter()
    for w in words:
        letter_counts.update(w)
        for i in range(4):
            bigram_counts[w[i:i+2]] += 1

    # Smooth and log-scale so values don't blow up
    total_letters = sum(letter_counts.values()) or 1
    total_bigrams = sum(bigram_counts.values()) or 1

    letter_logfreq = {}
    for ch, cnt in letter_counts.items():
        p = (cnt + 1) / (total_letters + 26)  # add-1 smoothing
        letter_logfreq[ch] = math.log(p)

    bigram_logfreq = {}
    for bg, cnt in bigram_counts.items():
        p = (cnt + 1) / (total_bigrams + 26 * 26)
        bigram_logfreq[bg] = math.log(p)

    return letter_logfreq, bigram_logfreq


def probe_score(word: str) -> float:
    """
    Static "how good is this as a probe word?" score.
    Higher is better.
    """
    letters = list(word)
    uniq = set(letters)
    repeats = len(letters) - len(uniq)

    # Reward unique letters heavily (repeats reduce info early game)
    score = 0.0
    score += 2.2 * len(uniq)          # max 11.0
    score -= 1.6 * repeats            # penalize doubles/triples

    # Vowel coverage (2-3 vowels tends to feel "human useful")
    vcount = sum(1 for ch in uniq if ch in VOWELS)
    if vcount == 0:
        score -= 2.0
    elif vcount == 1:
        score += 0.5
    elif vcount == 2:
        score += 2.2
    elif vcount == 3:
        score += 2.0
    else:  # 4-5 vowels usually a weird probe
        score += 0.6

    # Favor generally common letters (rough weighting)
    for ch in uniq:
        score += LETTER_WEIGHTS.get(ch, 0.65)

    # Tiny bonus for "balanced" consonant/vowel mix
    ccount = len(uniq) - vcount
    score += 0.2 * (min(vcount, ccount))

    return score


def common_score_wordfreq(word: str) -> float | None:
    """
    Returns Zipf frequency if wordfreq is available, else None.
    Zipf scale: typically ~1 (rare) to ~7 (very common).
    """
    try:
        from wordfreq import zipf_frequency  # type: ignore
        return float(zipf_frequency(word, "en"))
    except Exception:
        return None


def common_score_heuristic(word: str, letter_logfreq: Dict[str, float], bigram_logfreq: Dict[str, float]) -> float:
    """
    Fallback commonness: based on how 'typical' the letter and bigram patterns
    are inside the allowed-guesses list itself.
    """
    # Sum log-probs (less negative == more typical)
    lp = 0.0
    for ch in word:
        lp += letter_logfreq.get(ch, math.log(1 / 26))
    for i in range(4):
        lp += bigram_logfreq.get(word[i:i+2], math.log(1 / (26 * 26)))

    # Convert to a nicer scale roughly resembling 0..10
    # (This is arbitrary but stable for sorting.)
    return 10.0 + (lp * 2.0)  # lp is negative; adds/subtracts around 10


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True, help="Input word list file (one word per line)")
    ap.add_argument("--out", dest="out_path", required=True, help="Output JSON path (e.g., data/wordScores.json)")
    ap.add_argument("--pretty", action="store_true", help="Pretty-print JSON (larger file)")
    args = ap.parse_args()

    in_path = Path(args.in_path)
    out_path = Path(args.out_path)

    words = load_words(in_path)
    if not words:
        raise SystemExit(f"No valid 5-letter words found in {in_path}")

    letter_logfreq, bigram_logfreq = build_letter_stats(words)

    scores: Dict[str, Dict[str, float]] = {}
    used_wordfreq = False

    for w in words:
        pscore = probe_score(w)

        wfreq = common_score_wordfreq(w)
        if wfreq is not None:
            used_wordfreq = True
            cscore = wfreq  # Zipf scale ~1..7
        else:
            cscore = common_score_heuristic(w, letter_logfreq, bigram_logfreq)

        scores[w] = {
            "commonScore": round(cscore, 4),
            "probeScore": round(pscore, 4),
        }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        out_path.write_text(json.dumps(scores, indent=2), encoding="utf-8")
    else:
        out_path.write_text(json.dumps(scores, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(scores)} words to {out_path}")
    print("commonScore source:", "wordfreq(zipf)" if used_wordfreq else "heuristic(letter/bigram)")
    if not used_wordfreq:
        print("Tip: pip install wordfreq  (optional) for better commonScore.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
