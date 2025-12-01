import {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    PutObjectCommand,
    ListPartsCommand,
} from "@aws-sdk/client-s3";

// Configuration
const s3Client = new S3Client({
    endpoint: "https://api.minio.wedcloud.com.au",
    region: "us-east-1",
    credentials: {
        accessKeyId: "dev_wedcloud",
        secretAccessKey: "W9[>Kdf6",
    },
    forcePathStyle: true,
});

// Constants
const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB
const PART_SIZE = 5 * 1024 * 1024; // 5MB per part
const MAX_CONCURRENT_UPLOADS = 3; // Upload 3 parts concurrently

/**
 * Upload state for pause/resume functionality
 */
interface UploadState {
    uploadId: string;
    bucket: string;
    key: string;
    filePath: string;
    fileSize: number;
    uploadedParts: Array<{ PartNumber: number; ETag: string }>;
    nextPartNumber: number;
    isPaused: boolean;
}

/**
 * Progress callback interface
 */
interface ProgressInfo {
    fileName: string;
    uploadedBytes: number;
    totalBytes: number;
    percentage: number;
    currentPart?: number;
    totalParts?: number;
    status: "uploading" | "paused" | "completed" | "failed";
}

type ProgressCallback = (progress: ProgressInfo) => void;

/**
 * Upload Manager - Handles multiple file uploads with pause/resume
 */
class UploadManager {
    private uploadStates: Map<string, UploadState> = new Map();
    private activeUploads: Map<string, AbortController> = new Map();

    /**
     * Upload a file (automatically chooses simple or multipart upload)
     */
    async uploadFile(
        bucket: string,
        key: string,
        filePath: string,
        onProgress?: ProgressCallback,
    ): Promise<void> {
        const fileInfo = await Deno.stat(filePath);
        const fileSize = fileInfo.size;

        console.log(`📁 Uploading: ${filePath} (${this.formatBytes(fileSize)})`);

        if (fileSize < MULTIPART_THRESHOLD) {
            // Use simple upload for small files
            await this.simpleUpload(bucket, key, filePath, fileSize, onProgress);
        } else {
            // Use multipart upload for large files
            await this.multipartUpload(bucket, key, filePath, fileSize, onProgress);
        }
    }

    /**
     * Simple upload for small files
     */
    private async simpleUpload(
        bucket: string,
        key: string,
        filePath: string,
        fileSize: number,
        onProgress?: ProgressCallback,
    ): Promise<void> {
        try {
            onProgress?.({
                fileName: filePath,
                uploadedBytes: 0,
                totalBytes: fileSize,
                percentage: 0,
                status: "uploading",
            });

            const fileContent = await Deno.readFile(filePath);
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: fileContent,
            });

            await s3Client.send(command);

            onProgress?.({
                fileName: filePath,
                uploadedBytes: fileSize,
                totalBytes: fileSize,
                percentage: 100,
                status: "completed",
            });

