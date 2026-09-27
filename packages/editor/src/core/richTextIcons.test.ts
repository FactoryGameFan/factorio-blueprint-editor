import { describe, expect, it } from 'vite-plus/test'
import { splitRichTextIcons } from './richTextIcons'

describe('splitRichTextIcons', () => {
    it('leaves a name with no tags as one text run', () => {
        expect(splitRichTextIcons('Iron Pickup')).toEqual([{ kind: 'text', text: 'Iron Pickup' }])
    })

    it('splits icon tags out of the text around them, in order', () => {
        expect(splitRichTextIcons('[S] [virtual-signal=signal-fuel] Service')).toEqual([
            { kind: 'text', text: '[S] ' },
            { kind: 'icon', name: 'signal-fuel', source: '[virtual-signal=signal-fuel]' },
            { kind: 'text', text: ' Service' },
        ])
    })

    it('drops what follows the name, such as a quality', () => {
        expect(splitRichTextIcons('[item=iron-plate,quality=rare]')).toEqual([
            { kind: 'icon', name: 'iron-plate', source: '[item=iron-plate,quality=rare]' },
        ])
    })

    it('handles adjacent tags and every drawable type', () => {
        expect(
            splitRichTextIcons('[item=a][fluid=b][recipe=c][entity=d]').map(r =>
                r.kind === 'icon' ? r.name : r.text
            )
        ).toEqual(['a', 'b', 'c', 'd'])
    })

    it('keeps tags it cannot draw as text', () => {
        expect(splitRichTextIcons('[gps=1,2] [color=red]x[/color]')).toEqual([
            { kind: 'text', text: '[gps=1,2] [color=red]x[/color]' },
        ])
    })
})
