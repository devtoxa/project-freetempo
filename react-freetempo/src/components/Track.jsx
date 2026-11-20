import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';
import './../css/Track.css';

const PIXELS_PER_BEAT = 80;
const DEFAULT_BPM = 120;
const MIN_MIDI = 21;
const MAX_MIDI = 108;

const TRACK_HEIGHT = 480;
const NOTE_HEIGHT = 12;
const PADDING = 12;
const FADE_OUT_MS = 220;

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

function groupNotesByTime(notes, threshold = 0.02) {
    const groups = [];
    for (const note of notes) {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup) {
            groups.push([note]);
            continue;
        }
        const groupTime = lastGroup[0].time;
        if (Math.abs(note.time - groupTime) <= threshold) {
            lastGroup.push(note);
        } else {
            groups.push([note]);
        }
    }
    return groups;
}

const Track = () => {
    const soundFontList = useData((state) => state.soundFontList);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont = soundFontList.find((soundFont) => soundFont.id === currentSoundFontId);

    const synthRef = useRef(null);
    const stepRef = useRef(0);

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList);
    const currentMidi = midiList.find((midi) => midi.id === currentMidiId);

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);

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
            stepRef.current = 0;
            setCurrentStep(0);
        })();
    }, [currentMidi.url]);

    const noteGroups = useMemo(() => groupNotesByTime(notes), [notes]);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            if (e.repeat) return;
            if (!noteGroups.length || !synthRef.current) return;

            await Tone.start();

            const idx = stepRef.current % noteGroups.length;
            const group = noteGroups[idx];

            group.forEach((note) => {
                synthRef.current.triggerAttackRelease(
                    note.name,
                    Math.max(note.duration, 0.1)
                );
            });

            const nextStep = (idx + 1) % noteGroups.length;
            stepRef.current = nextStep;
            setCurrentStep(nextStep);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [noteGroups]);

    const handleTestSound = async () => {
        await Tone.start();
        synthRef.current.triggerAttackRelease(['C4', 'E4', 'G4'], '8n');
    };

    const playedNoteSet = useMemo(() => {
        const set = new Set();
        for (let i = 0; i < currentStep; i++) {
            noteGroups[i]?.forEach((n) => set.add(n));
        }
        return set;
    }, [noteGroups, currentStep]);

    const remainingNotes = useMemo(
        () => notes.filter((n) => !playedNoteSet.has(n)),
        [notes, playedNoteSet]
    );

    const offsetTime =
        currentStep > 0 && noteGroups[currentStep]
            ? noteGroups[currentStep][0].time
            : 0;

    const beatsPerSecond = bpm / 60;
    const totalBeats = remainingNotes.length
        ? Math.max(
            ...remainingNotes.map(
                (n) => (n.time - offsetTime + n.duration) * beatsPerSecond
            )
        )
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
            <p>
                진행: {currentStep} / {noteGroups.length}
            </p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>

            <div className="track-viewport" style={{ height: `${TRACK_HEIGHT}px` }}>
                <div className="track-canvas" style={{ width: `${trackWidth}px` }}>
                    {remainingNotes.map((note, idx) => {
                        const left = Math.max((note.time - offsetTime) * beatsPerSecond * PIXELS_PER_BEAT, 0);
                        const width = Math.max(note.duration * beatsPerSecond * PIXELS_PER_BEAT, 16);
                        const ratio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                        const top = PADDING + (1 - ratio) * usableHeight;

                        return (
                            <div
                                key={`${note.midi}-${note.time}-${idx}`}
                                className="track-note"
                                style={{
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