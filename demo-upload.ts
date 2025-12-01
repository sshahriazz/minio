import { UploadManager, type ProgressCallback } from "./advanced-upload.ts";
import { createBucket } from "./main.ts";

/**
 * Demo: Upload different types of files with progress tracking
 */

// Create upload manager
const manager = new UploadManager();
const bucket = "test-bucket"; // Using existing bucket

// Progress callback with nice formatting
const createProgressCallback = (fileName: string): ProgressCallback => {
    return (progress) => {
        const barLength = 50;
        const filledLength = Math.floor((progress.percentage / 100) * barLength);
        const bar = "█".repeat(filledLength);
        const empty = "░".repeat(barLength - filledLength);

        const formatBytes = (bytes: number): string => {
            if (bytes === 0) return "0 Bytes";
            const k = 1024;
            const sizes = ["Bytes", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
        };

        console.clear();
        console.log("╔════════════════════════════════════════════════════════════╗");
        console.log("║           S3/MinIO Upload Progress Tracker                ║");
        console.log("╚════════════════════════════════════════════════════════════╝\n");

        console.log(`📁 File: ${fileName}`);
        console.log(`📊 Progress: [${bar}${empty}] ${progress.percentage.toFixed(1)}%`);
        console.log(
            `💾 Size: ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}`,
        );

        if (progress.totalParts) {
            console.log(`📦 Parts: ${progress.currentPart} / ${progress.totalParts}`);
        }

        const statusEmoji = {
            uploading: "⏳",
            paused: "⏸️",
            completed: "✅",
            failed: "❌",
        };

        console.log(`${statusEmoji[progress.status]} Status: ${progress.status.toUpperCase()}\n`);
    };
};

// Demo scenarios
async function demo() {
    console.log("\n🚀 Starting S3/MinIO Upload Demo\n");

    // Ensure bucket exists
    console.log(`📦 Ensuring bucket "${bucket}" exists...\n`);
    await createBucket(bucket);

    // Scenario 1: Create test files
    console.log("📝 Creating test files...\n");

    // Helper function to create files in chunks (Deno crypto has 65KB limit)
    const createTestFile = async (path: string, sizeMB: number) => {
        const chunkSize = 64 * 1024; // 64KB chunks
        const totalSize = sizeMB * 1024 * 1024;
        const file = await Deno.open(path, { write: true, create: true, truncate: true });
        
        let written = 0;
        while (written < totalSize) {
            const remaining = totalSize - written;
            const currentChunkSize = Math.min(chunkSize, remaining);
            const chunk = new Uint8Array(currentChunkSize);
            crypto.getRandomValues(chunk);
            await file.write(chunk);
            written += currentChunkSize;
        }
        
        file.close();
    };

    // Small image (1MB)
    await createTestFile("./test-small-image.jpg", 1);
    console.log("✓ Created test-small-image.jpg (1 MB)");

    // Medium image (3MB)
    await createTestFile("./test-medium-image.jpg", 3);
    console.log("✓ Created test-medium-image.jpg (3 MB)");

    // Large video (15MB) - will use multipart upload
    await createTestFile("./test-large-video.mp4", 15);
    console.log("✓ Created test-large-video.mp4 (15 MB)");

    // Very large file (30MB) - will use multipart upload
    await createTestFile("./test-very-large-file.bin", 30);
    console.log("✓ Created test-very-large-file.bin (30 MB)\n");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Scenario 2: Upload small file (simple upload)
    console.log("\n" + "=".repeat(60));
    console.log("SCENARIO 1: Small Image Upload (Simple Upload)");
    console.log("=".repeat(60) + "\n");

    await manager.uploadFile(
        bucket,
        "images/small-image.jpg",
        "./test-small-image.jpg",
        createProgressCallback("test-small-image.jpg"),
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Scenario 3: Upload medium file (simple upload)
    console.log("\n" + "=".repeat(60));
    console.log("SCENARIO 2: Medium Image Upload (Simple Upload)");
    console.log("=".repeat(60) + "\n");

    await manager.uploadFile(
        bucket,
        "images/medium-image.jpg",
        "./test-medium-image.jpg",
        createProgressCallback("test-medium-image.jpg"),
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Scenario 4: Upload large file (multipart upload)
    console.log("\n" + "=".repeat(60));
    console.log("SCENARIO 3: Large Video Upload (Multipart Upload)");
    console.log("=".repeat(60) + "\n");

    await manager.uploadFile(
        bucket,
        "videos/large-video.mp4",
        "./test-large-video.mp4",
        createProgressCallback("test-large-video.mp4"),
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Scenario 5: Upload with pause/resume
    console.log("\n" + "=".repeat(60));
    console.log("SCENARIO 4: Upload with Pause/Resume (Multipart Upload)");
    console.log("=".repeat(60) + "\n");

    // Start upload
    const uploadPromise = manager.uploadFile(
        bucket,
        "files/very-large-file.bin",
        "./test-very-large-file.bin",
        createProgressCallback("test-very-large-file.bin"),
    );

    // Pause after 3 seconds
    setTimeout(() => {
        console.log("\n⏸️  PAUSING UPLOAD...\n");
        manager.pauseUpload(bucket, "files/very-large-file.bin");
    }, 3000);

    try {
        await uploadPromise;
    } catch (_error) {
        // Upload was paused
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Resume upload
    console.log("\n▶️  RESUMING UPLOAD...\n");
    await manager.resumeUpload(
        bucket,
        "files/very-large-file.bin",
        createProgressCallback("test-very-large-file.bin"),
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Scenario 6: Upload multiple files concurrently
    console.log("\n" + "=".repeat(60));
    console.log("SCENARIO 5: Multiple Files Upload (Concurrent)");
    console.log("=".repeat(60) + "\n");

    const files = [
        { key: "batch/small-1.jpg", path: "./test-small-image.jpg" },
        { key: "batch/medium-1.jpg", path: "./test-medium-image.jpg" },
        { key: "batch/large-1.mp4", path: "./test-large-video.mp4" },
    ];

    let completedCount = 0;
    const totalFiles = files.length;

    await Promise.all(
        files.map((file, index) =>
            manager.uploadFile(
                bucket,
                file.key,
                file.path,
                (progress) => {
                    if (progress.status === "completed") {
                        completedCount++;
                    }
                    console.clear();
                    console.log("╔════════════════════════════════════════════════════════════╗");
                    console.log("║        Concurrent Upload Progress Tracker                 ║");
                    console.log("╚════════════════════════════════════════════════════════════╝\n");
                    console.log(`📊 Overall Progress: ${completedCount}/${totalFiles} files completed\n`);

                    files.forEach((f, i) => {
                        const status = i < index ? "✅" : i === index ? "⏳" : "⏳";
                        console.log(`${status} ${f.key}`);
                    });
                },
            )
        ),
    );

    // Cleanup
    console.log("\n\n🧹 Cleaning up test files...\n");
    await Deno.remove("./test-small-image.jpg");
    await Deno.remove("./test-medium-image.jpg");
    await Deno.remove("./test-large-video.mp4");
    await Deno.remove("./test-very-large-file.bin");

    console.log("\n" + "=".repeat(60));
    console.log("✅ DEMO COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(60) + "\n");

    console.log("📚 Summary:");
    console.log("  • Small files (< 5MB) use simple upload");
    console.log("  • Large files (≥ 5MB) use multipart upload");
    console.log("  • Multipart uploads support pause/resume");
    console.log("  • Progress tracking works for all upload types");
    console.log("  • Multiple files can be uploaded concurrently\n");
}

// Run demo
if (import.meta.main) {
    try {
        await demo();
    } catch (error) {
        console.error("\n❌ Demo failed:", error);
        console.error("\nMake sure:");
        console.error("  1. MinIO/S3 server is running");
        console.error("  2. Credentials are correct in advanced-upload.ts");
        console.error("  3. Bucket exists or can be created\n");
    }
}
