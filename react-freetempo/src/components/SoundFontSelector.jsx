
import { useData } from '../stores/useData'
const SoundFontSelector = () => {
    const soundFontList = useData((state) => state.soundFontList)

    const currentSoundFontId = useData((state) => state.currentSoundFontId)
    const currentSoundFont = soundFontList.find((state) => state.id === currentSoundFontId)
    return (
        <div>
            <select value={currentSoundFont}>
                <option key={soundFont.id} value={ }></option>
            </select>
        </div>
    )
}

export default SoundFontSelector
