import { defineConfig, lazyPlugins } from 'vite-plus'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const fullReloadAlways = {
    name: 'full-reload',
    handleHotUpdate({ server }) {
        server.ws.send({ type: 'full-reload' })
        return []
    },
}

/*
    Cloudflare Web Analytics' beacon.

    Injected at build time from CF_BEACON_TOKEN rather than written into
    index.html, for two reasons. The token is per-site and comes from the
    Cloudflare dashboard, so a checkout without it still builds - it just builds
    a site that reports nothing, which is the right failure. And a local `vp
    build` does not quietly start sending a developer's page loads to the
    production site's analytics: only the deploy job sets the variable
    (.github/workflows/ci.yml).

    The Content-Security-Policy in public/_headers already allows both hosts
    this needs - static.cloudflareinsights.com to load the script and
    cloudflareinsights.com to report to. That predates this and is why the tag
    is one line rather than a header change too; tests/visitor-count.test.ts
    pins the pair together so tightening one cannot silently kill the other.

    The alternative, for the record: with the zone proxied, Cloudflare can inject
    this beacon itself with no code at all. An explicit tag is preferred here
    because it is visible in the repo and survives a change to the zone's
    settings, and because auto-injection rewrites HTML on the way out for every
    response rather than baking the tag into the one file that needs it.
*/
const beaconTag = token => ({
    tag: 'script',
    attrs: {
        defer: true,
        src: 'https://static.cloudflareinsights.com/beacon.min.js',
        'data-cf-beacon': JSON.stringify({ token }),
    },
    injectTo: 'body',
})

export default defineConfig(async ({ command, mode }) => {
    const visualizerPlugin = process.env.VISUALIZE
        ? (await import('rollup-plugin-visualizer')).visualizer({
              open: true,
              gzipSize: true,
              brotliSize: true,
              filename: 'dist/stats.html',
              title: 'FBE Bundle Analysis',
          })
        : null
    const beaconToken = command === 'build' ? process.env.CF_BEACON_TOKEN : undefined
    const beaconPlugin = beaconToken
        ? {
              name: 'cf-web-analytics-beacon',
              transformIndexHtml: () => [beaconTag(beaconToken)],
          }
        : null
    const proxy = {
        '/corsproxy': {
            target: 'https://fbe.factorygamefan.com',
            changeOrigin: true,
        },
    }
    if (mode !== 'production') {
        proxy['/data'] = {
            target: 'http://127.0.0.1:8081',
            rewrite: path => path.replace(/^\/data/, ''),
        }
    }
    return {
        build: { sourcemap: true },
        optimizeDeps: {
            include: [
                'pixi.js',
                'pixi.js/app',
                'pixi.js/events',
                'pixi.js/filters',
                'pixi.js/sprite-tiling',
                'pixi.js/text',
                'pixi.js/graphics',
                'pixi.js/basis',
            ],
        },
        // Deliberately not 8080. playwright.config.ts defaults baseURL to 8080
        // and every spec waits on window.__fbe_test, which since #292 is
        // assigned only under `vp dev`. A suite pointed at `vp preview` - a
        // production bundle with no hook - would otherwise hang 60s per spec on
        // a function that never appears, with nothing naming the cause (#321).
        // On a different port the same mistake is a connection refused instead.
        // The specs need `npm run localpreview`; see CLAUDE.md.
        preview: { port: 4173 },
        server: {
            port: 8080,
            proxy,
        },
        plugins: lazyPlugins(() => [
            command === 'build'
                ? viteStaticCopy({
                      targets: [
                          {
                              src: '../exporter/data/output/**/*',
                              dest: 'data',
                              // v4 preserves the full source path (exporter/data/output/...);
                              // strip those 3 segments so files land at dist/data/<name>.
                              rename: { stripBase: 3 },
                          },
                      ],
                  })
                : fullReloadAlways,
            ...(beaconPlugin ? [beaconPlugin] : []),
            ...(visualizerPlugin ? [visualizerPlugin] : []),
        ]),
    }
})
