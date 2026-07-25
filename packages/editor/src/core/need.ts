/**
 * Reads a prototype field that data.json supplies for this entity type, but which
 * typed-factorio models as optional because it only exists on some types.
 *
 * Throws rather than returning undefined. The throw carries the field path, so a
 * missing field is reported as which field was missing rather than surfacing as a
 * TypeError further down; returning empty instead would silently draw nothing and
 * lose that. Callers that have a try/catch above them - getSpriteData for the
 * sprite builder, the instance createEntityInfo for the overlay - turn it into a
 * named log line and degrade to a missing sprite or a missing overlay.
 *
 * Use it for fields the data genuinely always has for the types that reach the
 * call. A field that is legitimately absent some of the time wants a default or a
 * guard instead - throwing there loses everything else the caller was drawing.
 *
 * Takes a path so nested reads stay one call: need(e, 'chargable_graphics',
 * 'picture', 'layers').
 */
export function need<T extends object, K1 extends keyof T>(obj: T, k1: K1): NonNullable<T[K1]>
export function need<T extends object, K1 extends keyof T, K2 extends keyof NonNullable<T[K1]>>(
    obj: T,
    k1: K1,
    k2: K2
): NonNullable<NonNullable<T[K1]>[K2]>
export function need<
    T extends object,
    K1 extends keyof T,
    K2 extends keyof NonNullable<T[K1]>,
    K3 extends keyof NonNullable<NonNullable<T[K1]>[K2]>,
>(obj: T, k1: K1, k2: K2, k3: K3): NonNullable<NonNullable<NonNullable<T[K1]>[K2]>[K3]>
export function need(obj: object, ...keys: PropertyKey[]): unknown {
    let current: unknown = obj
    const walked: string[] = []
    for (const key of keys) {
        walked.push(String(key))
        current = (current as Record<PropertyKey, unknown>)[key]
        if (current === undefined || current === null) {
            throw new Error(`prototype field '${walked.join('.')}' is missing`)
        }
    }
    return current
}
