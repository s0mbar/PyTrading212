// Service worker de PyTrading (PWA).
// RÈGLE ABSOLUE : rien sous /api/ ne passe par ce worker — ni cache, ni
// interception. Données financières et jeton d'accès vont toujours au réseau.
// Seule la coquille statique (index.html, assets Vite, icônes) est mise en
// cache, pour un démarrage rapide ; le réseau reste prioritaire pour la page.
const CACHE = "pytrading-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // jamais : réseau direct, hors du worker

  if (event.request.mode === "navigate") {
    // Page : réseau d'abord, coquille en cache seulement si hors ligne.
    event.respondWith(
      fetch(event.request)
        .then((rep) => {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copie));
          return rep;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    // Fichiers versionnés par Vite (nom avec empreinte) : cache d'abord.
    event.respondWith(
      caches.match(event.request).then(
        (trouve) =>
          trouve ||
          fetch(event.request).then((rep) => {
            if (rep.ok) {
              const copie = rep.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copie));
            }
            return rep;
          })
      )
    );
  }
});