            console.log(`✅ Simple upload completed: ${key}`);
        } catch (error) {
            onProgress?.({
                fileName: filePath,
                uploadedBytes: 0,
                totalBytes: fileSize,
                percentage: 0,
                status: "failed",
            });
            throw error;
        }
    }

    /**
     * Multipart upload for large files with pause/resume support
     */
    async multipartUpload(
        bucket: string,
        key: string,
        filePath: string,
        fileSize: number,
        onProgress?: ProgressCallback,
        resumeUploadId?: string,
    ): Promise<void> {
        const stateKey = `${bucket}/${key}`;
        let state: UploadState;

        try {
            // Initialize or resume upload
            if (resumeUploadId || this.uploadStates.has(stateKey)) {
                state = await this.resumeMultipartUpload(
                    bucket,
                    key,
                    filePath,
                    fileSize,
                    resumeUploadId,
                );
                console.log(`🔄 Resuming upload: ${key} (Upload ID: ${state.uploadId})`);
            } else {
                state = await this.initiateMultipartUpload(bucket, key, filePath, fileSize);
                console.log(`🚀 Starting multipart upload: ${key} (Upload ID: ${state.uploadId})`);
            }

            this.uploadStates.set(stateKey, state);

            // Calculate total parts
            const totalParts = Math.ceil(fileSize / PART_SIZE);

            // Open file for reading
            const file = await Deno.open(filePath, { read: true });

            try {
                // Upload parts
                while (state.nextPartNumber <= totalParts && !state.isPaused) {
                    // Upload parts concurrently
                    const uploadPromises: Promise<void>[] = [];

                    for (
                        let i = 0;
                        i < MAX_CONCURRENT_UPLOADS && state.nextPartNumber <= totalParts;
                        i++
                    ) {
                        const partNumber = state.nextPartNumber++;
                        const promise = this.uploadPart(
                            file,
                            state,
                            partNumber,
                            fileSize,
                            onProgress,
                        );
                        uploadPromises.push(promise);
                    }

                    await Promise.all(uploadPromises);
                }

                // Check if paused
                if (state.isPaused) {
                    onProgress?.({
                        fileName: filePath,
                        uploadedBytes: state.uploadedParts.length * PART_SIZE,
                        totalBytes: fileSize,
                        percentage: (state.uploadedParts.length / totalParts) * 100,
                        currentPart: state.uploadedParts.length,
                        totalParts,
                        status: "paused",
                    });
                    console.log(`⏸️  Upload paused: ${key}`);
                    return;
                }

                // Complete multipart upload
                await this.completeMultipartUpload(state);

                onProgress?.({
                    fileName: filePath,
                    uploadedBytes: fileSize,
                    totalBytes: fileSize,
                    percentage: 100,
                    currentPart: totalParts,
                    totalParts,
                    status: "completed",
                });

                console.log(`✅ Multipart upload completed: ${key}`);
                this.uploadStates.delete(stateKey);
            } finally {
                file.close();
            }
        } catch (error) {
            console.error(`❌ Upload failed: ${key}`, error);
            onProgress?.({
                fileName: filePath,
                uploadedBytes: 0,
                totalBytes: fileSize,
                percentage: 0,
                status: "failed",
            });
            throw error;
        }
    }

    /**
     * Initiate a new multipart upload
     */
    private async initiateMultipartUpload(
        bucket: string,
        key: string,
        filePath: string,
        fileSize: number,
    ): Promise<UploadState> {
        const command = new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
        });

        const response = await s3Client.send(command);

        if (!response.UploadId) {
            throw new Error("Failed to initiate multipart upload");
        }

        return {
            uploadId: response.UploadId,
            bucket,
            key,
            filePath,
            fileSize,
            uploadedParts: [],
            nextPartNumber: 1,
            isPaused: false,
        };
    }

    /**
     * Resume an existing multipart upload
     */
    private async resumeMultipartUpload(
        bucket: string,
        key: string,
        filePath: string,
        fileSize: number,
        uploadId?: string,
    ): Promise<UploadState> {
        const stateKey = `${bucket}/${key}`;
        const existingState = this.uploadStates.get(stateKey);

        const finalUploadId = uploadId || existingState?.uploadId;

        if (!finalUploadId) {
            throw new Error("No upload ID provided for resume");
        }

        // List already uploaded parts
        const listCommand = new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: finalUploadId,
        });

        const response = await s3Client.send(listCommand);
        const uploadedParts =
            response.Parts?.map((part) => ({
                PartNumber: part.PartNumber!,
                ETag: part.ETag!,
            })) || [];

        const nextPartNumber = uploadedParts.length + 1;

        return {
            uploadId: finalUploadId,
            bucket,
            key,
            filePath,
            fileSize,
            uploadedParts,
            nextPartNumber,
            isPaused: false,
        };
    }

    /**
     * Upload a single part
     */
    private async uploadPart(
        file: Deno.FsFile,
        state: UploadState,
        partNumber: number,
        fileSize: number,
        onProgress?: ProgressCallback,
    ): Promise<void> {
        const offset = (partNumber - 1) * PART_SIZE;
        const partSize = Math.min(PART_SIZE, fileSize - offset);

        // Read part data
        const buffer = new Uint8Array(partSize);
        await file.seek(offset, Deno.SeekMode.Start);
        await file.read(buffer);

        // Upload part
        const command = new UploadPartCommand({
            Bucket: state.bucket,
            Key: state.key,
            UploadId: state.uploadId,
            PartNumber: partNumber,
            Body: buffer,
        });

        const response = await s3Client.send(command);

        if (!response.ETag) {
            throw new Error(`Failed to upload part ${partNumber}`);
        }

        // Store uploaded part info
        state.uploadedParts.push({
            PartNumber: partNumber,
            ETag: response.ETag,
        });

        // Sort parts by part number
        state.uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

        // Report progress
        const uploadedBytes = state.uploadedParts.length * PART_SIZE;
        const totalParts = Math.ceil(fileSize / PART_SIZE);

        onProgress?.({
            fileName: state.filePath,
            uploadedBytes: Math.min(uploadedBytes, fileSize),
            totalBytes: fileSize,
            percentage: Math.min((uploadedBytes / fileSize) * 100, 100),
            currentPart: state.uploadedParts.length,
            totalParts,
            status: "uploading",
        });

        console.log(
            `  📦 Part ${partNumber}/${totalParts} uploaded (${this.formatBytes(partSize)})`,
        );
    }

    /**
     * Complete multipart upload
     */
    private async completeMultipartUpload(state: UploadState): Promise<void> {
        const command = new CompleteMultipartUploadCommand({
            Bucket: state.bucket,
            Key: state.key,
            UploadId: state.uploadId,
            MultipartUpload: {
                Parts: state.uploadedParts,
            },
        });

        await s3Client.send(command);
    }

    /**
     * Pause an ongoing upload
     */
    pauseUpload(bucket: string, key: string): void {
        const stateKey = `${bucket}/${key}`;
        const state = this.uploadStates.get(stateKey);

        if (state) {
            state.isPaused = true;
            console.log(`⏸️  Pausing upload: ${key}`);
        }
    }

    /**
     * Resume a paused upload
     */
    async resumeUpload(
        bucket: string,
        key: string,
        onProgress?: ProgressCallback,
    ): Promise<void> {
        const stateKey = `${bucket}/${key}`;
        const state = this.uploadStates.get(stateKey);

        if (!state) {
            throw new Error(`No paused upload found for ${key}`);
        }

        state.isPaused = false;
        console.log(`▶️  Resuming upload: ${key}`);

        await this.multipartUpload(
            state.bucket,
            state.key,
            state.filePath,
            state.fileSize,
            onProgress,
            state.uploadId,
        );
    }

    /**
     * Abort an upload
     */
    async abortUpload(bucket: string, key: string): Promise<void> {
        const stateKey = `${bucket}/${key}`;
        const state = this.uploadStates.get(stateKey);

        if (state) {
            const command = new AbortMultipartUploadCommand({
                Bucket: state.bucket,
                Key: state.key,
                UploadId: state.uploadId,
            });

            await s3Client.send(command);
            this.uploadStates.delete(stateKey);
            console.log(`🛑 Upload aborted: ${key}`);
        }
    }

    /**
     * Get upload state for a file
     */
    getUploadState(bucket: string, key: string): UploadState | undefined {
        const stateKey = `${bucket}/${key}`;
        return this.uploadStates.get(stateKey);
    }

    /**
     * Format bytes to human-readable format
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
    }
}

/**
 * Example usage: Upload multiple files with different sizes
 */
