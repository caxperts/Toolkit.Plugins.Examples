// Type surface only. Never bundled: the Vite preset marks this specifier external and the host's
// import map resolves it to the host's own facade at runtime — see README.md, "DevExtreme widgets".
//
// Types come from devextreme-react, an OPTIONAL peer dependency. Without it installed the
// import still works at runtime; you just get no completions and tsc reports TS2307 here.
export * from 'devextreme-react/html-editor'
export { default } from 'devextreme-react/html-editor'
