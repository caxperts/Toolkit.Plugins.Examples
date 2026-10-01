/**
 * Scopes a plugin's CSS to its own subtree at BUILD time.
 *
 * No CSS scoping exists anywhere in this application, so an untouched plugin shipping `.header {}`
 * or `.dx-datagrid {}` would silently restyle the whole product. Enforcing it in the build rather
 * than by author discipline means the plugin author writes ordinary CSS and cannot get it wrong.
 *
 * Written as a small standalone transform rather than a PostCSS plugin so it can be unit-tested
 * without a PostCSS runtime; the Vite preset applies it through PostCSS.
 */

export interface PrefixOptions {
  /** The wrapper class the host renders around the plugin, e.g. `tk-plugin-acme.inspections`. */
  wrapper: string
}

const AT_RULES_WITH_SELECTORS = /^@(media|supports|container|layer)/i

/**
 * Selectors that mean "the document" and must be REWRITTEN to the wrapper rather than dropped —
 * a plugin legitimately sets variables or a base font on `:root`.
 */
const DOCUMENT_SELECTORS = new Set([':root', 'html', 'body', ':host', '*'])

/** Prefixes one selector list (comma-separated). */
export function prefixSelectorList(selectorList: string, wrapper: string): string {
  return selectorList
    .split(',')
    .map(selector => prefixSelector(selector.trim(), wrapper))
    .filter(selector => selector.length > 0)
    .join(', ')
}

function prefixSelector(selector: string, wrapper: string): string {
  if (selector.length === 0) return ''

  const scope = `.${escapeClassName(wrapper)}`

  if (DOCUMENT_SELECTORS.has(selector.toLowerCase())) return scope

  // Already scoped (idempotent, so running the transform twice is harmless).
  if (selector.startsWith(scope)) return selector

  // `:root .x` and friends: replace the document part, keep the rest.
  for (const documentSelector of DOCUMENT_SELECTORS) {
    if (documentSelector === '*') continue
    if (selector.toLowerCase().startsWith(documentSelector + ' ')) {
      return `${scope} ${selector.slice(documentSelector.length + 1)}`
    }
  }

  return `${scope} ${selector}`
}

/**
 * Plugin ids contain dots (`acme.inspections`), which are selector syntax — so every dot in the
 * class name has to be escaped or `.tk-plugin-acme.inspections` would read as two classes.
 */
export function escapeClassName(name: string): string {
  return name.replace(/([.:#[\]()+~>*,^$|/\\"'`!%&=?@{};])/g, '\\$1')
}

export interface PrefixResult {
  css: string
  /** Keyframe names that were renamed, old → new. */
  renamedKeyframes: Record<string, string>
}

/**
 * Prefixes every selector in `css` and namespaces `@keyframes` (plus the `animation` declarations
 * that reference them, which would otherwise point at a name that no longer exists).
 */
export function prefixCss(css: string, options: PrefixOptions): PrefixResult {
  const renamedKeyframes: Record<string, string> = {}
  const keyframePrefix = `${options.wrapper}-`

  // Pass 1: rename @keyframes declarations and remember the mapping.
  let output = css.replace(
    /@(-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/g,
    (_match, vendor: string | undefined, name: string) => {
      const renamed = keyframePrefix + name
      renamedKeyframes[name] = renamed
      return `@${vendor ?? ''}keyframes ${renamed}`
    },
  )

  // Pass 2: prefix selectors, leaving at-rule preludes and declaration blocks alone.
  output = prefixBlocks(output, options.wrapper)

  // Pass 3: point animation shorthands and animation-name at the renamed keyframes.
  for (const [original, renamed] of Object.entries(renamedKeyframes)) {
    const reference = new RegExp(
      `(animation(?:-name)?\\s*:[^;}]*?)\\b${escapeRegExp(original)}\\b`,
      'g',
    )
    output = output.replace(reference, (_m, prefix: string) => `${prefix}${renamed}`)
  }

  return { css: output, renamedKeyframes }
}

/**
 * Walks the stylesheet brace by brace so nested at-rules work and declaration values (which can
 * contain commas, colons and braces inside `url()` or `data:`) are never treated as selectors.
 */
function prefixBlocks(css: string, wrapper: string): string {
  let result = ''
  let buffer = ''
  let depth = 0
  // Inside @keyframes the "selectors" are 0%/from/to and must not be prefixed.
  const keyframeDepths = new Set<number>()

  for (let i = 0; i < css.length; i++) {
    const character = css[i]

    if (character === '{') {
      const prelude = buffer
      buffer = ''
      const trimmed = prelude.trim()

      if (trimmed.startsWith('@')) {
        if (/^@(-webkit-)?keyframes/i.test(trimmed)) keyframeDepths.add(depth + 1)
        // Nested at-rules (@media and friends) keep their prelude; their inner selectors are
        // prefixed when we reach them.
        result += AT_RULES_WITH_SELECTORS.test(trimmed) || /^@(-webkit-)?keyframes/i.test(trimmed)
          ? `${prelude}{`
          : `${prelude}{`
        depth++
        continue
      }

      result += keyframeDepths.has(depth)
        ? `${prelude}{`
        : `${leadingWhitespace(prelude)}${prefixSelectorList(trimmed, wrapper)} {`
      depth++
      continue
    }

    if (character === '}') {
      result += buffer + '}'
      buffer = ''
      keyframeDepths.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }

    buffer += character
  }

  return result + buffer
}

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? ''
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
