import { useData } from '../stores/useData'

const Info = () => {
    const midiList = useData((state) => state.midiList);
    const currentMidiId = useData((state) => state.currentMidiId)
    const currentMidi = midiList.find((item) => item.id === currentMidiId)
    return (
        <div className="Info">
            <div>{currentMidi.title}</div>
            <div>{currentMidi.artist}</div>
            <div>{currentMidi.url}</div>
        </div>
    )
}
export default Info
