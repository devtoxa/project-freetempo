import { useData } from '../stores/useData';

export default function MidiSelector() {
    const midiList = useData((state) => state.midiList);
    const currentMidiId = useData((state) => state.currentMidiId);
    const setMidiId = useData((state) => state.setMidiId);

    const handleSelect = (e) => {
        setMidiId(Number(e.target.value));
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const blobUrl = URL.createObjectURL(file);
        const newId = Date.now();
        const title = file.name.replace(/\.(mid|midi)$/i, '');

        useData.setState((state) => ({
            midiList: [
                ...state.midiList,
                { id: newId, title, artist: 'Local File', url: blobUrl },
            ],
            currentMidiId: newId,
        }));
    };

    return (
        <div>
            <select value={currentMidiId} onChange={handleSelect}>
                {midiList.map((midi) => (
                    <option key={midi.id} value={midi.id}>
                        {midi.title} - {midi.artist}
                    </option>
                ))}
            </select>

            <div>
                <input
                    type="file"
                    accept=".mid,.midi"
                    onChange={handleFileChange}
                />
            </div>
        </div>
    );
}