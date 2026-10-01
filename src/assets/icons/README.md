# Icons

Intentionally empty.

Every icon in AuraPad is a text glyph rendered by `<Text>` (see `App.tsx` for the tab bar and
`ui/Primitives.tsx` for `IconButton`). For a UI this small — transport, mute, reorder, edit —
glyphs cost nothing to bundle, scale perfectly at any density, inherit the stem accent colours
directly, and keep the app free of an SVG runtime.

Drop raster or vector assets here if you replace them, and import via `require()`.
