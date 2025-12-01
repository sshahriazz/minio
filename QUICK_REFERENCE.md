# Quick Reference: S3 Upload Strategies

## File Size Decision Tree

```
Is file size < 5MB?
│
├─ YES → Use Simple Upload (PutObjectCommand)
│         • Single request
│         • Fast and simple
│         • No pause/resume
│
└─ NO  → Use Multipart Upload
          • Split into 5MB parts
          • Upload parts concurrently
          • Supports pause/resume
          • More resilient
```

## Upload Methods Comparison

| Feature            | Simple Upload | Multipart Upload |
| ------------------ | ------------- | ---------------- |
| File Size          | < 5MB         | ≥ 5MB            |
| Requests           | 1             | Multiple (3+)    |
| Pause/Resume       | ❌            | ✅               |
| Parallel Upload    | ❌            | ✅               |
| Progress Tracking  | Basic         | Detailed         |
| Network Resilience | Low           | High             |
| Complexity         | Low           | Medium           |

## Code Examples

### 1. Simple Upload (Small Files)

```typescript
import { UploadManager } from "./advanced-upload.ts";

const manager = new UploadManager();

// Upload small image
await manager.uploadFile(
  "my-bucket",
  "images/photo.jpg",
  "./photo.jpg",
  (progress) => {
    console.log(`${progress.percentage}% complete`);
  },
);
```

### 2. Multipart Upload (Large Files)

```typescript
// Upload large video - automatically uses multipart
await manager.uploadFile(
  "my-bucket",
  "videos/movie.mp4",
  "./movie.mp4",
  (progress) => {
    console.log(`Part ${progress.currentPart}/${progress.totalParts}`);
    console.log(`${progress.percentage}% complete`);
  },
);
```

### 3. Pause/Resume

```typescript
// Start upload
const promise = manager.uploadFile(bucket, key, path, callback);

// Pause
manager.pauseUpload(bucket, key);

// Resume later
await manager.resumeUpload(bucket, key, callback);
```

### 4. Multiple Files

```typescript
const files = [
  { key: "img1.jpg", path: "./img1.jpg" },
  { key: "video1.mp4", path: "./video1.mp4" },
];

// Upload all concurrently
await Promise.all(
  files.map((f) => manager.uploadFile(bucket, f.key, f.path)),
);
```

## Progress Callback Interface

```typescript
interface ProgressInfo {
  fileName: string; // File being uploaded
  uploadedBytes: number; // Bytes uploaded so far
  totalBytes: number; // Total file size
  percentage: number; // 0-100
  currentPart?: number; // Current part (multipart only)
  totalParts?: number; // Total parts (multipart only)
  status: "uploading" | "paused" | "completed" | "failed";
}
```

## Configuration

```typescript
// In advanced-upload.ts
const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB
const PART_SIZE = 5 * 1024 * 1024; // 5MB per part
const MAX_CONCURRENT_UPLOADS = 3; // 3 parts at once
```

## Common Use Cases

### Mixed File Types (Images + Videos)

```typescript
const manager = new UploadManager();

// Small thumbnail - simple upload
await manager.uploadFile(bucket, "thumb.jpg", "./thumb.jpg");

// Large video - multipart upload
await manager.uploadFile(bucket, "video.mp4", "./video.mp4");

// Manager automatically chooses the right strategy!
```

### Batch Upload with Progress

```typescript
const files = ["img1.jpg", "img2.jpg", "video.mp4"];
let completed = 0;

await Promise.all(
  files.map((file) =>
    manager.uploadFile(bucket, file, `./${file}`, (progress) => {
      if (progress.status === "completed") {
        completed++;
        console.log(`${completed}/${files.length} files done`);
      }
    })
  ),
);
```

### Resume After Application Restart

```typescript
// Before restart - save state
const state = manager.getUploadState(bucket, key);
await Deno.writeTextFile("state.json", JSON.stringify(state));

// After restart - resume
const state = JSON.parse(await Deno.readTextFile("state.json"));
await manager.multipartUpload(
  state.bucket,
  state.key,
  state.filePath,
  state.fileSize,
  callback,
  state.uploadId, // Resume with this upload ID
);
```

## Running the Demo

```bash
# Run the interactive demo
deno run --allow-read --allow-net --allow-write demo-upload.ts
```

## Key Takeaways

1. **Automatic Strategy Selection**: The manager chooses simple or multipart
   based on file size
2. **Pause/Resume**: Only available for multipart uploads (files ≥ 5MB)
3. **Progress Tracking**: Works for both upload types
4. **Concurrent Uploads**: Upload multiple files or parts simultaneously
5. **Error Resilience**: Multipart uploads can retry individual parts

## Performance Tips

- **Small files**: Upload many concurrently (10-20 at once)
- **Large files**: Increase `MAX_CONCURRENT_UPLOADS` (3-5)
- **Very large files**: Increase `PART_SIZE` (10-100MB)
- **Slow networks**: Decrease `PART_SIZE` for better progress granularity
