# wisp-ui

Wisp's screen: the React app the Car Thing shows, from Home and Now Playing to
setup, directions and Drive Mode. Part of [Wisp](../README.md).

React + TypeScript + Vite.

## Development

| Command                 | Purpose                     |
| ----------------------- | --------------------------- |
| `npm run dev`           | Vite dev server with HMR    |
| `npm run build`         | Production build to `dist/` |
| `npm run lint`          | ESLint                      |
| `npm run typecheck`     | `tsc -b --noEmit`           |
| `npm test`              | Run vitest suite            |
| `npm run test:watch`    | Vitest in watch mode        |
| `npm run test:coverage` | Coverage report             |

Press `` ` `` or `T` in the dev server for the screen switcher: every screen,
from setup to the player, without a live daemon.

### Browser target

Two browsers run this UI. Wisp OS ships Chromium 147, drawing on the Car
Thing's graphics chip. The original firmware ships Chrome 69 (2018), so the
production bundle still goes through `@vitejs/plugin-legacy`, and styles stick
to what Chrome 69 can do (no flex `gap`, motion on `transform` and `opacity`).

## Credits

Wisp grew out of [Mira](https://github.com/mira-thing)'s UI; the player and
most screens have since been rebuilt for Wisp.

## License

Apache 2.0, see [LICENSE](LICENSE).

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.
