import Info from './Info'
import Track from './Track'
import MidiSelector from './MidiSelector'
import SoundFontSelector from './SoundFontSelector'
import TrackControls from './TrackControls'

export default function Freetempo() {
    return (
        <div className="Layout">
            <Track className="Track" />
            <div className="InfoSelector">
                <Info className="Info" />
                <div className="Selector">
                    <SoundFontSelector className="SoundFontSelector" />
                    <MidiSelector className="MidiSelector" />
                </div>
                <TrackControls className="TrackControls" />
            </div>
        </div>
    )
}