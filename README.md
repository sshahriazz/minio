# MinIO Deno Project (AWS S3 SDK)

A Deno project for working with MinIO object storage using the AWS S3 SDK v3.

## Prerequisites

- [Deno](https://deno.land/) installed on your system
- MinIO server running (locally or remote)

## Setup

### 1. Install Deno

If you haven't installed Deno yet:

```bash
# macOS/Linux
curl -fsSL https://deno.land/install.sh | sh

# Or using Homebrew on macOS
brew install deno
```

### 2. Configure S3/MinIO Connection

Edit `main.ts` and update the S3 client configuration with your server details:

```typescript
const s3Client = new S3Client({
  endpoint: "https://your-minio-server.com", // Your MinIO server endpoint
  region: "us-east-1", // Required by SDK (MinIO ignores this)
  credentials: {
    accessKeyId: "your-access-key", // Your access key
    secretAccessKey: "your-secret-key", // Your secret key
  },
  forcePathStyle: true, // Required for MinIO compatibility
});
```

### 3. Run MinIO Server (Optional)

If you need to run MinIO locally for testing:

```bash
# Using Docker
docker run -p 9000:9000 -p 9001:9001 \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  quay.io/minio/minio server /data --console-address ":9001"
```

Access MinIO Console at: http://localhost:9001

## Usage

### Run the project

```bash
# Using the dev task
deno task dev

# Or directly
deno run --allow-net --allow-read --allow-write --allow-env --allow-sys main.ts
```

### Available Functions

The project includes the following S3/MinIO operations:

- **`listBuckets()`** - List all available buckets
- **`createBucket(bucketName)`** - Create a new bucket
- **`uploadFile(bucketName, objectName, filePath)`** - Upload a file to S3/MinIO
- **`downloadFile(bucketName, objectName, downloadPath)`** - Download a file
  from S3/MinIO
- **`listObjects(bucketName, prefix?)`** - List objects in a bucket
- **`deleteObject(bucketName, objectName)`** - Delete an object from a bucket

### Example Usage

Uncomment the example function calls in `main.ts`:

```typescript
await listBuckets();
await createBucket("my-test-bucket");
await uploadFile("my-test-bucket", "test.txt", "./test.txt");
await listObjects("my-test-bucket");
await downloadFile("my-test-bucket", "test.txt", "./downloaded-test.txt");
await deleteObject("my-test-bucket", "test.txt");
```

## Advanced Upload Features

This project includes an advanced upload manager that handles:

- **Automatic strategy selection** - Simple upload for small files (< 5MB),
  multipart for large files
- **Pause/Resume support** - Pause and resume large file uploads
- **Progress tracking** - Real-time upload progress with detailed metrics
- **Concurrent uploads** - Upload multiple files or parts simultaneously
- **Mixed file types** - Handles images, videos, and documents of any size

### Quick Start - Advanced Uploads

```bash
# Run the interactive demo
deno run --allow-read --allow-net --allow-write demo-upload.ts
```

### Example - Upload with Progress Tracking

```typescript
import { UploadManager } from "./advanced-upload.ts";

const manager = new UploadManager();

// Upload any file - manager chooses the best strategy
await manager.uploadFile(
  "my-bucket",
  "videos/movie.mp4",
  "./movie.mp4",
  (progress) => {
    console.log(`${progress.percentage.toFixed(1)}% complete`);
    console.log(`Part ${progress.currentPart}/${progress.totalParts}`);
  },
);

// Pause/Resume support
manager.pauseUpload("my-bucket", "videos/movie.mp4");
await manager.resumeUpload("my-bucket", "videos/movie.mp4");
```

### Documentation

- **[UPLOAD_GUIDE.md](./UPLOAD_GUIDE.md)** - Comprehensive guide to S3 upload
  strategies
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick reference with code
  examples

## Project Structure

```
minio/
├── deno.json              # Deno configuration and dependencies
├── main.ts                # Basic S3/MinIO operations
├── advanced-upload.ts     # Advanced upload manager with multipart support
├── demo-upload.ts         # Interactive demo of upload features
├── UPLOAD_GUIDE.md        # Comprehensive upload documentation
├── QUICK_REFERENCE.md     # Quick reference guide
└── README.md              # This file
```

## Permissions

The project requires the following Deno permissions:

- `--allow-net` - Network access for S3/MinIO API calls
- `--allow-read` - Read files for uploading
- `--allow-write` - Write files when downloading
- `--allow-env` - Access environment variables (if needed)
- `--allow-sys` - System information access (required by AWS SDK)

## Next Steps

1. Update the S3 client configuration with your server details
2. Create test files or buckets as needed
3. Uncomment and run the example functions in `main.ts`
4. Add your own custom S3/MinIO functionality

## Resources

- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [Deno Documentation](https://deno.land/manual)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
