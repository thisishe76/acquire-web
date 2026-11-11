// Minimal static file server for local development.
// Sends `Cache-Control: no-store` so the browser always loads the latest files after an edit.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 8000;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const headers = { "Cache-Control": "no-store" };
  try {
    let path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname)));
    if (path !== root.replace(/[\\/]$/, "") && !path.startsWith(root)) throw Object.assign(new Error("forbidden"), { code: "EACCES" });
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    res.writeHead(200, { ...headers, "Content-Type": types[extname(path)] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    const status = error.code === "EACCES" ? 403 : 404;
    res.writeHead(status, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    res.end(status === 403 ? "Forbidden" : "Not found");
  }
}).listen(port, () => console.log(`Acquire dev server: http://localhost:${port} (no-store cache)`));
