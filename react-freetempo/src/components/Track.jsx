import { useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';


// src/midi/ 폴더의 .mid 파일을 빌드/개발 환경 모두에서 URL로 매핑
const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});
function resolveMidiURL(url) {
    return midiUrls[`${url}`];
}



function createInstrument(font) {
    if (font.type === 'sampler') {
        return new Tone.Sampler({
            urls: font.urls,
            baseUrl: font.baseUrl,
            release: 1,
        }).toDestination();
    } else {
        return new Tone.PolySynth(synthMap[font.type]).toDestination();
    }
}

const Track = () => {
    //soundFont
    const soundFontList = useData((state) => state.soundFontList);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont = soundFontList.find((soundFont) => soundFont.id === currentSoundFontId)

    //synth
    const synthRef = useRef(null);

    //midi
    const currentMidiId = useData((state) => state.currentMidiId)
    const midiList = useData((state) => state.midiList);
    const currentMidi = midiList.find((midi) => midi.id === currentMidiId);

    useEffect(() => {
        const synth = createInstrument(currentFont);
        const url = resolveMidiURL(currentMidi.filename);
        Midi.fromUrl(url).then((midi) => {
            const notes = midi.tracks.flatMap((track) => track.notes);
            console.log('로드된 노트:', notes);
        });
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
