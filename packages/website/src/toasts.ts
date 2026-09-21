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
        /*
            textContent, never innerHTML. Some of what gets toasted is chosen by
            whoever wrote the blueprint: the "Skipped N unknown entities" warning
            lists the names verbatim, and SafeIcon quotes the name of an icon it
            could not build. A `?source=` link is enough to put a crafted string
            in front of another user, so this is where markup in a blueprint
            would have become script. Callers that want a line break use `\n`;
            `.toasts-text` is `white-space: pre-line` for that.
        */
        text.textContent = options.text
        toast.appendChild(text)

        toast.classList.add(`toasts-${options.type || 'info'}`)

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
            /*
                The collapse is a max-height transition, and the toast is
                removed on its transitionend. A transition needs a computed
                style to start from, and a toast dismissed in the same task
                that created it has none yet - the first style it would ever
                get already carries the fade-out class, so nothing changes, no
                transition runs, and the toast used to sit in the column at
                zero height for good (issue #443). Reading offsetHeight forces
                that first style.

                The second read is load-bearing on every path, not just that
                one. The height is set and the class added in the same task,
                so without a read between them the browser compares the class
                against the last style it computed, where max-height is still
                `none`, and `none` to 0 has no transition. Measured, dropping
                the read leaves the padding and border transitions to carry
                the removal, so the toast still leaves the DOM, but the
                collapse snaps rather than slides.

                Recorded here rather than on the slide-in's animationend, which
                is what used to happen: when the fade-out cut the slide-in
                short that listener fired for the fade-out instead and recorded
                0px.
            */
            toast.style.maxHeight = `${toast.offsetHeight}px`
            void toast.offsetHeight
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
