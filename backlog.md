# Wordle Wizard – Backlog

This backlog tracks confirmed follow-up work and known improvements.
Items are ordered roughly by immediacy, not priority guarantees.
Completed items have been removed to keep this actionable.

---

## Starter Manager

- **Drag-to-reorder via handle (deferred)**
  - Add a dedicated drag handle per starter row (hamburger-style)
  - Touch-first interaction that does not interfere with scrolling
  - Reordering affects staged list only
  - Commit order on drop
  - Keep up/down arrows as fallback (at least initially)
  - Auto-scroll list when dragging near edges (stretch goal)

- **Pin Restore Defaults (follow-up polish)**
  - Already moved next to Sort A–Z
  - Consider further visual refinement once drag reorder exists
  - No functional changes needed

---

## Settings & Navigation

- **Convert Settings to full-page / full-viewport UI**
  - Modal-style, but covers entire viewport
  - Align visual language with Starter Manager (mode-based UI)
  - Likely becomes the pattern for other “manager” screens

---

## UX / Onboarding

- **Lightweight onboarding / help screen**
  - Accessed via `(?)` or Settings
  - High-level explanation of:
    - overall flow
    - Hard vs Strict modes
    - expectations (helper, not guaranteed solver)
  - No per-control tooltips

- **Context-aware help copy refinement**
  - Already implemented for Suggestions (first turn vs later turns)
  - Apply same principle elsewhere if needed

---

## Interactive History (Phase II)

- **History UX polish**
  - Improve affordance for tappable history rows
  - Optional animation or feedback on restore
  - Review restore-to-current behavior (no-op vs reapply)

---

## Mobile UX (Known / Deferred)

- **Occasional iOS Safari overscroll / viewport drift**
  - Intermittent, not reliably reproducible
  - Likely related to dynamic viewport units or address bar state
  - Revisit only if it becomes persistent

- **Add-to-Home-Screen caching quirks (iOS)**
  - Aggressive asset caching
  - Current workaround: test via Safari
  - Revisit later if publishing publicly

---

## Naming / Distribution (Optional, Future)

- **Decide final public name**
  - “Wordle Wizard” currently feels strong and intentional
  - Re-evaluate only if publishing or sharing widely

- **Basic README / landing copy**
  - One-paragraph explanation of what the app is and isn’t
  - Useful if shared beyond personal use
