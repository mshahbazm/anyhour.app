// Bun inlines stylesheets imported with { type: 'text' } into the embed bundle.
declare module '*.css' {
  const content: string
  export default content
}
