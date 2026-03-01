import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const shellVersion = parseInt(Config.PACKAGE_VERSION.split('.')[0]);

// Assign correct implementation once
export const setImageData = shellVersion >= 48
    ? (image, coglContext, data, format, width, height, rowstride) => 
        image.set_data(coglContext, data, format, width, height, rowstride)
    : (image, coglContext, data, format, width, height, rowstride) => 
        image.set_data(data, format, width, height, rowstride); // Gnome <48 doesnt require coglContext