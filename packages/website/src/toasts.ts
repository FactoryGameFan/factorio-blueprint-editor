interface IToastsOptions {
    text: string
    type?: 'success' | 'info' | 'warning' | 'error'
    timeout?: number
}

/**
 * Marks a toast that never expires, and so is the only kind a click still
 * reaches (issue #228). Every other toast is click-through, because
 * `.toasts-container` covers the bottom-right 320px of a canvas that fills the
 * window and a settled toast spans the container's full width - so the column
 * was eating clicks meant for whatever panel sits under it.
 *
 * Exported because `packages/website/src/index.css` and
 * `tests/toast-click-interception.spec.ts` both name this class. A rename that
 * reached only two of the three would leave the CSS exception matching nothing
 * and every toast click-through, including the two that have no other way to be
 * dismissed.
 */
export const PERSISTENT_TOAST_CLASS = 'toasts-persistent'

export function initToasts(): (options: IToastsOptions) => void {
    let autoincrement = 0
    const getNextID = (): string => {
        autoincrement += 1
        return `toast-${autoincrement}`
    }

    const container = document.createElement('div')
    container.className = 'toasts-container'
    document.body.appendChild(container)

    return (options: IToastsOptions) => {
        const toast = document.createElement('div')
        toast.id = getNextID()
        toast.className = 'toasts-toast'

        const text = document.createElement('span')
        text.className = 'toasts-text'
        text.innerHTML = options.text
        toast.appendChild(text)

        toast.classList.add(`toasts-${options.type || 'info'}`)

        toast.addEventListener(
            'animationend',
            () => {
                toast.style.maxHeight = `${toast.offsetHeight}px`
            },
            { once: true }
        )

        const promises = [
            new Promise(resolve => toast.addEventListener('click', resolve, { once: true })),
        ]

        if (options.timeout === Infinity) {
            /*
                A click is the only way to dismiss this one, so it has to keep
                its pointer events where every other toast gives them up - see
                PERSISTENT_TOAST_CLASS. Both callers (WebAssembly unsupported,
                and an unrecoverable startup failure) throw straight afterwards,
                so there is no editor underneath for the toast to block.
            */
            toast.classList.add(PERSISTENT_TOAST_CLASS)
        } else {
            promises.push(new Promise(resolve => setTimeout(resolve, options.timeout || 5000)))
        }

        // Never rejects: both racers settle from a click listener or a timeout.
        void Promise.race(promises).then(() => {
            toast.classList.add('toasts-toast-fadeOut')
            toast.addEventListener(
                'transitionend',
                () => {
                    container.removeChild(toast)
                },
                { once: true }
            )
        })

        container.prepend(toast)
    }
}
