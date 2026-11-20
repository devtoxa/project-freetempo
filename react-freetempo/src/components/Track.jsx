import { useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

const Track = () => {
    const soundFontList = useData((state) => state.soundFontList);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont = soundFontList.find((soundFont) => soundFont.id === currentSoundFontId)
    const synthRef = useRef(null);

    useEffect(() => {
        const synth = new Tone.PolySynth(synthMap[currentFont.type]).toDestination();
        synthRef.current = synth;
        return () => {
            synth.releaseAll();
            synth.dispose();
        };

    }, [currentFont.type])
    const handleTestSound = async () => {
        await Tone.start();
        synthRef.current.triggerAttackRelease(['C4', 'E4', 'G4'], '8n')
    }
    return (
        <div>
            <p>사운드폰트: {currentFont.fontName}</p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>
        </div>
    )
}

export default Track
