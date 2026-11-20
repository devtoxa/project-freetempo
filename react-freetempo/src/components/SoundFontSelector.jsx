
import { useData } from '../stores/useData'
const SoundFontSelector = () => {
    const soundFontList = useData((state) => state.soundFontList)
    const currentSoundFontId = useData((state) => state.currentSoundFontId)
    const setSoundFontId = useData((state) => state.setSoundFontId);
    return (
        <div>
            <select value={currentSoundFontId}>
                {
                    soundFontList.map((soundFont) => (
                        <option key={soundFont.id}>
                            {soundFont.fontName}
                        </option>
                    ))
                }
            </select>
        </div>
    )
}

export default SoundFontSelector
