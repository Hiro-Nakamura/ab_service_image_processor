//
// image_processor
//
//
const AB = require('ab-utils');
const ImageProcessor = require('./src/ImageProcessor.js');
const config = AB.config('image_processor');
const connections = AB.config('datastores');


// Start the service
new ImageProcessor({ 
    name: "Image Processor",
    config: config,
    connections: connections
});
