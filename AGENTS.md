## Repository Overview

Goban is a TypeScript library for Go (Weiqi/Baduk) game visualization and interaction, used by Online-Go.com. The library provides both browser and Node.js compatibility through separate builds.

## Essential Commands

### Development
```bash
make            # Start development server
yarn run dev    # Alternative development server start
yarn install    # Install dependencies (first time setup)
```

### Build Commands
```bash
make build                # Build both debug and production versions
yarn run build-debug     # Webpack debug build
yarn run build-production # Webpack production build
```

### Code Quality
```bash
yarn run lint            # ESLint checking
yarn run lint:fix        # Auto-fix ESLint issues
yarn run prettier       # Format code with Prettier
yarn run prettier:check # Check Prettier formatting
yarn run checks         # Run both lint and prettier:check
yarn run spellcheck     # Run cspell on TypeScript files
```

### Testing
```bash
npm test                        # Run Jest tests
yarn run test-coverage-summary # Run tests with coverage summary
```

### Documentation
```bash
yarn run typedoc        # Generate TypeDoc documentation
yarn run typedoc:watch  # Watch mode for documentation
```

### Quality Assurance
```bash
yarn run detect-duplicate-code # Check for code duplication using jscpd
```

## Architecture

### Dual Build System

The library produces two separate builds:

1. **goban-engine** (Node.js): Core game logic without rendering
   - Target: Node.js environments
   - Entry: `src/engine/index.ts`
   - Output: `engine/build/goban-engine.js`
   - Published as separate npm package
   - **IMPORTANT**: Only cross-platform code goes here (no DOM, no D3, no browser-specific APIs)
   - Dependencies must work in Node.js environment

2. **goban** (Web): Full library with renderers
   - Target: Web browsers
   - Entry: `src/index.ts`
   - Output: `build/goban.js` / `build/goban.min.js`
   - Includes Canvas and SVG renderers
   - **Frontend-specific code goes in `src/Goban/`** (D3 charts, DOM manipulation, etc.)
   - Browser-specific dependencies (like d3) should be peer dependencies here

### Class Hierarchy

The rendering system uses layered inheritance:

```
SVGRenderer/CanvasRenderer → Goban → OGSConnectivity → InteractiveBase → GobanBase
```

- **GobanBase**: Abstract base for engine interaction
- **InteractiveBase**: General interactive functionality, no DOM dependencies
- **OGSConnectivity**: Socket connection and Online-Go.com server communication
- **Goban**: Common DOM manipulation for renderers
- **SVGRenderer/CanvasRenderer**: Final rendering implementations

### Key Modules

- **Engine** (`src/engine/`): Cross-platform game logic
  - BoardState, GobanEngine, MoveTree
  - Game formats (JGOF, AdHocFormat)
  - Scoring and autoscoring
  - Protocol definitions for server communication

- **Renderers** (`src/Goban/`): Platform-specific visualization
  - Canvas and SVG rendering implementations
  - Theme system with board and stone styles
  - Interactive controls and event handling

- **Themes** (`src/Goban/themes/`): Visual customization
  - Board themes (plain, wood textures)
  - Stone rendering (plain, image-based, pre-rendered)

### Build Configuration

- **Webpack**: Dual configuration for engine-only and full builds
- **TypeScript**: Strict type checking with separate configs for Node.js and web
- **Development server**: Webpack dev server on port 9000 with hot reload disabled

## Development Patterns

### Cross-Platform Compatibility

Engine code must work in both browser and Node.js environments. Use environment-specific webpack defines:
- `CLIENT`: true for web builds
- `SERVER`: true for Node.js builds

### Testing Strategy

- **Jest**: Unit tests with jsdom environment
- **Coverage**: 60% minimum line coverage requirement
- **Test location**: `test/unit_tests/` and inline `**/__tests__/` directories
- **Mock support**: WebSocket mocking for connection testing

### Code Standards

- **ESLint**: Comprehensive linting with TypeScript support
- **Prettier**: Code formatting enforcement
- **JSDoc**: Required documentation with alignment checking
- **Header enforcement**: Copyright headers required on all files
- **Spell checking**: cspell for consistent terminology

### Module Resolution

Uses custom path mapping:
- `*`: Maps to `src/*` first, then node_modules
- `engine`: Maps to `src/engine`
- `goscorer`: Maps to third-party Go scoring library
