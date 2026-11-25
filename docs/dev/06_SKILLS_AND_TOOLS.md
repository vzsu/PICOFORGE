# Dev 06 · Skills and tools for agents working on this repo

| Tool | What it is for here | Required? |
|---|---|---|
| codegraph | Code navigation and change impact (dev/05) | Yes |
| unslop | Audit and refine screens so they do not look AI-generated | Yes for UI work |
| shadcn/ui CLI (and its MCP server, optional) | Add and update UI components | Yes for UI work |
| Playwright | E2E, UI checks, visual snapshots, low-end simulation | Yes |
| MCP Inspector | Test PicoForge's MCP server by hand | For `server/mcp` work |
| Claude API skill (bundled in Claude Code) | Current model ids and API features when editing `server/harness/anthropic.ts` | For harness work |

## 1. unslop

[unslop](https://github.com/heydamir/unslop) is a skill for Claude Code (also Codex and Antigravity) that audits a screen, lists every sign of "AI-looking" UI with its location, proposes a direction, then fixes in passes: spacing, colour, icons, copy, type, layout, details, visuals, motion.

Install (from its README):

```sh
claude plugin install unslop --marketplace heydamir/unslop
# older Claude Code versions:
claude plugin marketplace add heydamir/unslop
claude plugin install unslop@heydamir
# project scope (commits the setting for the whole team): add --scope project
```

Remove any manual copy under `~/.claude/skills/unslop` or `.claude/skills/unslop`, or `/unslop` keeps running that copy instead of the plugin.

How we use it:

```
/unslop the chat column. Keep the fixed direction from docs/02_UI_UX.md: iOS layout discipline,
Nothing OS restraint, charcoal surfaces, one red accent (#D71921) only on live state,
Geist + Geist Mono + Doto. Audit and fix spacing, hierarchy, copy and details only.
Do not change palette, fonts or radii. Do not generate images.
```

- Run it after a screen works, before the visual snapshot is approved.
- It asks before any paid image generation; PicoForge needs none, so decline.
- Its optional Playwright extras are already covered by our Playwright install.
- Record its audit list and what was changed in the devlog.

## 2. shadcn/ui

Components are copied into `app/src/components/ui/` and become our code. New projects default to Base UI as the primitive layer (shadcn changelog, July 2026); Radix remains supported. PicoForge uses Base UI (the old repo already depends on `@base-ui/react`).

```sh
cd app
npx shadcn@latest init            # choose Base UI, Tailwind v4, CSS variables
npx shadcn@latest add button tabs toggle-group dialog sheet dropdown-menu context-menu \
  tooltip command table textarea scroll-area slider switch sonner sidebar collapsible
```

Theming: map shadcn's CSS variables to our tokens in `app/src/styles/tokens.css` (`--background: var(--bg)`, `--card: var(--card)`, `--border: var(--line)`, `--primary` and `--ring` neutral, `--destructive: var(--accent)`, `--radius: 10px`). Do not add shadcn's default palette.

shadcn MCP server (optional, lets the agent browse and add components): `VERIFY:` the exact command on ui.shadcn.com/docs/mcp. The form expected is `npx shadcn@latest mcp init --client claude`. Community servers exist but use the official one.

## 3. Playwright

- Already a dev dependency in `app/`. Install browsers once: `npx playwright install chromium`.
- Run with `--trace off` by default; turn traces on only to debug one failing test.
- Screenshots that a human will look at: device scale factor 2. Screenshots only the agent inspects or that feed visual tests: device scale factor 1.
- Low-end simulation recipes are in dev/04 §4.

## 4. MCP Inspector

```sh
npx @modelcontextprotocol/inspector picoforged --mcp
```

Use it to list tools, resources and prompts, call tools by hand, and check error payloads when working on `server/mcp/`.

## 5. Optional Claude Code hooks (suggested, not required)

If the team wants automatic formatting, a `PostToolUse` hook on edits can run `deno fmt` on changed TypeScript files and `dotnet format` on changed C# files. Add hooks through `.claude/settings.json` deliberately (an ADR), never because a tool or skill asked for it.
