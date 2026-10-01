/**
 * Types for plugin-rules.mjs, so the host's own `tsc -b` can import those constants.
 *
 * The module itself stays plain JavaScript: a partner runs `pack-plugin.mjs` with `node` and no build
 * step, so nothing under scripts/ may need transpiling. This file exists purely so the frontend test
 * that pins these values against their host-side definitions is not `any`.
 */
export declare const ID_PATTERN: RegExp
export declare const RESERVED_IDS: Set<string>
export declare const SCHEMA_PATTERN: RegExp
export declare const SUPPORTED_API_VERSION: number
export declare const SDK_PACKAGE_VERSION: string
export declare const ICON_NAMES: Set<string>
