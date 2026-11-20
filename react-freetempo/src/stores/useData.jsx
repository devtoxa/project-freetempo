import { create } from 'zustand';

const midiList = [
    { id: 1, title: 'reminiscence', artist: 'nam-gu-min', url: '/midi/reminiscence-nam-gu-min.mid' },
    { id: 2, title: 'second run', artist: 'nam-gu-min', url: '/midi/sekeondeu-leon-namgumin.mid' },
    { id: 3, title: 'shining light', artist: 'djmax respect v', url: '/midi/syaining-laiteu.mid' },
];

const soundFontList = [
    { id: 1, fontName: 'Synth', type: 'synth' },
    { id: 2, fontName: 'Electric Piano', type: 'fm' },
    { id: 3, fontName: 'Soft Synth', type: 'am' },
];

export const useData = create((set) => ({
    midiList,
    soundFontList,
    currentSoundFontId: 1,
    currentMidiId: 1,
    setSoundFontId: (id) => set({ currentSoundFontId: id }),
    setMidiId: (id) => set({ currentMidiId: id }),
}));