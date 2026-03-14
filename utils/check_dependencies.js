import Gst from 'gi://Gst';

export function isGtk4PaintableSinkAvailable() {
    Gst.init(null);
    return Gst.ElementFactory.find('gtk4paintablesink') !== null;
}