/**
 * Image Processor unit tests
 */
var expect = require("chai").expect;
var fs = require("fs");
var path = require("path");
var uuid = require("uuid/v4");
var rimraf = require("rimraf");
var ImageProcessor = require("../../src/ImageProcessor.js");

const mockCote = {
    Responder: function() {
        (this.on = () => {}), (this.off = () => {});
    }
};

const sourceFile = uuid();
const appKey = uuid();
const tenant = uuid();

// This subclass of ImageProcessor allows us to inspect its SQL queries
class TestImageProcessor extends ImageProcessor {
    constructor(options) {
        options.cote = mockCote;
        super(options);
    }

    connectDB() {
        // Mock DB
        this.db = {
            // Mock query()
            query: (sql, params, callback) => {
                this.emit("mockQuery", { sql, params, callback });
            }
        };
        return Promise.resolve();
    }

    startup() {
        setImmediate(() => {
            this.connectDB().catch((err) => {});
        });
    }
}

before(function(done) {
    // Create the dummy source file
    fs.writeFile("/tmp/" + sourceFile, "testing", (err) => {
        if (err) console.error(err);
        else done();
    });
});

describe("image_processor", function() {
    describe("constructor()", function() {
        it("should emit 'error' if invalid DB config", function(done) {
            const obj = new ImageProcessor({
                name: "Image Processor bad DB",
                cote: mockCote,
                connections: {
                    site: {
                        adapter: "sails-mysql",
                        host: "localhost",
                        port: 22,
                        user: "invalid user",
                        password: "invalid password",
                        database: "site"
                    }
                }
            });

            obj.on("ready", () => {
                throw new Error("bad config but still initialized somehow");
                done();
            });

            obj.on("error", (err) => {
                expect(err).is.instanceof(Error);
                done();
            });
        });

        it("should emit 'ready' if correct DB config", function(done) {
            const mockConnection = { mock: true };
            const obj = new ImageProcessor({
                name: "Image Processor mock MySQL",
                connections: { site: mockConnection },
                cote: mockCote,
                // Mock MySQL
                mysql: {
                    createConnection: (conn) => {
                        expect(conn).equal(mockConnection);
                        return {
                            connect: (cb) => {
                                cb();
                            },
                            on: () => {},
                            off: () => {}
                        };
                    }
                }
            });

            obj.on("ready", () => {
                done();
            });

            obj.on("error", (err) => {
                throw err;
                done();
            });
        });
    });

    describe("processImage()", function() {
        // We are using the 'convert' command, which is a 3rd party tool
        // from ImageMagick. We will not test the command itself, and just
        // assume that it works as expected.
        // We expect that it will:
        // - read the source image from the specified path
        // - produce an error if the source image cannot be read
        // - process the image according to the options given
        // - write the resulting image to the specified target path
        // - produce an error if the target image cannot be written

        const obj = new TestImageProcessor({
            name: "Test Image Processor",
            config: {
                inputPath: "/tmp",
                outputPath: "/tmp"
            },
            connections: {}
        });

        describe("initialization", function() {
            it("should reject invalid `sourceFile` parameter", function(done) {
                obj.processImage(
                    {
                        sourceFile: null,
                        tenant: tenant,
                        appKey: appKey,
                        ops: []
                    },
                    (err) => {
                        expect(err).is.instanceof(TypeError);
                        done();
                    }
                );
            });

            it("should reject invalid `tenant` parameter", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: null,
                        appKey: appKey,
                        ops: []
                    },
                    (err) => {
                        expect(err).is.instanceof(TypeError);
                        done();
                    }
                );
            });

            it("should reject invalid `appKey` parameter", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: null,
                        ops: []
                    },
                    (err) => {
                        expect(err).is.instanceof(TypeError);
                        done();
                    }
                );
            });

            it("should reject invalid `ops` parameter", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: null
                    },
                    (err) => {
                        expect(err).is.instanceof(TypeError);
                        done();
                    }
                );
            });
        });

        describe("filesystem stuff", function() {
            it("should reject an unreadable source file", function(done) {
                obj.processImage(
                    {
                        // uuid is unique so it can't already exist
                        sourceFile: uuid(),
                        tenant: tenant,
                        appKey: appKey,
                        ops: []
                    },
                    (err) => {
                        expect(err).is.instanceof(Error);
                        expect(err).has.property("message");
                        expect(err.message).to.match(/Unable to read/);
                        done();
                    }
                );
            });

            it("should create tenant and appkey subdirectories", function(done) {
                const expectedDirectory = path.join("/tmp", tenant, appKey);
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: []
                    },
                    (err) => {
                        expect(err).is.null;
                        expect(fs.existsSync(expectedDirectory)).is.true;
                        done();
                    }
                );
            });
        });

        describe("ImageMagick `convert`", function() {
            const insertID = Math.floor(Math.random() * 1000);
            it("should receive expected command for `orient` op", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: [{ op: "orient" }]
                    },
                    (err, processedImages) => {
                        expect(err).is.null;

                        // check `processedImages` result
                        expect(processedImages).is.an("array");
                        expect(processedImages).has.lengthOf(1);
                        expect(processedImages[0].id).to.equal(insertID);
                        expect(processedImages[0].uuid).to.exist;
                        expect(processedImages[0].appKey).to.equal(appKey);
                        expect(processedImages[0].tenant).to.equal(tenant);
                        expect(processedImages[0].sourceFile).to.equal(
                            sourceFile
                        );
                        expect(processedImages[0].targetFile).is.a("string");
                        expect(processedImages[0].op).is.an("object");

                        // The mock `test/bin/convert` command saves its input
                        // parameters in a file so we can inspect it.
                        fs.readFile(
                            __dirname + "/../bin/params",
                            (err, data) => {
                                expect(err).is.null;

                                let source = path.join("/tmp", sourceFile);
                                let target = processedImages[0].targetFile;
                                expect(data.toString()).has.string(
                                    `${source} -auto-orient ${target}`
                                );
                                done();
                            }
                        );
                    }
                );
                // processImage() will emit this during the mock SQL query
                obj.once("mockQuery", (mock) => {
                    mock.callback(null, { insertId: insertID });
                });
            });

            it("should receive expected command for `resize` op", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: [
                            {
                                op: "resize",
                                width: 900,
                                height: 800,
                                quality: 1
                            }
                        ]
                    },
                    (err, processedImages) => {
                        expect(err).is.null;

                        // The mock `test/bin/convert` command saves its input
                        // parameters in a file so we can inspect it.
                        fs.readFile(
                            __dirname + "/../bin/params",
                            (err, data) => {
                                expect(err).is.null;

                                let source = path.join("/tmp", sourceFile);
                                let target = processedImages[0].targetFile;
                                expect(data.toString()).has.string(
                                    `${source} -auto-orient -resize 900x800 -quality 1 ${target}`
                                );
                                done();
                            }
                        );
                    }
                );
                // processImage() will emit this during the mock SQL query
                obj.once("mockQuery", (mock) => {
                    mock.callback(null, { insertId: insertID });
                });
            });

            it("should handle multiple ops", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: [
                            { op: "orient" },
                            { op: "orient" },
                            { op: "orient" }
                        ]
                    },
                    (err, processedImages) => {
                        expect(err).is.null;
                        expect(processedImages).is.an("array");
                        expect(processedImages).has.lengthOf(3);
                        obj.removeAllListeners("mockQuery");
                        done();
                    }
                );
                // processImage() will emit this during the mock SQL queries
                obj.on("mockQuery", (mock) => {
                    mock.callback(null, { insertId: insertID });
                });
            });
        });

        describe("database", function() {
            it("should receive expected SQL query", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: [{ op: "orient" }]
                    },
                    (err, processedImages) => {
                        expect(err).is.null;
                        done();
                    }
                );
                // processImage() will emit this during the mock SQL query
                obj.once("mockQuery", (mock) => {
                    expect(mock.sql).to.match(/^\s*insert\s+into/i);
                    // column names
                    expect(mock.sql).has.string("app_key");
                    expect(mock.sql).has.string("uuid");
                    expect(mock.sql).has.string("size");
                    expect(mock.sql).has.string("type");
                    // values
                    expect(mock.params).to.include(appKey); // appKey
                    expect(mock.params).to.include(0); // image size
                    mock.callback(null, { insertId: 1 });
                });
            });

            it("should fail gracefully when an error occurs", function(done) {
                obj.processImage(
                    {
                        sourceFile: sourceFile,
                        tenant: tenant,
                        appKey: appKey,
                        ops: [{ op: "orient" }]
                    },
                    (err, processedImages) => {
                        expect(err).is.an("error");
                        expect(err).has.property("code", "E_DUM");
                        done();
                    }
                );
                // processImage() will emit this during the mock SQL query
                obj.once("mockQuery", (mock) => {
                    var dummyError = new Error("Dummy");
                    dummyError.code = "E_DUM";
                    mock.callback(dummyError);
                });
            });
        });
    });
});

after(function(done) {
    rimraf("/tmp/" + tenant, (err) => {
        if (err) console.error(err);
        fs.unlink("/tmp/" + sourceFile, (err) => {
            if (err) console.error(err);
            done();
        });
    });
});
