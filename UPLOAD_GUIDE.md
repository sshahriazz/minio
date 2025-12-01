# S3/MinIO Advanced Upload Guide

## Overview

This guide explains how S3 handles different file types and sizes, and
demonstrates how to implement uploads with pause/resume and progress tracking.

## How S3 Handles Different File Sizes

### Small Files (< 5MB) - Simple Upload

- **Method**: `PutObjectCommand`
- **Process**: Single HTTP request
- **Pros**: Fast, simple, low overhead
- **Cons**: No pause/resume, must retry entire file on failure
- **Best for**: Images, small videos, documents

### Large Files (≥ 5MB) - Multipart Upload

- **Method**: Multipart Upload API
- **Process**:
  1. Initiate multipart upload → Get Upload ID
  2. Split file into parts (5MB-5GB each)
  3. Upload each part independently
  4. Complete multipart upload
- **Pros**:
  - Pause/resume capability
  - Parallel part uploads
  - Resilient to network failures
  - Can retry individual parts
- **Cons**: More complex, slight overhead
- **Best for**: Large videos, large images, big files

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Upload Manager                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │ File Size    │         │ Upload Strategy              │  │
│  │ Detection    │────────▶│ - Simple (< 5MB)            │  │
│  └──────────────┘         │ - Multipart (≥ 5MB)         │  │
│                           └──────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ State Management                                      │  │
│  │ - Upload ID tracking                                  │  │
│  │ - Uploaded parts tracking                             │  │
│  │ - Pause/Resume state                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Progress Tracking                                     │  │
│  │ - Bytes uploaded                                      │  │
│  │ - Percentage complete                                 │  │
│  │ - Current part / Total parts                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Automatic Strategy Selection

The `UploadManager` automatically chooses the best upload strategy based on file
size:

```typescript
if (fileSize < MULTIPART_THRESHOLD) {
    // Use simple upload
    await this.simpleUpload(...);
} else {
    // Use multipart upload
    await this.multipartUpload(...);
}
```

### 2. Pause/Resume Support

**How it works:**

1. During upload, state is stored in memory (Upload ID, uploaded parts)
2. When paused, the upload stops but state is preserved
3. On resume, we query S3 for already uploaded parts
4. Continue uploading remaining parts

**Example:**

```typescript
// Start upload
const uploadPromise = manager.uploadFile(
  bucket,
  key,
  filePath,
  progressCallback,
);

// Pause
manager.pauseUpload(bucket, key);

// Resume later
await manager.resumeUpload(bucket, key, progressCallback);
```

### 3. Progress Tracking

Progress callback provides real-time information:

- **uploadedBytes**: Bytes uploaded so far
- **totalBytes**: Total file size
- **percentage**: Upload percentage (0-100)
- **currentPart**: Current part number (for multipart)
- **totalParts**: Total number of parts (for multipart)
- **status**: Upload status (uploading, paused, completed, failed)

### 4. Concurrent Part Uploads

For multipart uploads, multiple parts can be uploaded simultaneously:

```typescript
const MAX_CONCURRENT_UPLOADS = 3; // Upload 3 parts at once
```

This significantly speeds up large file uploads.

## Usage Examples

### Example 1: Upload a Small Image

```typescript
const manager = new UploadManager();

await manager.uploadFile(
  "my-bucket",
  "images/photo.jpg",
  "./photo.jpg",
  (progress) => {
    console.log(`${progress.percentage.toFixed(1)}% complete`);
  },
);
```

### Example 2: Upload a Large Video with Pause/Resume

```typescript
const manager = new UploadManager();

// Start upload
const uploadPromise = manager.uploadFile(
  "my-bucket",
  "videos/movie.mp4",
  "./movie.mp4",
  (progress) => {
    console.log(`Part ${progress.currentPart}/${progress.totalParts}`);
    console.log(`${progress.percentage.toFixed(1)}% complete`);
  },
);

// Pause after some time
setTimeout(() => {
  manager.pauseUpload("my-bucket", "videos/movie.mp4");
}, 5000);

// Resume later
setTimeout(async () => {
  await manager.resumeUpload("my-bucket", "videos/movie.mp4");
}, 10000);
```

### Example 3: Upload Multiple Files Concurrently

```typescript
const manager = new UploadManager();

const files = [
  { key: "images/photo1.jpg", path: "./photo1.jpg" },
  { key: "images/photo2.jpg", path: "./photo2.jpg" },
  { key: "videos/video1.mp4", path: "./video1.mp4" },
];

// Upload all files concurrently
await Promise.all(
  files.map((file) =>
    manager.uploadFile(
      "my-bucket",
      file.key,
      file.path,
      (progress) => {
        console.log(`${file.key}: ${progress.percentage.toFixed(1)}%`);
      },
    )
  ),
);
```

