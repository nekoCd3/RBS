# RBS Proxy

A small Node.js web proxy using Scramjet, Bare-Mux, libcurl.js, and the Wisp server. It has a browser-based preview and a minimal address bar.

## Run

Install dependencies with `pnpm install`, then start the server with:

```sh
pnpm start
```

The server listens on all interfaces and chooses a fresh available port above 1024 each time it starts. The assigned port is printed in the terminal. Set `HOST` to change the bind address. During development, `pnpm dev` restarts the server when files change. Use HTTPS for browser service-worker support, and make the newly forwarded port public in your hosting environment if needed.

Anyone who can reach this server can use the proxy; it has no authentication. Wisp only allows TCP connections to ports 80 and 443 and blocks private and loopback IPs. Add authentication and rate limits before running it as a public service. Some sites may not work if they rely on unsupported browser features.