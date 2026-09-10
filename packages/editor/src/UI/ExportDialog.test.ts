import { beforeEach, expect, it, vi } from 'vite-plus/test'
import G from '../common/globals'
import { ExportDialog } from './ExportDialog'

const addOnce = vi.hoisted(() => vi.fn())

vi.mock('../common/globals', () => ({
    default: {
        quickActions: { encodeCurrent: vi.fn() },
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
