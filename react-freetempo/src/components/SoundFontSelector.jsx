
import { useData } from '../stores/useData'
const SoundFontSelector = () => {
    const soundFontList = useData((state) => state.soundFontList)
    const currentSoundFont = useData((state) => state.currentSoundFont)

    return (
        <div>
            
        </div>
    )
}

export default SoundFontSelector
