import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(projectRoot, "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

const staticRoots = [
  {
    prefix: "/scramjet/",
    root: resolve(projectRoot, "node_modules/@mercuryworkshop/scramjet/dist"),
  },
  {
    prefix: "/bare-mux/",
    root: resolve(projectRoot, "node_modules/@mercuryworkshop/bare-mux/dist"),
  },
  {
    prefix: "/libcurl-transport/",
    root: resolve(projectRoot, "node_modules/@mercuryworkshop/libcurl-transport/dist"),
  },
  { prefix: "/", root: publicRoot },
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_direct_ip = false;
wisp.options.allow_udp_streams = false;
wisp.options.port_whitelist = [80, 443];
wisp.options.stream_limit_total = 60;

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  console.log(`[HTTP] ${request.method} ${requestUrl.pathname}${requestUrl.search}`);
  response.on("finish", () => {
    console.log(`[HTTP] ${request.method} ${requestUrl.pathname} -> ${response.statusCode}`);
  });

  if (request.method === "POST" && requestUrl.pathname === "/__log") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) request.destroy();
    });
    request.on("end", () => {
      try {
        console.log("[BROWSER]", JSON.stringify(JSON.parse(body)));
        response.writeHead(204);
        response.end();
      } catch (error) {
        console.error("[BROWSER] Invalid diagnostic payload", error.message);
        response.writeHead(400);
        response.end("Invalid diagnostic payload");
      }
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";

  const mapping = staticRoots.find(({ prefix }) => pathname.startsWith(prefix));
  const relativePath = pathname.slice(mapping.prefix.length);
  const filePath = resolve(mapping.root, relativePath);
  if (filePath !== mapping.root && !filePath.startsWith(`${mapping.root}${sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    await access(filePath);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": filePath.startsWith(publicRoot) ? "no-cache" : "public, max-age=3600",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
});

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url, "http://localhost");
  console.log(`[UPGRADE] ${requestUrl.pathname}`);
  if (requestUrl.pathname !== "/wisp/") {
    console.warn(`[UPGRADE] Rejected ${requestUrl.pathname}`);
    socket.destroy();
    return;
  }

  try {
    wisp.routeRequest(request, socket, head);
    console.log("[WISP] Upgrade routed");
  } catch (error) {
    console.error("[WISP] Upgrade failed", error);
    socket.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`RBS Proxy listening on ${host}:${port}`);
});