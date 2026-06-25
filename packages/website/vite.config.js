import { defineConfig } from 'vite'
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
            target: 'https://fbeworkeyman.wormeyman.workers.dev',
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
        preview: { port: 8080 },
        server: {
            port: 8080,
            proxy,
        },
        plugins: [
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
        ],
    }
})
