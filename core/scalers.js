import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { ScalingMode } from '../enums.js';

export function createStretchActor({
    monitor,
    video_width,
    video_height,
}) {
    const image = St.ImageContent.new_with_preferred_size(
        monitor.width, monitor.height
    );

    return {
        actor: new Clutter.Actor({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            content: image,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        }),
        container: null,
        image: image
    };
}


export function createFitActor({
    monitor,
    video_width,
    video_height,
}) {
    const image = St.ImageContent.new_with_preferred_size(
        video_width, video_height
    );

    return {
        actor: new Clutter.Actor({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            content: image,
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
        }),
        container: null,
        image: image
    };
}

export function createCoverActor({
    monitor,
    video_width,
    video_height,
}) {
    const image = St.ImageContent.new_with_preferred_size(
        monitor.width, monitor.height
    );

    let videoAspect = video_width / video_height;
    let monitorAspect = monitor.width / monitor.height;

    let scale;
    if (videoAspect > monitorAspect) {
        // Video is wider — scale by height
        scale = monitor.height / video_height;
    } else {
        // Video is taller — scale by width
        scale = monitor.width / video_width;
    }

    let scaledWidth = video_width * scale;
    let scaledHeight = video_height * scale;
    
    // Center the oversized actor
    const videoActor = new Clutter.Actor({
        x: -(scaledWidth - monitor.width) / 2,   // relative to container
        y: -(scaledHeight - monitor.height) / 2, // relative to container
        width: scaledWidth,
        height: scaledHeight,
        content: image,
    });
    
    const container = new Clutter.Actor({
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: monitor.height,
        clip_to_allocation: true,
    });
    container.add_child(videoActor);

    return {
        actor: videoActor,
        container: container,
        image: image
    };
}


/* FIXME: Doesn't work as intended (no repeat)
export function createRepeatActor({
    monitor,
    video_width,
    video_height,
}) {
    const image = St.ImageContent.new_with_preferred_size(
        video_width, video_height
    );

    return {
        actor: new Clutter.Actor({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            content: image,
            content_repeat: Clutter.ContentRepeat.BOTH,
            content_gravity: Clutter.ContentGravity.TOP_LEFT,
        }),
        container: null,
        image: image
    };
}
*/

export function createActor({
    monitor,
    video_width,
    video_height,
    scaling_mode,
}) {
    switch (scaling_mode) {
        case ScalingMode.STRETCH: return createStretchActor({ monitor, video_width, video_height });
        case ScalingMode.FIT: return createFitActor({ monitor, video_width, video_height });
        case ScalingMode.COVER: return createCoverActor({ monitor, video_width, video_height });
        default: return createStretchActor({ monitor, video_width, video_height });
    }
}