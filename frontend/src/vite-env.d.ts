/// <reference types="vite/client" />

// Allow side-effect CSS imports throughout the project
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
