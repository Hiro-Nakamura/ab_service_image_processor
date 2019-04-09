//
// image_processor
//
//
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const async = require('async');
const uuid = require('uuid/v4');
const mysql = require('mysql');
const cote = require('cote');

const AB = require('ab-utils');
const config = AB.config('image_processor');
const connections = AB.config('datastores');


class ImageProcessor extends AB.service {
  
  /**
   * @return {Promise}
   */
  connectDB() {
    return new Promise((resolve, reject) => {
        if (this.db) {
            this.db.destroy();
        }
        
        // This DB connection will be used by processImage() below
        this.db = mysql.createConnection(connections.site);
        this.db.connect((err) => {
            if (err) {
                console.error(this.name + ' error connecting to DB', err);
                reject(err);
            }
            else {
                resolve();
            }
        });
        
        this.db.on('error', (err) => {
            if (err.code == 'PROTOCOL_CONNECTION_LOST') {
                console.log(this.name + ' DB connection lost');
                this.connectDB()
                .then(() => {
                    console.log('Reconnected to DB');
                })
                .catch((err) => {
                    console.error('Could not reconnect to DB', err);
                    throw err;
                });
            }
            else {
                console.error(this.name + ' DB error', err);
                throw err;
            }
        });
    });
  }
  
  
  startup() {
    this.responder = new cote.Responder({ name: this.name });
    this.connectDB()
    .then(() => {
        super.startup();
    });
  }
  
  
  shutdown() {
    this.responder.off("image.upload", processImage);
    super.shutdown();
  }
  
  
  run() {
    this.responder.on("image.upload", processImage);
  }
}


// Start the service
const service = new ImageProcessor({ name: "Image Processor" });


/**
 * @param {object} req
 * @param {string} req.sourceFile
 * @param {string} req.tenant
 * @param {string} req.appKey
 * @param {array} req.ops
 *      Array of basic objects. Each one is a requested operation to be 
 *      performed on the image.
 *      Possible operations are:
 *          { op: "orient" },           // auto-orient image according to EXIF
 *          { 
 *              op: "resize",           // scale image up or down
 *              width: <integer>,       // in pixels
 *              height: <integer>,      // in pixels
 *              [quality: <number>]     // optional JPEG quality
 *          }
 * @param {function} cb
 */
function processImage(req, cb) {
    var processedImages = [];
    var sourceFile;
    var destDir;
    var extension;
    
    async.series([
        // Preliminary param checks
        (next) => {
            var err = null;
            if (typeof req.sourceFile != 'string') err = new Error('Invalid `sourceFile` param');
            else if (typeof req.tenant != 'string') err = new Error('Invalid `tenant` param');
            else if (typeof req.appKey != 'string') err = new Error('Invalid `appKey` param');
            else if (!Array.isArray(req.ops)) err = new Error('Invalid `ops` param');
            
            if (err) next(err);
            else next();
        },
        
        // Check source file
        (next) => {
            sourceFile = path.join(config.inputPath, sourceFile);
            fs.stat(sourceFile, (err) => {
                if (err) next(new Error('Unable to read source file: ' + sourceFile));
                else {
                    extension = path.parse(sourceFile).ext;
                    next();
                }
            });
        },
        
        // Create destination directory if needed
        (next) => {
            destDir = path.join(config.outputPath, req.tenant, req.appKey);
            fs.mkdir(destDir, { recursive: true }, next);
        },
        
        // Perform operations
        (next) => {
            async.eachSeries(
                // Collection
                req.ops,
                // Iteration
                (opItem, nextOp) => {
                    var imageUUID = uuid();
                    var targetFile = path.join(destDir, imageID + extension);
                    var command = null;
                    switch (String(opItem.op).toLowerCase()) {
                        
                        case 'orient':
                            command = `convert "${sourceFile}" -auto-orient "${targetFile}"`;
                            break;
                            
                        case 'resize':
                            var qualityOpt = '';
                            if (typeof opItem.quality == 'number') {
                                qualityOpt = '-quality ' + opItem.quality;
                            }
                            command = `convert "${sourceFile}" -auto-orient -resize ${opItem.width}x${opItem.height} ${qualityOpt} "${targetFile}"`;
                            break;
                            
                    }
                    
                    if (command) {
                        child_process.exec(command, (err, stdout, stderr) => {
                            if (err) {
                                console.error('ImageMagick error', {
                                    command, stdout, stderr, err
                                });
                                nextOp(err);
                            }
                            else {
                                processedImages.push({
                                    id: null, // to be determined
                                    uuid: imageUUID,
                                    appKey: req.appKey,
                                    tenant: req.tenant,
                                    sourceFile: sourceFile,
                                    targetFile: targetFile,
                                    op: opItem,
                                });
                                nextOp();
                            }
                        });
                    }
                    else nextOp();
                },
                // Finished operations
                (err) => {
                    if (err) next(err);
                    else next();
                }
            );
        },
        
        // Record images in database
        (next) => {
            async.eachSeries(
                processedImages,
                (image, nextImage) => {
                    // TODO: adjust query to match the actual DB table structure
                    service.db.query(
                        `
                            INSERT INTO
                                op_image
                            SET
                                uuid = ?,
                                appKey = ?,
                                image = ?,
                                date = NOW(),
                                createdAt = NOW(),
                                updatedAt = NOW()
                        `, 
                        [
                            image.imageUUID,
                            req.appKey,
                            image.targetFile,
                        ], 
                        (err, result) => {
                            if (err) nextImage(err);
                            else {
                                // `id` field is from AUTO_INCREMENT
                                image.id = result.insertId;
                                nextImage();
                            }
                        }
                    );
                },
                (err) => {
                    if (err) next(err);
                    else next();
                }
            );
        }
    
    ], (err) => {
        if (err) {
            console.error('processImage error', err);
            cb(err);
        }
        else cb(null, processedImages);
    });
}
