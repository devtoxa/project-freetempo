import { useData } from '../stores/useData';

export default function MidiSelector() {
    const midiList = useData((state) => state.midiList);
    const currentMidiId = useData((state) => state.currentMidiId);
    const setMidiId = useData((state) => state.setMidiId);

    const handleChange = (e) => {
        setMidiId(e.target.value);
    };

    return (
        <div>
            <label htmlFor="midi-select">곡(MIDI) 선택</label>
            <select
                id="midi-select"
                value={currentMidiId ?? ''}
                onChange={handleChange}
            >
                {midiList.map((midi) => (
                    <option key={midi.id} value={midi.id}>
                        {midi.title} - {midi.artist}
                    </option>
                ))}
            </select>
        </div>
    );
}