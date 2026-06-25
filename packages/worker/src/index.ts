interface Env {
    ASSETS: Fetcher
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)

        // Proxy /corsproxy requests - reads target from ?url= parameter
        if (url.pathname === '/corsproxy') {
            const target = url.searchParams.get('url')
            if (!target) {
                return new Response('Missing url parameter', { status: 400 })
            }

            const resp = await fetch(target, {
                method: request.method,
            })
            const headers = new Headers(resp.headers)
            headers.set('Access-Control-Allow-Origin', '*')
            return new Response(resp.body, {
                status: resp.status,
                headers,
            })
        }

        // Serve static assets
        return env.ASSETS.fetch(request)
    },
} satisfies ExportedHandler<Env>
