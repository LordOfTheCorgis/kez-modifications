// node has had a built-in .env loader since 20.12, no need for dotenv. it also
// leaves vars that are already set alone, same as dotenv did. the import has to
// be dynamic: static imports run before any code in this file
try {
  process.loadEnvFile();
} catch {
  /* no .env in cwd is fine, prod can pass real env vars */
}
await import("./dist/server/entry.mjs");
