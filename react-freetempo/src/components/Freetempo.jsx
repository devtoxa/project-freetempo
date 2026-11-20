
import Info from './Info'
import Track from './Track'
import MidiSelector from './MidiSelector'
import SoundFontSelector from './SoundFontSelector'
export default function Freetempo() {
    return (
        <div className="Layout">
            <Track className="Track" />
            <div className="InfoSelector">
                <Info className="Info" />
                <SoundFontSelector className="SoundFontSelector" />
                <MidiSelector className="MidiSelector" />
            </div>
        </div>
    )
}