async function example() {
    const manager = new UploadManager();
    const bucket = "my-test-bucket";

    // Progress callback
    const progressCallback: ProgressCallback = (progress) => {
        const bar = "█".repeat(Math.floor(progress.percentage / 2));
        const empty = "░".repeat(50 - Math.floor(progress.percentage / 2));

        console.log(
            `\n📊 ${progress.fileName}\n` +
                `   [${bar}${empty}] ${progress.percentage.toFixed(1)}%\n` +
                `   ${manager["formatBytes"](progress.uploadedBytes)} / ${manager["formatBytes"](progress.totalBytes)}` +
                (progress.totalParts
                    ? `\n   Part ${progress.currentPart}/${progress.totalParts}`
                    : "") +
                `\n   Status: ${progress.status}`,
        );
    };

    // Example 1: Upload a small image
    console.log("\n=== Example 1: Small Image ===");
    await manager.uploadFile(bucket, "images/small-photo.jpg", "./small-photo.jpg", progressCallback);

    // Example 2: Upload a large video with pause/resume
    console.log("\n=== Example 2: Large Video with Pause/Resume ===");

    // Start upload
    const uploadPromise = manager.uploadFile(
        bucket,
        "videos/large-video.mp4",
        "./large-video.mp4",
        progressCallback,
    );

    // Simulate pause after 2 seconds
    setTimeout(() => {
        manager.pauseUpload(bucket, "videos/large-video.mp4");
    }, 2000);

    try {
        await uploadPromise;
    } catch (error) {
        console.log("Upload paused or failed:", error);
    }

    // Resume after 3 seconds
    setTimeout(async () => {
        console.log("\n🔄 Resuming upload...");
        await manager.resumeUpload(bucket, "videos/large-video.mp4", progressCallback);
    }, 3000);

    // Example 3: Upload multiple files concurrently
    console.log("\n=== Example 3: Multiple Files Concurrently ===");

    const files = [
        { key: "images/photo1.jpg", path: "./photo1.jpg" },
        { key: "images/photo2.jpg", path: "./photo2.jpg" },
        { key: "videos/video1.mp4", path: "./video1.mp4" },
        { key: "documents/doc1.pdf", path: "./doc1.pdf" },
    ];

    await Promise.all(
        files.map((file) =>
            manager.uploadFile(bucket, file.key, file.path, progressCallback)
        ),
    );

    console.log("\n✅ All uploads completed!");
}

// Run example if this is the main module
if (import.meta.main) {
    await example();
}

export { UploadManager, type ProgressCallback, type ProgressInfo, type UploadState };
