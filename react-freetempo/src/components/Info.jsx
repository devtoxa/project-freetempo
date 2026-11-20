import { useData } from '../../stores/useData';

const Info = () => {
    const midiList = useData((state) => state.midiList);
    const currentMidiId = useData((state) => state.currentMidi)
    const currentMidi = midiList.find((item) => item.id === currentMidiId)
    return (
        <div>
            <h2>{currentMidi.title}</h2>
            <h2>{currentMidi.artist}</h2>
            <h2>{currentMidi.filename}</h2>
        </div>
    )
}
export default Info
