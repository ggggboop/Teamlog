/**
 * 단일 소스: `package.json`의 `version`.
 * 번들 시 Vite가 `import.meta.env.VITE_APP_PACKAGE_VERSION`에 주입 (vite.config.ts).
 */
export const APP_VERSION: string =
  typeof import.meta.env.VITE_APP_PACKAGE_VERSION === "string" && import.meta.env.VITE_APP_PACKAGE_VERSION.length > 0
    ? import.meta.env.VITE_APP_PACKAGE_VERSION
    : "0.0.0";
