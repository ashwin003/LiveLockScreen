#!/usr/bin/env -S gjs -m
/* 
 * This script runs multiple GTK windows with video output
 * one per each monitor
*/

import PlayerMulti from './player.js';

const player = new PlayerMulti({
    path:        ARGV[0],
    scalingMode: parseInt(ARGV[1]),
    loop:        ARGV[2] === 'true',
    volume:      parseFloat(ARGV[3]),
    framerate:   parseInt(ARGV[4]),
});
player.run();