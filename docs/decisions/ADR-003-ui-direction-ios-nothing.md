# ADR-003 · UI direction: iOS × Nothing OS on charcoal, one red accent

- Status: proposed
- Date: 2026-11-25
- Deciders: human (owner), Claude (lead agent)
- Spec sections affected: docs/02, docs/design/00_IMAGE_PROMPTS.md; supersedes the palette in docs/archive/UIUX.md

## Context
The old `UIUX.md` used an amber machine-shop palette. The new spec pack defines charcoal surfaces, Geist / Geist Mono / Doto type, iOS grouped lists, and a single red accent `#D71921` used only for live state.

## Options
1. **Keep amber.** No restyle, but it contradicts the spec and the image prompts.
2. **Adopt docs/02 tokens.** Restyle every screen. The structure of the old spec (build cards, readout strip, viewport keys) carries over.

## Decision
Option 2. Tokens live only in `app/src/styles/tokens.css`. No new colours, fonts or radii without a docs/02 change.

## Consequences
- The mock-up main screen (branch `p0-ui-mockup`) is the first screen in the new direction.
- Signal that this was wrong: contrast test `UI-A11Y-02` fails for token pairs in use.
