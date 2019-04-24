//
// image_processor
//
//
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const async = require("async");
const uuid = require("uuid/v4");
const mysql = require("mysql");
const cote = require("cote");
const AB = require("ab-utils");

module.exports = class ImageProcessor extends AB.service {
    constructor(options = {}) {
        super(options);

        this.cote = options.cote || cote;
        this.mysql = options.mysql || mysql;
        this.config = options.config || AB.config("image_processor");
        this.connections = options.connections || AB.config("datastores");
    }

    /**
     * @return {Promise}
     */
    connectDB() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.destroy();
            }
            try {
                this.db = this.mysql.createConnection(this.connections.site);
                this.db.connect((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });

                this.db.on("error", (err) => {
                    // MySQL likes to disconnect after a period of inactivity
                    if (err.code == "PROTOCOL_CONNECTION_LOST") {
                        console.log(this.name + " DB connection lost");
                        this.connectDB()
                            .then(() => {
                                console.log("Reconnected to DB");
                            })
                            .catch((err) => {
                                console.error("Could not reconnect to DB", err);
                                this.emit("error", err);
                            });
                    }
                    // Fatal error
                    else {
                        //console.error(this.name + " DB error", err);
                        this.emit("error", err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    startup() {
        // Allow processImage() to work when used as an event callback
        this.processImage.bind(this);

        // Allow constructor to finish first
        setImmediate(() => {
            this.responder = new this.cote.Responder({ name: this.name });
            this.connectDB()
                .then(() => {
                    super.startup();
                })
                .catch((err) => {
                    this.emit("error", err);
                });
        });
    }

    shutdown() {
        if (this.responder) {
            this.responder.off("image.upload", this.processImage);
        }
        super.shutdown();
    }

    run() {
        this.responder.on("image.upload", this.processImage);
        super.run();
    }

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
    processImage(req, cb) {
        var processedImages = [];
        var sourceFile;
        var destDir;
        var extension;

        async.series(
            [
                // Preliminary param checks
                (next) => {
                    var err = null;
                    if (typeof req.sourceFile != "string")
                        err = new TypeError("Invalid `sourceFile` param");
                    else if (typeof req.tenant != "string")
                        err = new TypeError("Invalid `tenant` param");
                    else if (typeof req.appKey != "string")
                        err = new TypeError("Invalid `appKey` param");
                    else if (!Array.isArray(req.ops))
                        err = new TypeError("Invalid `ops` param");

                    if (err) next(err);
                    else next();
                },

                // Check source file
                (next) => {
                    sourceFile = path.join(
                        this.config.inputPath,
                        req.sourceFile
                    );
                    fs.stat(sourceFile, (err) => {
                        if (err) {
                            err.message =
                                "Unable to read source file: " + sourceFile;
                            next(err);
                        } else {
                            extension = path.parse(sourceFile).ext;
                            next();
                        }
                    });
                },

                // Create destination directory if needed
                (next) => {
                    destDir = path.join(
                        this.config.outputPath,
                        req.tenant,
                        req.appKey
                    );
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
                            var targetFile = path.join(
                                destDir,
                                imageUUID + extension
                            );
                            var command = null;
                            switch (String(opItem.op).toLowerCase()) {
                                case "orient":
                                    command = `convert "${sourceFile}" -auto-orient "${targetFile}"`;
                                    break;

                                case "resize":
                                    var qualityOpt = "";
                                    if (typeof opItem.quality == "number") {
                                        qualityOpt =
                                            "-quality " + opItem.quality;
                                    }
                                    command = `convert "${sourceFile}" -auto-orient -resize ${
                                        opItem.width
                                    }x${
                                        opItem.height
                                    } ${qualityOpt} "${targetFile}"`;
                                    break;
                            }

                            if (command) {
                                child_process.exec(
                                    command,
                                    (err, stdout, stderr) => {
                                        if (err) {
                                            console.error("ImageMagick error", {
                                                command,
                                                stdout,
                                                stderr,
                                                err
                                            });
                                            nextOp(err);
                                        } else {
                                            processedImages.push({
                                                id: null, // to be determined
                                                uuid: imageUUID,
                                                appKey: req.appKey,
                                                tenant: req.tenant,
                                                sourceFile: req.sourceFile, // exclude path
                                                targetFile: targetFile,
                                                op: opItem
                                            });
                                            nextOp();
                                        }
                                    }
                                );
                            } else {
                                console.warn(
                                    "Unrecognized image processor operation",
                                    opItem
                                );
                                nextOp();
                            }
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
                            this.db.query(
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
                                [image.imageUUID, req.appKey, image.targetFile],
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
            ],
            (err) => {
                if (err) {
                    //console.error("processImage error", err);
                    cb(err);
                } else cb(null, processedImages);
            }
        );
    }
};
