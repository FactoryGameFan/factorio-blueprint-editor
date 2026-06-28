interface ArrayConstructor {
    isArray(arg: unknown): arg is unknown[] | readonly unknown[]
}
interface ObjectConstructor {
    keys<T>(o: T): (keyof T)[]
}

// hack, see https://github.com/pixijs/pixijs/issues/8957
declare namespace GlobalMixins {
    interface DisplayObjectEvents {
        close: []
        changed: []
        mode: [mode: EditorMode]
        selected: [index: number, count: number]
    }
}

// Vite resolves `?url` imports to a string URL at build/dev time.
// See https://vite.dev/guide/assets#explicit-url-imports
declare module '*?url' {
    const src: string
    export default src
}
