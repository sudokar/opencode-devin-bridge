/**
 * opencode-devin-bridge — opencode plugin entry point.
 *
 * Why this file only re-exports `WindsurfPlugin` (and the `default` alias)
 * and DELIBERATELY does NOT re-export `createWindsurfPlugin`:
 *
 *   opencode v1.15.6+ implements its "legacy" plugin loader as:
 *       for (const entry of Object.values(mod)) {
 *           // dedup by identity, then `hooks.push(await entry(input, options))`
 *       }
 *   (source: packages/opencode/src/plugin/index.ts, `getLegacyPlugins`).
 *
 *   `WindsurfPlugin` and `default` resolve to the SAME function reference,
 *   so the Set-based dedup collapses them into one entry. Good.
 *
 *   But `createWindsurfPlugin` is the *factory* — a different reference.
 *   When opencode awaits `createWindsurfPlugin(input, options)` it gets
 *   back the INNER closure (because the factory's first arg is treated
 *   as `providerId` and it returns `async (ctx) => Hooks`). opencode
 *   then pushes that closure into its `hooks` array as a rogue
 *   "Hooks"-shaped value — a function with no `.auth`, no `.config`,
 *   no `.event` hook. In our local node-only smoke this is benign
 *   (the array still has the real Hooks at index 0 and findLast picks
 *   it correctly), but issue #13 surfaced a real, reproducible-but-
 *   environment-specific crash where `methods[index]` ends up undefined
 *   inside opencode's CLI auth-login path. The fewer rogue values we
 *   put into opencode's hooks array, the smaller the surface for those
 *   environment-dependent bugs to bite. By dropping the factory from
 *   the package entry point, `Object.values(mod)` returns exactly ONE
 *   unique function, opencode calls it ONCE, and the hooks array
 *   contains exactly our real `Hooks` object.
 *
 *   `createWindsurfPlugin` itself is still available for programmatic
 *   callers via the explicit subpath `import { createWindsurfPlugin }
 *   from 'opencode-devin-bridge/dist/src/plugin.js'`. The factory is
 *   only useful for tests or for re-instantiating with a custom
 *   `providerId`; it isn't part of the documented public API.
 *
 * @example
 * ```typescript
 * import WindsurfPlugin from 'opencode-devin-bridge';
 * // OR
 * import { WindsurfPlugin } from 'opencode-devin-bridge';
 *
 * export default { plugin: ['opencode-devin-bridge@beta'] };  // opencode auto-loads via the default export
 * ```
 */

export { WindsurfPlugin } from './src/plugin.js';

// Default export — same function reference as the named WindsurfPlugin
// above, so opencode's Object.values dedup collapses them to one entry.
export { WindsurfPlugin as default } from './src/plugin.js';