### Example 4: Handle Mixed File Types

```typescript
const manager = new UploadManager();

// Small image - uses simple upload
await manager.uploadFile("bucket", "thumb.jpg", "./thumb.jpg");

// Large video - uses multipart upload
await manager.uploadFile("bucket", "movie.mp4", "./movie.mp4");

// Medium PDF - uses simple upload if < 5MB, multipart if ≥ 5MB
await manager.uploadFile("bucket", "doc.pdf", "./doc.pdf");
```

## Multipart Upload Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Multipart Upload Flow                     │
└─────────────────────────────────────────────────────────────┘

1. INITIATE
   ┌──────────────────────────────────────┐
   │ CreateMultipartUploadCommand         │
   │ Returns: Upload ID                   │
   └──────────────────────────────────────┘
                    │
                    ▼
2. UPLOAD PARTS (Concurrent)
   ┌──────────────────────────────────────┐
   │ Part 1 │ Part 2 │ Part 3 │ ...       │
   │ UploadPartCommand for each part      │
   │ Returns: ETag for each part          │
   └──────────────────────────────────────┘
                    │
                    ▼
3. COMPLETE
   ┌──────────────────────────────────────┐
   │ CompleteMultipartUploadCommand       │
   │ Input: Upload ID + All ETags         │
   │ S3 assembles the file                │
   └──────────────────────────────────────┘
```

## State Persistence

For production use, you should persist upload state to survive application
restarts:

```typescript
// Save state to file/database
const state = manager.getUploadState(bucket, key);
await Deno.writeTextFile("upload-state.json", JSON.stringify(state));

// Resume from saved state
const savedState = JSON.parse(await Deno.readTextFile("upload-state.json"));
await manager.multipartUpload(
  savedState.bucket,
  savedState.key,
  savedState.filePath,
  savedState.fileSize,
  progressCallback,
  savedState.uploadId,
);
```

## Configuration Options

```typescript
// Adjust these constants based on your needs
const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB - when to use multipart
const PART_SIZE = 5 * 1024 * 1024; // 5MB - size of each part
const MAX_CONCURRENT_UPLOADS = 3; // Number of concurrent part uploads
```

### Recommendations:

- **MULTIPART_THRESHOLD**: 5-10MB
- **PART_SIZE**: 5-100MB (S3 allows 5MB-5GB)
- **MAX_CONCURRENT_UPLOADS**: 3-5 (balance speed vs. resource usage)

## Error Handling

The upload manager handles common errors:

```typescript
try {
  await manager.uploadFile(bucket, key, filePath);
} catch (error) {
  if (error.name === "NoSuchBucket") {
    console.error("Bucket does not exist");
  } else if (error.name === "NetworkError") {
    console.error("Network error - can resume later");
    // State is preserved, can resume
  } else {
    console.error("Upload failed:", error);
  }
}
```

## Best Practices

1. **Choose the right threshold**: 5-10MB is a good balance
2. **Use concurrent uploads**: Speeds up large files significantly
3. **Implement retry logic**: Network failures are common
4. **Persist state**: For long uploads, save state to disk
5. **Monitor progress**: Provide user feedback for better UX
6. **Clean up failed uploads**: Use `abortUpload()` to clean up
7. **Set appropriate timeouts**: For large files, increase timeout settings

## Performance Tips

### For Small Files (< 5MB)

- Use simple upload (faster, less overhead)
- Can upload many files concurrently
- No need for progress tracking

### For Large Files (≥ 5MB)

- Use multipart upload
- Increase `MAX_CONCURRENT_UPLOADS` for faster uploads
- Larger `PART_SIZE` = fewer parts = less overhead
- Smaller `PART_SIZE` = more granular progress tracking

### For Mixed Workloads

- Let the manager auto-select strategy
- Upload different files concurrently
- Monitor overall progress across all files

## Running the Example

```bash
# Run the advanced upload example
deno run --allow-read --allow-net advanced-upload.ts
```

## Integration with Your Application

```typescript
import { UploadManager } from "./advanced-upload.ts";

const manager = new UploadManager();

// In your upload handler
async function handleFileUpload(file: File) {
  await manager.uploadFile(
    "my-bucket",
    `uploads/${file.name}`,
    file.path,
    (progress) => {
      // Update UI with progress
      updateProgressBar(progress.percentage);
    },
  );
}
```
