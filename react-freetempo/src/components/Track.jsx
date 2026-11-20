import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

const PIXELS_PER_BEAT = 80;
const DEFAULT_BPM = 120;
const MIN_MIDI = 21;
const MAX_MIDI = 108;

const TRACK_HEIGHT = 480;
const NOTE_HEIGHT = 12;
const PADDING = 12;

const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});

function resolveMidiURL(midiUrl) {
    const filename = midiUrl.split('/').pop();
    return midiUrls[`../midi/${filename}`] || midiUrl;
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
    const soundFontList = useData((state) => state.soundFontList);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont = soundFontList.find((soundFont) => soundFont.id === currentSoundFontId);

    const synthRef = useRef(null);

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList);
    const currentMidi = midiList.find((midi) => midi.id === currentMidiId);

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);

    useEffect(() => {
        const synth = createInstrument(currentFont);
        synthRef.current = synth;
        return () => {
            synth.releaseAll();
            synth.dispose();
        };
    }, [currentFont.type]);

    useEffect(() => {
        (async () => {
            const url = resolveMidiURL(currentMidi.url);
            const midi = await Midi.fromUrl(url);
            const extractedNotes = midi.tracks
                .flatMap((track) => track.notes)
                .sort((a, b) => a.time - b.time);
            const midiBpm = midi.header.tempos[0]?.bpm || DEFAULT_BPM;

            setNotes(extractedNotes);
            setBpm(midiBpm);
        })();
    }, [currentMidi.url]);

    const handleTestSound = async () => {
        await Tone.start();
        synthRef.current.triggerAttackRelease(['C4', 'E4', 'G4'], '8n');
    };

    const beatsPerSecond = bpm / 60;
    const totalBeats = notes.length
        ? Math.max(...notes.map((n) => (n.time + n.duration) * beatsPerSecond))
        : 16;
    const trackWidth = Math.max(totalBeats * PIXELS_PER_BEAT + 120, 800);

    const midiValues = notes.map((n) => n.midi);
    const minMidi = midiValues.length ? Math.min(...midiValues) : MIN_MIDI;
    const maxMidi = midiValues.length ? Math.max(...midiValues) : MAX_MIDI;
    const midiSpan = Math.max(maxMidi - minMidi, 1);
    const usableHeight = TRACK_HEIGHT - NOTE_HEIGHT - PADDING * 2;

    return (
        <div>
            <p>{currentFont.fontName}</p>
            <p>{currentMidi.title}</p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>

            <div style={{ position: 'relative', overflowX: 'auto', overflowY: 'auto', height: `${TRACK_HEIGHT}px` }}>
                <div style={{ position: 'relative', width: `${trackWidth}px`, height: '100%' }}>
                    {notes.map((note, idx) => {
                        const left = note.time * beatsPerSecond * PIXELS_PER_BEAT;
                        const width = Math.max(note.duration * beatsPerSecond * PIXELS_PER_BEAT, 16);
                        const ratio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                        const top = PADDING + (1 - ratio) * usableHeight;

                        return (
                            <div
                                key={`${note.midi}-${note.time}-${idx}`}
                                style={{
                                    position: 'absolute',
                                    left: `${left}px`,
                                    top: `${top}px`,
                                    width: `${width}px`,
                                    height: `${NOTE_HEIGHT}px`,
                                }}
                            >
                                {note.name}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Track;