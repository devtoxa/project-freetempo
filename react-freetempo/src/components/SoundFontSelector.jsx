
import { useData } from '../stores/useData'
const SoundFontSelector = () => {
    const soundFontList = useData((state) => state.soundFontList)
    const currentSoundFontId = useData((state) => state.currentSoundFontId)
    const setSoundFontId = useData((state) => state.setSoundFontId);
    const handleSelect = async (e) => {
        const nextId = e.target.value;
        setSoundFontId(nextId);
        try {
            await Tone.start();
        } catch {
            // 사용자 제스처 조건 미충족 시 재생 버튼 클릭에서 다시 시도
        }
    };
    return (
        <div>
            <select onChange={handleSelect} value={currentSoundFontId}>
                {
                    soundFontList.map((soundFont) => (
                        <option key={soundFont.id} value={soundFont.id}>
                            {soundFont.fontName}
                        </option>
                    ))
                }
            </select>
        </div>
    )
}

export default SoundFontSelector
