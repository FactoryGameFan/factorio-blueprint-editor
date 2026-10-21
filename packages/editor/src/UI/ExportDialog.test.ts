import { beforeEach, expect, it, vi } from 'vite-plus/test'
import G from '../common/globals'
import { ExportDialog } from './ExportDialog'

const addOnce = vi.hoisted(() => vi.fn())
// The real History's revision is read-only; the dialog only ever reads it.
const history = vi.hoisted(() => ({ revision: 0 }))

vi.mock('../common/globals', () => ({
    default: {
        quickActions: { encodeCurrent: vi.fn(), copyShareLink: vi.fn() },
        app: { ticker: { addOnce } },
        logger: vi.fn(),
        bp: { history },
    },
}))

beforeEach(() => {
    vi.clearAllMocks()
    history.revision = 0
})

const flush = () => new Promise(resolve => setTimeout(resolve))

/** A dialog with just the fields the copy and encode handlers touch, and no renderer. */
function bareDialog(text = 'string') {
    const input = { text, select: vi.fn() }
    const dialog = Object.assign(Object.create(ExportDialog.prototype), {
        m_TextInput: input,
        m_EncodeCount: 0,
        m_CopyCount: 0,
        m_ReencodeDueAt: undefined as number | undefined,
        destroyed: false,
    })
    return { dialog, input }
}

/** Resolves `copyShareLink` by hand, in whatever order a test chooses. */
function pendingCopies() {
    const pending: ((link: string) => void)[] = []
    vi.mocked(G.quickActions.copyShareLink).mockImplementation(
        () => new Promise(resolve => pending.push(link => resolve({ link, copied: false })))
    )
    return pending
}

it('ignores older encodes and completion after the export dialog closes', async () => {
    const pending: ((source: string) => void)[] = []
    vi.mocked(G.quickActions.encodeCurrent).mockImplementation(
        () => new Promise(resolve => pending.push(resolve))
    )
    // Exercise the real completion handler without creating a renderer or DOM.
    const input = { text: '', select: vi.fn() }
    const dialog = Object.assign(Object.create(ExportDialog.prototype), {
        m_TextInput: input,
        m_EncodeCount: 0,
        destroyed: false,
    })

    dialog.refreshText({ select: false })
    dialog.refreshText({ select: false })
    pending[1]('newer')
    await Promise.resolve()
    pending[0]('older')
    await Promise.resolve()
    expect(input.text).toBe('newer')

    dialog.refreshText({ select: true })
    dialog.destroyed = true
    pending[2]('closed')
    await Promise.resolve()
    expect(input.text).toBe('newer')
    expect(addOnce).not.toHaveBeenCalled()

    dialog.destroyed = false
    dialog.refreshText({ select: true })
    pending[3]('open')
    await Promise.resolve()
    dialog.destroyed = true
    const selectOnFrame = addOnce.mock.calls[0][0] as () => void
    selectOnFrame()
    expect(input.select).not.toHaveBeenCalled()
})

it('shows the share link in the field only when the clipboard refused it', async () => {
    const { dialog, input } = bareDialog()

    vi.mocked(G.quickActions.copyShareLink).mockResolvedValueOnce({ link: 'copied', copied: true })
    dialog.copyShareLink()
    await flush()
    expect(input.text).toBe('string')

    vi.mocked(G.quickActions.copyShareLink).mockResolvedValueOnce(undefined)
    dialog.copyShareLink()
    await flush()
    expect(input.text).toBe('string')

    // An encode still in flight from before the click must not overwrite the link.
    let finishEncode: (source: string) => void = () => {}
    vi.mocked(G.quickActions.encodeCurrent).mockImplementationOnce(
        () => new Promise(resolve => (finishEncode = resolve))
    )
    dialog.refreshText({ select: false })
    vi.mocked(G.quickActions.copyShareLink).mockResolvedValueOnce({
        link: 'blocked',
        copied: false,
    })
    dialog.copyShareLink()
    await flush()
    expect(input.text).toBe('blocked')
    expect(input.select).toHaveBeenCalledOnce()
    finishEncode('stale')
    await flush()
    expect(input.text).toBe('blocked')
})

it('shows only the newest click when two refused copies finish out of order', async () => {
    const { dialog, input } = bareDialog()
    const pending = pendingCopies()
    dialog.copyShareLink()
    dialog.copyShareLink()
    pending[1]('newer')
    await flush()
    pending[0]('older')
    await flush()
    expect(input.text).toBe('newer')
})

it('drops a pending re-encode the link already covers, and keeps one for a later edit', async () => {
    const { dialog } = bareDialog()
    const pending = pendingCopies()

    // An edit before the click: the link holds it, so the re-encode would only undo the link.
    dialog.m_ReencodeDueAt = 1000
    dialog.copyShareLink()
    pending[0]('link')
    await flush()
    expect(dialog.m_ReencodeDueAt).toBeUndefined()

    // An edit while the link was being made: the link is out of date, so the re-encode stays.
    dialog.copyShareLink()
    history.revision++
    dialog.m_ReencodeDueAt = 2000
    pending[1]('link')
    await flush()
    expect(dialog.m_ReencodeDueAt).toBe(2000)
})
