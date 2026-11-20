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

    }, [currentFont.type])
    const handleTestSound = async () => {
        await Tone.start();
        synthRef.current.triggerAttackRelease(['C4', 'E4', 'G4', '8n'])
    }
    return (
        <div>
            Track
        </div>
    )
}

export default Track
