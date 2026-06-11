Wordlemetry# Wordlemetry

Wordlemetry is a mobile-first web app designed to help you play **Wordle more thoughtfully and efficiently**.  
It does not play the game for you — it helps you _reason_ through it.

The app tracks your guesses and feedback, applies Wordle’s rules correctly (including Hard and Strict modes), and suggests strong next guesses based on what you already know.

---

## What Wordlemetry Does

- Suggests high-quality next guesses based on:
  - known green/yellow/gray letters
  - duplicate-letter constraints
  - Wordle’s hard mode rules (when enabled)
- Helps you:
  - reduce the candidate list efficiently
  - avoid illegal guesses in Hard / Strict mode
  - reason about information gain, not just luck
- Supports a curated and customizable list of **starter words**
- Keeps a full **interactive history** of your guesses

This is a **thinking aid**, not an answer oracle.

---

## Modes

- **Normal**
  - Suggestions respect known information but allow flexibility
- **Hard**
  - All known constraints must be honored
- **Strict**
  - Enforces the tightest interpretation of Hard Mode rules

Modes affect **suggestions only** — Wordlemetry never alters your actual guesses or history.

---

## How to Use

1. Enter a guess (or select a suggested starter).
2. Tap letters to mark them:
   - Green = correct letter, correct position
   - Yellow = correct letter, wrong position
   - Gray = letter not in the word
3. Submit the turn.
4. Review suggestions for your next guess.
5. Repeat until solved (or not — that’s Wordle).

On the first turn, the app shows starter suggestions.  
After that, suggestions update dynamically based on your input.

---

## Starter Manager

You can manage your list of starter words:

- Add, remove, reorder, or sort starters
- Restore defaults at any time
- Changes are staged until you explicitly save
- A maximum of 15 starters is enforced

Starter words affect **suggestions only** — they never affect history or rule enforcement.

---

## What This App Is _Not_

- It does **not** guarantee a win
- It does **not** know the “correct” Wordle answer
- It does **not** scrape or use NYT’s answer list
- It does **not** automatically play Wordle for you

Wordlemetry works the way a careful human would — just faster and more consistently.

---

## Tech Notes

- Vanilla JavaScript, HTML, and CSS
- No frameworks
- Mobile-first design
- State persisted locally (no server, no tracking)

---

## Philosophy

Wordlemetry exists to make Wordle **more interesting**, not less.

Good Wordle play is about:

- managing constraints
- reasoning under uncertainty
- making informed trade-offs

This app helps with those parts — the fun parts are still yours.
