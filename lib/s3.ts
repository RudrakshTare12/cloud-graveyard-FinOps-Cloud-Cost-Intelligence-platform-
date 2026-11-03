import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY || '',
    },
});

export async function uploadAuditLogToS3(assetName: string, action: string) {
    const logContent = `[${new Date().toISOString()}] ACTION: ${action} | ASSET: ${assetName} | STATUS: PURGED`;
    const fileName = `logs/purge-${Date.now()}-${assetName}.log`;

    const command = new PutObjectCommand({
        Bucket: process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME,
        Key: fileName,
        Body: logContent,
        ContentType: 'text/plain',
    });

    try {
        await s3Client.send(command);
        return `https://${process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;
    } catch (error) {
        console.error("S3 Upload Error:", error);
        return null;
    }
}