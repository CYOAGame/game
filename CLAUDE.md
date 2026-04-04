## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: none

---

# CLAUDE.md - Choose Your Own Adventure

## Project Overview

A "Choose Your Own Adventure" style interactive fiction project. Details TBD as we design and build it together.

## Environment

Requires Node 22+. Uses nix flake from parent directory via direnv. Before running any commands:
```bash
eval "$(direnv export bash 2>/dev/null)"
```

## Dev Commands

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Build static site to build/
npm run preview      # Preview production build
npm test             # Run tests once (vitest run)
npm run test:watch   # Run tests in watch mode
npm run check        # TypeScript and Svelte type checking
```

## Status

**Phase:** Initial scaffolding complete
