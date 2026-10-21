import { beforeEach, expect, it, vi } from 'vite-plus/test'
import G from '../common/globals'
import { ExportDialog } from './ExportDialog'

const addOnce = vi.hoisted(() => vi.fn())

vi.mock('../common/globals', () => ({
    default: {
        quickActions: { encodeCurrent: vi.fn(), copyShareLink: vi.fn() },
        app: { ticker: { addOnce } },
        logger: vi.fn(),
    },
}))

beforeEach(() => vi.clearAllMocks())

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
    const input = { text: 'string', select: vi.fn() }
    const dialog = Object.assign(Object.create(ExportDialog.prototype), {
        m_TextInput: input,
        m_EncodeCount: 0,
        destroyed: false,
    })
    const flush = () => new Promise(resolve => setTimeout(resolve))

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
