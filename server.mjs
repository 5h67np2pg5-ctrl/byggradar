import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/api/geocode") {
      const allowedKeys = [
        "sok",
        "kommunenummer",
        "gardsnummer",
        "bruksnummer",
        "festenummer",
        "undernummer",
        "treffPerSide",
        "utkoordsys",
        "filtrer",
      ];
      const query = new URLSearchParams();
      allowedKeys.forEach((key) => {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      });
      const kartverket = await fetch(`https://api.kartverket.no/adresser/v1/sok?${query}`);
      const body = await kartverket.text();
      response.writeHead(kartverket.status, {
        "content-type": kartverket.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }

    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let requested = safePath === "/" ? "/index.html" : safePath;
    if (requested === "/app.js") requested = "/src/main.js";
    if (requested === "/styles.css") requested = "/src/styles.css";
    if (requested.startsWith("/data/")) requested = `/public${requested}`;
    if (requested.startsWith("/assets/")) requested = `/public${requested}`;
    const filePath = path.join(root, requested);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": mime[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`ByggRadar local UI: http://${host}:${port}/`);
});
