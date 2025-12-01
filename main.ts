import {
    S3Client,
    ListBucketsCommand,
    CreateBucketCommand,
    HeadBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * AWS S3 Client Configuration
 * 
 * This is a basic setup for AWS S3 client compatible with MinIO.
 * Update the configuration with your S3/MinIO server details.
 */
const s3Client = new S3Client({
    endpoint: "https://api.minio.wedcloud.com.au",
    region: "us-east-1", // MinIO doesn't care about region, but SDK requires it
    credentials: {
        accessKeyId: "dev_wedcloud",
        secretAccessKey: "W9[>Kdf6",
    },
    forcePathStyle: true, // Required for MinIO compatibility
});

/**
 * Example: List all buckets
 */
async function listBuckets() {
    try {
        const command = new ListBucketsCommand({});
        const response = await s3Client.send(command);
        console.log("Available buckets:");
        response.Buckets?.forEach((bucket) => {
            console.log(`  - ${bucket.Name} (created: ${bucket.CreationDate})`);
        });
    } catch (error) {
        console.error("Error listing buckets:", error);
    }
}

/**
 * Example: Create a new bucket
 */
async function createBucket(bucketName: string) {
    try {
        // Check if bucket exists
        try {
            const headCommand = new HeadBucketCommand({ Bucket: bucketName });
            await s3Client.send(headCommand);
            console.log(`Bucket "${bucketName}" already exists`);
            return;
        } catch (error: any) {
            // Bucket doesn't exist, create it
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
                const createCommand = new CreateBucketCommand({ Bucket: bucketName });
                await s3Client.send(createCommand);
                console.log(`Bucket "${bucketName}" created successfully`);
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error(`Error creating bucket "${bucketName}":`, error);
    }
}

/**
 * Example: Upload a file to S3
 */
async function uploadFile(
    bucketName: string,
    objectName: string,
    filePath: string,
) {
    try {
        const fileContent = await Deno.readFile(filePath);
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: objectName,
            Body: fileContent,
        });
        await s3Client.send(command);
        console.log(`File "${filePath}" uploaded as "${objectName}" to bucket "${bucketName}"`);
    } catch (error) {
        console.error("Error uploading file:", error);
    }
}

/**
 * Example: Download a file from S3
 */
async function downloadFile(
    bucketName: string,
    objectName: string,
    downloadPath: string,
) {
    try {
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectName,
        });
        const response = await s3Client.send(command);

        // Convert stream to Uint8Array
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk);
        }

        // Concatenate chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        await Deno.writeFile(downloadPath, result);
        console.log(`File "${objectName}" downloaded to "${downloadPath}"`);
    } catch (error) {
        console.error("Error downloading file:", error);
    }
}

/**
 * Example: List objects in a bucket
 */
async function listObjects(bucketName: string, prefix = "") {
    try {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
        });
        const response = await s3Client.send(command);
        console.log(`Objects in bucket "${bucketName}":`);

        response.Contents?.forEach((obj: any) => {
            console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
        });
    } catch (error) {
        console.error("Error listing objects:", error);
    }
}

/**
 * Example: Delete an object
 */
async function deleteObject(bucketName: string, objectName: string) {
    try {
        const command = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: objectName,
        });
        await s3Client.send(command);
        console.log(`Object "${objectName}" deleted from bucket "${bucketName}"`);
    } catch (error) {
        console.error("Error deleting object:", error);
    }
}

// Main execution
if (import.meta.main) {
    console.log("MinIO Deno Client - Example Usage\n");

    // Example usage - uncomment the functions you want to test
    await listBuckets();

    // await createBucket("my-test-bucket");
    // await uploadFile("my-test-bucket", "test.txt", "./test.txt");
    // await listObjects("my-test-bucket");
    // await downloadFile("my-test-bucket", "test.txt", "./downloaded-test.txt");
    // await deleteObject("my-test-bucket", "test.txt");
}

// Export functions for use in other modules
export {
    s3Client,
    listBuckets,
    createBucket,
    uploadFile,
    downloadFile,
    listObjects,
    deleteObject,
};
