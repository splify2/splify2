/* Andromeda demo loader.
   Единственный источник правды — .jsx компонентов. Страницы-образцы и UI kit
   грузят их этим лоадером: fetch → Babel → CommonJS-обёртка. В продакшене
   вместо него обычный сборщик. */
(function () {
  const cache = new Map();

  function resolve(from, spec) {
    if (!spec.startsWith(".")) return spec;
    const base = from.slice(0, from.lastIndexOf("/") + 1);
    const url = new URL(base + spec, location.href);
    return url.pathname;
  }

  async function load(path) {
    if (cache.has(path)) return cache.get(path);
    const p = (async () => {
      const src = await fetch(path).then((r) => {
        if (!r.ok) throw new Error("не найден " + path);
        return r.text();
      });
      const out = Babel.transform(src, {
        // classic runtime: React.createElement вместо react/jsx-runtime,
        // иначе модулю понадобился бы пакет, которого в браузере нет.
        presets: [["env", { modules: "commonjs" }], ["react", { runtime: "classic" }]],
        filename: path,
      }).code;

      const deps = {};
      const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        if (spec === "react") { deps.react = { default: window.React, ...window.React }; continue; }
        const child = resolve(path, spec);
        deps[spec] = await load(child);
      }

      const module = { exports: {} };
      const require = (spec) => {
        if (spec === "react") return deps.react;
        if (deps[spec]) return deps[spec];
        throw new Error("не разрешён импорт " + spec + " в " + path);
      };
      new Function("require", "exports", "module", out)(require, module.exports, module);
      return module.exports;
    })();
    cache.set(path, p);
    return p;
  }

  window.AndromedaLoader = { load };
})();
