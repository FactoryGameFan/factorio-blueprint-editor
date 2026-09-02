import { defineConfig, lazyPlugins } from 'vite-plus'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const fullReloadAlways = {
    name: 'full-reload',
    handleHotUpdate({ server }) {
        server.ws.send({ type: 'full-reload' })
        return []
    },
}

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
            ...(visualizerPlugin ? [visualizerPlugin] : []),
        ]),
    }
})
