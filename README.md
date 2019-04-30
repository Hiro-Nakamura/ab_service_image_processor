# ab_service_image_processor

Rotate and resize images, then store the results in the local filesystem. Each
processed image file will be kept track of through a database entry in
the `op_imageupload` table. The UUIDs referencing those database entries will be
returned once the image processor job request is completed.

Jobs can be requested using [cote](https://github.com/dashersw/cote). This
service will respond to job requests with type: `image.upload`. The required 
parameters are:
- sourceFile
  - The filename of the source image, located in the pre-configured 
    `inputPath` directory.
- tenant
  - The tenant key string.
- appKey
  - The application key string.
- ops
  - An array of requested operations to perform on the source image. More on
    this later.

### Basic example

``` javascript
const cote = require('cote');
const client = new cote.Requester({ name: "ImageProcessor client" });

client.send(
    {
        type: "image.upload",
        sourceFile: "my_image.jpg",
        tenant: "MY TENANT KEY",
        appKey: "MY APP KEY",
        ops: [
            {
                op: "resize",
                width: 800,
                height: 600
            }
        ]
    },
    (err, results) => {
        
        console.log("Resized image UUID is: ", results[0].uuid);
        console.log("Resized image filesystem path is: ", results[0].targetFile);
        
    });
);
```


### Multiple ops

A single request involve just one source image file. However, multiple 
operations can be performed on that image. Each operation will produce a 
separate target image. For example:

``` javascript
client.send(
    {
        type: "image.upload",
        sourceFile: "my_image2.jpg",
        tenant: "MY TENANT KEY",
        appKey: "MY APP KEY",
        ops: [
            {
                op: "resize",
                width: 80,
                height: 80,
                quality: 65
            },
            {
                op: "resize",
                width: 1024,
                height: 768,
                quality: 80
            },
            {
                op: "orient"
            }
        ]
    },
    (err, results) => {
    
        console.log("80x80 thumbnail image UUID: ", results[0].uuid);
        console.log("1024x768 image UUID: ", results[1].uuid);
        console.log("reoriented image UUID: ", results[2].uuid);
    
    }
);

```

The returned results will be in the same order as the requested operations.


### Operations

Operations are placed into the `ops` parameter array. These are the only 
possible operations at this time:

1. **orient**

    The image will be auto rotated to the correct orientation based on its
    embedded exif information.
    
    `{ op: "orient" }`
    
2. **resize**

    Auto orientation will also be appled. The image will be scaled up or down 
    to the specified dimensions:
    - **width**
        - Horizontal dimension in pixels.
    - **height**
        - Vertical dimension in pixels.
    - **quality**
        - Optional JPEG quality.
    
    ```javascript
        {
            op: "resize",
            width: 200,
            height: 100,
            quality: 90
        }
    ```

### Request results

The results are delivered as an array. Each array item corresponds to a 
requested operation, in the same order as it was sent.

``` javascript
[
    {
        id: <integer>,    // primary key for the database entry
        uuid: <string>,   // another key for the database entry
        appKey: <string>,
        tenant: <string>,
        sourceFile: <string>,
        targetFile: <string>, // full path to the filesystem location
        size: <integer>,  // size of the resulting image
        type: <string>,   // the MIME type
        op: <object>      // copy of the requested operation
    },
    ...
]
```


### Configuration

There are two settings in `config/image_processor.js`:
  - inputPath
    - This is the absolute path to where the source image files will be read from.
  - outputPath
    - This is the absolute base path to where the target image files will be
    written to. That is, the `tenant` and `appKey` subdirectories will be
    based here; and the actual output images will be written inside the
    `/<outputPath>/<tenant>/<appKey>` directory.
    

Another required setting is the `site` database connection, which is typically
set up in `config/local.js` under `datastores`.


