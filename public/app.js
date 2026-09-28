import { BareMuxConnection } from "/bare-mux/index.mjs";

const addressForm = document.querySelector("#address-form");
const addressInput = document.querySelector("#address");
const statusText = document.querySelector("#status");
const statusDot = document.querySelector(".connection-dot");
const viewport = document.querySelector("#viewport");
const emptyState = document.querySelector("#empty-state");
const pageIndicator = document.querySelector("#page-indicator");
const backButton = document.querySelector("#back");
const forwardButton = document.querySelector("#forward");
const reloadButton = document.querySelector("#reload");

let browserFrame;
let scramjet;

function log(event, details = {}) {
  const entry = { event, details, time: new Date().toISOString() };
  console.info("[RBS]", entry);
  fetch("/__log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    keepalive: true,
  }).catch((error) => console.error("[RBS] Could not forward log to server", error));
}

window.addEventListener("error", (event) => {
  log("browser-error", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  log("unhandled-rejection", {
    message: event.reason?.message || String(event.reason),
    stack: event.reason?.stack,
  });
});

function setStatus(message, state = "") {
  statusText.textContent = message;
  statusDot.className = `connection-dot ${state}`;
  log("status", { message, state });
}

function normalizeAddress(value) {
  const input = value.trim();
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);

  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Only HTTP and HTTPS addresses are supported.");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Enter a valid public website address.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("Local network addresses are blocked.");
  }

  return url;
}

function verifyMuxWorker(workerPath) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new SharedWorker(workerPath, "bare-mux-worker");
      log("mux-worker-created");
    } catch (error) {
      log("mux-worker-create-error", { message: error.message, stack: error.stack });
      reject(error);
      return;
    }

    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      const error = new Error("BareMux worker did not respond to its ping within 3 seconds.");
      log("mux-worker-timeout", { message: error.message });
      finish(error);
    }, 3000);
    const finish = (error) => {
      clearTimeout(timeout);
      channel.port1.close();
      worker.port.close();
      if (error) reject(error);
      else resolve();
    };

    worker.onerror = (event) => {
      const error = new Error(event.message || "BareMux worker failed to load.");
      log("mux-worker-load-error", { message: error.message, filename: event.filename, stack: error.stack });
      finish(error);
    };
    channel.port1.onmessage = ({ data }) => {
      if (data?.type === "pong") {
        log("mux-worker-pong");
        finish();
      }
    };
    worker.port.start();
    worker.port.postMessage({ message: { type: "ping" }, port: channel.port2 }, [channel.port2]);
    log("mux-worker-ping-sent");
  });
}

async function startProxy() {
  log("proxy-start", { secureContext: window.isSecureContext, origin: location.origin });
  if (!window.isSecureContext) {
    throw new Error("Use localhost or HTTPS to enable the browser worker.");
  }

  log("service-worker-register");
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  log("service-worker-ready", { controller: Boolean(navigator.serviceWorker.controller) });

  const muxWorkerPath = "/bare-mux/worker.js";
  const workerResponse = await fetch(`${muxWorkerPath}?check=${Date.now()}`, { cache: "no-store" });
  log("mux-worker-asset-response", {
    status: workerResponse.status,
    contentType: workerResponse.headers.get("content-type"),
  });
  if (!workerResponse.ok) {
    throw new Error(`BareMux worker asset returned HTTP ${workerResponse.status}.`);
  }

  log("mux-worker-probe");
  await verifyMuxWorker(muxWorkerPath);
  log("mux-worker-responsive");

  const mux = new BareMuxConnection(muxWorkerPath);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  log("transport-configure", { endpoint: `${protocol}//${location.host}/wisp/` });
  let transportTimeout;
  try {
    await Promise.race([
      mux.setTransport("/libcurl-transport/index.mjs", [{ wisp: `${protocol}//${location.host}/wisp/` }]),
      new Promise((_, reject) => {
        transportTimeout = setTimeout(() => reject(new Error("BareMux transport setup did not finish within 10 seconds.")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(transportTimeout);
  }
  log("transport-ready");

  const { ScramjetController } = window.$scramjetLoadController();
  scramjet = new ScramjetController({
    prefix: "/scramjet/",
    files: {
      wasm: "/scramjet/scramjet.wasm.wasm",
      all: "/scramjet/scramjet.all.js",
      sync: "/scramjet/scramjet.sync.js",
    },
  });
  await scramjet.init();
  log("scramjet-ready");

  browserFrame = scramjet.createFrame();
  log("frame-created");
  browserFrame.frame.title = "Proxied website";
  browserFrame.frame.addEventListener("load", () => log("frame-load", { src: browserFrame.frame.src }));
  viewport.replaceChildren(browserFrame.frame);
  setStatus("Connected", "ready");

  browserFrame.addEventListener("urlchange", (event) => {
    log("frame-urlchange", { url: event.url });
    addressInput.value = event.url;
    pageIndicator.textContent = new URL(event.url).hostname.toUpperCase();
  });

  backButton.disabled = false;
  forwardButton.disabled = false;
  reloadButton.disabled = false;
}

const proxyReady = startProxy();
proxyReady.catch((error) => {
  log("proxy-start-error", { message: error.message, stack: error.stack });
  setStatus(error.message || "Could not start proxy", "error");
});

addressForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  log("address-submit", { value: addressInput.value });
  try {
    const url = normalizeAddress(addressInput.value);
    log("address-normalized", { href: url.href });
    await proxyReady;
    log("proxy-ready-for-navigation", { href: url.href });
    emptyState?.remove();
    browserFrame.go(url);
    pageIndicator.textContent = url.hostname.toUpperCase();
    addressInput.value = url.href;
    setStatus("Loading", "ready");
  } catch (error) {
    log("navigation-error", { message: error.message, stack: error.stack });
    setStatus(error.message || "Could not open that address", "error");
  }
});

addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") log("address-enter-key", { value: addressInput.value });
});

backButton.addEventListener("click", () => browserFrame?.back());
forwardButton.addEventListener("click", () => browserFrame?.forward());
reloadButton.addEventListener("click", () => browserFrame?.reload());